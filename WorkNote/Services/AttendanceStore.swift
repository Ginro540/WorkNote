import Foundation
import CoreLocation
import Observation
import FirebaseFirestore
import WorkNoteCore

/// 打刻（ホーム画面）と修正申請。
@Observable @MainActor
final class AttendanceStore {
    /// 押したあと数秒だけ取り消せる打刻（まだ保存していない）
    struct PendingPunch: Identifiable {
        let id = UUID().uuidString
        let kind: PunchKind
        let time: Date
        let workDate: String
    }

    enum HomeStatus {
        case notStarted, working, finished

        var label: String {
            switch self {
            case .notStarted: "未出勤"
            case .working: "勤務中"
            case .finished: "退勤済み"
            }
        }
    }

    /// 日付をまたぐ勤務を「勤務中」とみなす長さ。これを過ぎて退勤がなければ「退勤漏れ」
    static let overnightLimit: TimeInterval = 16 * 3600
    /// 押したあと取り消せる秒数
    static let undoSeconds: Double = 5
    /// 位置の取得を続ける時間（打刻から）
    static let locationTimeout: TimeInterval = 10 * 60

    let uid: String
    let settings: SettingsStore
    let location: LocationService

    /// 最近（前月〜翌月）の打刻
    private(set) var punches: [AttendancePunch] = []
    private(set) var unsentPunchIds: Set<String> = []
    private(set) var corrections: [AttendanceCorrection] = []
    private(set) var pendingPunch: PendingPunch?
    /// 取り消し待ちの打刻のために先に取れた位置
    private var pendingFix: CLLocation?

    /// 位置を取得中の打刻（ID → 打刻の時刻）
    @ObservationIgnored private var acquiring: [String: Date] = [:]
    @ObservationIgnored private var geocoded: Set<String> = []
    @ObservationIgnored private var commitTask: Task<Void, Never>?
    @ObservationIgnored private var timeoutTimer: Timer?
    @ObservationIgnored private var listeners: [ListenerRegistration] = []

    init(uid: String, settings: SettingsStore, location: LocationService) {
        self.uid = uid
        self.settings = settings
        self.location = location
    }

    private var punchCollection: CollectionReference { Firestore.db.collection("attendancePunches") }
    private var correctionCollection: CollectionReference { Firestore.db.collection("attendanceCorrections") }

    func start() {
        // 月は締め日で決まるので、カレンダーの前月〜翌月を読めば最近の打刻はすべて入る
        let thisMonth = WorkCalendar.dayKey(Date()).prefix(7)
        let months = [-1, 0, 1].map { WorkCalendar.shiftMonthKey(String(thisMonth), by: $0) }
        listeners.append(
            punchCollection.whereField("userId", isEqualTo: uid).whereField("month", in: months)
                .listen(AttendancePunch.self) { [weak self] items, pending in
                    guard let self else { return }
                    self.punches = items.sorted { $0.punchedAt < $1.punchedAt }
                    self.unsentPunchIds = pending
                    self.resumeLocationWork()
                }
        )
        listeners.append(
            correctionCollection.whereField("userId", isEqualTo: uid)
                .listen(AttendanceCorrection.self) { [weak self] items, _ in
                    self?.corrections = items.sorted { $0.createdAt > $1.createdAt }
                }
        )
        location.onLocation = { [weak self] in self?.handle($0) }
        location.onAuthorizationChange = { [weak self] in self?.handleAuthorizationChange() }
        timeoutTimer = Timer.scheduledTimer(withTimeInterval: 20, repeats: true) { [weak self] _ in
            Task { @MainActor in self?.expireLocationRequests() }
        }
    }

    func stop() {
        commitPendingNow()
        listeners.forEach { $0.remove() }
        listeners.removeAll()
        timeoutTimer?.invalidate()
        location.stop()
    }

    // MARK: - ホーム画面の状態

    private var today: String { WorkCalendar.dayKey(Date()) }

    /// 取り消し待ちも含めた打刻（時刻順）
    private var effectivePunches: [(workDate: String, kind: PunchKind, time: Date)] {
        var list: [(workDate: String, kind: PunchKind, time: Date)] = punches.map {
            (workDate: $0.workDate, kind: $0.kind, time: $0.punchedAt)
        }
        if let p = pendingPunch { list.append((workDate: p.workDate, kind: p.kind, time: p.time)) }
        return list.sorted { $0.time < $1.time }
    }

    /// 勤務中の勤務日（日付をまたぐ勤務は出勤した日）
    var openWorkDate: String? {
        guard let last = effectivePunches.last, last.kind == .clockIn else { return nil }
        if last.workDate == today { return today }
        return Date().timeIntervalSince(last.time) < Self.overnightLimit ? last.workDate : nil
    }

    var homeStatus: HomeStatus {
        if openWorkDate != nil { return .working }
        return effectivePunches.contains { $0.workDate == today } ? .finished : .notStarted
    }

    /// 次に押せる打刻
    var nextKind: PunchKind { homeStatus == .working ? .clockOut : .clockIn }

    var buttonLabel: String {
        switch homeStatus {
        case .notStarted: "出勤"
        case .working: "退勤"
        case .finished: "再出勤"
        }
    }

    /// ホームの「今日の勤務」に出す勤務日
    var timelineWorkDate: String { openWorkDate ?? today }

    func punches(on workDate: String) -> [AttendancePunch] {
        punches.filter { $0.workDate == workDate }
    }

    /// 退勤漏れ（または出勤漏れ）のある過去の勤務日。申請中・承認済みの修正がある日は除く
    var missingPunchDays: [String] {
        let open = openWorkDate
        let days = Set(punches.map(\.workDate)).filter { $0 < today && $0 != open }
        return days.filter { day in
            let summary = AttendanceCalculator.summarize(punches: punches(on: day).map(\.point), isPastDay: true)
            guard summary.status == .missingPunch else { return false }
            return !corrections.contains { $0.workDate == day && ($0.status == .pending || $0.status == .approved) }
        }.sorted()
    }

    func summary(for workDate: String, punches dayPunches: [AttendancePunch]? = nil) -> DaySummary {
        let list = dayPunches ?? punches(on: workDate)
        return AttendanceCalculator.summarize(
            punches: list.map(\.point),
            rules: settings.company.breakRules,
            breakOverride: approvedBreakOverride(on: workDate),
            isPastDay: workDate < today && workDate != openWorkDate
        )
    }

    /// 承認された「休憩を取れなかった」申請の休憩時間
    func approvedBreakOverride(on workDate: String) -> Int? {
        corrections.first { $0.workDate == workDate && $0.kind == .noBreak && $0.status == .approved }?.requestedBreakMinutes
    }

    /// その日の打刻（最近の打刻になければクラウドから読む）
    func fetchPunches(on workDate: String) async -> [AttendancePunch] {
        let recent = punches(on: workDate)
        if !recent.isEmpty { return recent }
        let snapshot = try? await punchCollection
            .whereField("userId", isEqualTo: uid)
            .whereField("workDate", isEqualTo: workDate)
            .getDocuments()
        return (snapshot?.documents ?? []).compactMap { try? $0.data(as: AttendancePunch.self) }
            .sorted { $0.punchedAt < $1.punchedAt }
    }

    func corrections(on workDate: String) -> [AttendanceCorrection] {
        corrections.filter { $0.workDate == workDate }
    }

    // MARK: - 打刻

    /// 出勤・退勤ボタン。数秒間は取り消せるように、保存を少し待つ。
    func tapPunch() {
        commitPendingNow()
        let now = Date()
        let kind = nextKind
        let workDate = kind == .clockOut ? (openWorkDate ?? today) : today
        pendingPunch = PendingPunch(kind: kind, time: now, workDate: workDate)
        pendingFix = nil

        location.requestAuthorizationIfNeeded()
        location.start()

        commitTask = Task { [weak self] in
            try? await Task.sleep(for: .seconds(Self.undoSeconds))
            guard !Task.isCancelled else { return }
            self?.commitPendingNow()
        }
    }

    func undoPunch() {
        commitTask?.cancel()
        commitTask = nil
        pendingPunch = nil
        pendingFix = nil
        stopLocationIfIdle()
    }

    /// 取り消し待ちの打刻をすぐ保存する（アプリが裏に回るときなど）
    func commitPendingNow() {
        commitTask?.cancel()
        commitTask = nil
        guard let p = pendingPunch else { return }
        pendingPunch = nil

        let ref = punchCollection.document()
        var status: LocationStatus = .pending
        var punchLocation: PunchLocation?
        if location.isDenied {
            status = .denied
        } else if let fix = pendingFix {
            status = .acquired
            punchLocation = PunchLocation(fix, punchedAt: p.time)
        }
        pendingFix = nil

        let punch = AttendancePunch(
            userId: uid,
            workDate: p.workDate,
            month: settings.period.monthKey(forDayKey: p.workDate) ?? String(p.workDate.prefix(7)),
            kind: p.kind,
            punchedAt: p.time,
            location: punchLocation,
            locationStatus: status,
            corrected: false
        )
        do {
            // 電波がなくても端末に保存され、つながったら自動で送信される
            try ref.setData(from: punch)
        } catch {
            print("Punch save error: \(error)")
            return
        }
        if status == .pending {
            acquiring[ref.documentID] = p.time
        } else if status == .acquired, let fix = punchLocation {
            fillAddress(punchId: ref.documentID, location: fix)
        }
        stopLocationIfIdle()
    }

    // MARK: - 位置情報

    /// 位置の精度が十分か。打刻から時間がたつほど条件をゆるめる
    private func isAcceptable(_ fix: CLLocation, punchedAt: Date) -> Bool {
        guard fix.horizontalAccuracy >= 0, fix.timestamp > punchedAt.addingTimeInterval(-60) else { return false }
        let elapsed = Date().timeIntervalSince(punchedAt)
        return fix.horizontalAccuracy <= 100 || (elapsed > 30 && fix.horizontalAccuracy <= 1000)
    }

    private func handle(_ fix: CLLocation) {
        if let p = pendingPunch, pendingFix == nil, isAcceptable(fix, punchedAt: p.time) {
            pendingFix = fix
        }
        for (punchId, punchedAt) in acquiring where isAcceptable(fix, punchedAt: punchedAt) {
            acquiring[punchId] = nil
            let punchLocation = PunchLocation(fix, punchedAt: punchedAt)
            update(punchId, ["location": encode(punchLocation), "locationStatus": LocationStatus.acquired.rawValue])
            fillAddress(punchId: punchId, location: punchLocation)
        }
        stopLocationIfIdle()
    }

    private func handleAuthorizationChange() {
        if location.isAuthorized {
            if pendingPunch != nil || !acquiring.isEmpty { location.start() }
        } else if location.isDenied {
            for punchId in acquiring.keys {
                update(punchId, ["locationStatus": LocationStatus.denied.rawValue])
            }
            acquiring.removeAll()
            location.stop()
        }
    }

    /// 打刻から10分たっても取れなければ「位置なし」
    private func expireLocationRequests() {
        let now = Date()
        for (punchId, punchedAt) in acquiring where now.timeIntervalSince(punchedAt) > Self.locationTimeout {
            acquiring[punchId] = nil
            update(punchId, ["locationStatus": LocationStatus.unavailable.rawValue])
        }
        stopLocationIfIdle()
    }

    /// アプリを開き直したとき：取得中の打刻を引き継ぎ、住所がまだない打刻に住所を入れる
    private func resumeLocationWork() {
        let now = Date()
        for punch in punches {
            guard let id = punch.id else { continue }
            if punch.locationStatus == .pending, acquiring[id] == nil {
                if location.isDenied {
                    update(id, ["locationStatus": LocationStatus.denied.rawValue])
                } else if now.timeIntervalSince(punch.punchedAt) > Self.locationTimeout {
                    update(id, ["locationStatus": LocationStatus.unavailable.rawValue])
                } else {
                    acquiring[id] = punch.punchedAt
                    location.start()
                }
            }
            if punch.locationStatus == .acquired, let loc = punch.location, loc.address == nil, !unsentPunchIds.contains(id) {
                fillAddress(punchId: id, location: loc)
            }
        }
    }

    private func fillAddress(punchId: String, location loc: PunchLocation) {
        guard !geocoded.contains(punchId) else { return }
        geocoded.insert(punchId)
        Task {
            guard let address = await LocationService.address(for: CLLocation(latitude: loc.lat, longitude: loc.lng)) else {
                geocoded.remove(punchId) // 電波がないときは次の機会にもう一度
                return
            }
            var filled = loc
            filled.address = address
            update(punchId, ["location": encode(filled)])
        }
    }

    private func stopLocationIfIdle() {
        if pendingPunch == nil && acquiring.isEmpty { location.stop() }
    }

    private func update(_ punchId: String, _ fields: [String: Any]) {
        punchCollection.document(punchId).updateData(fields) { error in
            if let error { print("Punch update error: \(error)") }
        }
    }

    private func encode(_ location: PunchLocation) -> [String: Any] {
        (try? Firestore.Encoder().encode(location)) ?? [:]
    }

    // MARK: - 修正申請

    func submitCorrection(_ correction: AttendanceCorrection) throws {
        try correctionCollection.document().setData(from: correction)
    }

    func cancelCorrection(_ correction: AttendanceCorrection) {
        guard let id = correction.id, correction.status == .pending else { return }
        correctionCollection.document(id).updateData([
            "status": CorrectionStatus.cancelled.rawValue,
            "cancelledAt": Timestamp(date: Date()),
        ])
    }
}

extension PunchLocation {
    init(_ fix: CLLocation, punchedAt: Date) {
        self.init(
            lat: fix.coordinate.latitude,
            lng: fix.coordinate.longitude,
            accuracy: fix.horizontalAccuracy,
            address: nil,
            // 押す前から取れていた位置は、押した時刻で記録する
            locatedAt: max(fix.timestamp, punchedAt)
        )
    }
}
