import UIKit
import Observation
import FirebaseFirestore
import WorkNoteCore

/// 日報の作成・編集画面で入力中の内容
struct ReportDraft {
    var date: Date
    var values: [String: String]
    var siteIds: [String]
    /// 一覧にない現場（手入力）
    var manualSites: [String]
    var photoPaths: [String]
    var newPhotos: [UIImage] = []
}

enum ReportError: LocalizedError {
    case duplicate(String)
    case missing([String])
    case approved

    var errorDescription: String? {
        switch self {
        case .duplicate(let date): "\(date) の日報はすでにあります。日報は1日1件です。"
        case .missing(let labels): "必須の項目が入力されていません：\(labels.joined(separator: "、"))"
        case .approved: "承認済みの日報は修正できません。"
        }
    }
}

@Observable @MainActor
final class ReportStore {
    let uid: String
    let settings: SettingsStore

    /// 日付の新しい順
    private(set) var reports: [DailyReport] = []
    private(set) var unsentIds: Set<String> = []
    @ObservationIgnored private var listener: ListenerRegistration?

    init(uid: String, settings: SettingsStore) {
        self.uid = uid
        self.settings = settings
    }

    var collection: CollectionReference { Firestore.db.collection("dailyReports") }

    func start() {
        listener = collection.whereField("userId", isEqualTo: uid).listen(DailyReport.self) { [weak self] items, pending in
            self?.reports = items.sorted { $0.date > $1.date }
            self?.unsentIds = pending
        }
    }

    func stop() {
        listener?.remove()
        listener = nil
    }

    func report(on date: String) -> DailyReport? {
        reports.first { $0.date == date }
    }

    func report(id: String) -> DailyReport? {
        reports.first { $0.id == id }
    }

    /// 日報の ID は「{uid}_{日付}」（1日1件）
    func reportId(for date: Date) -> String {
        "\(uid)_\(WorkCalendar.dayKey(date))"
    }

    /// 入力内容を日報の形にする
    func draft(from report: DailyReport?, date: Date = Date()) -> ReportDraft {
        guard let report else {
            return ReportDraft(date: date, values: [:], siteIds: [], manualSites: [], photoPaths: [])
        }
        let selectedNames = Set(report.siteIds.compactMap { settings.site(id: $0)?.name })
        let names = (report.values[ReportKey.site] ?? "")
            .components(separatedBy: "、").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
        return ReportDraft(
            date: report.dateValue ?? date,
            values: report.values,
            siteIds: report.siteIds,
            manualSites: names.filter { !selectedNames.contains($0) },
            photoPaths: report.photoPaths
        )
    }

    /// 必須で空の項目
    func missingRequiredFields(_ draft: ReportDraft) -> [String] {
        settings.template.filter(\.required).filter { field in
            switch field.type {
            case .date: return false
            case .sites: return draft.siteIds.isEmpty && draft.manualSites.isEmpty
            case .photos: return draft.photoPaths.isEmpty && draft.newPhotos.isEmpty
            case .timeRange: return TimeRange(draft.values[field.key]) == nil
            default: return (draft.values[field.key] ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            }
        }.map(\.label)
    }

    /// 保存する。submit = true なら提出（必須項目をチェック）。
    /// 提出済みの日報を直したときは、修正前の内容を修正履歴に残す。
    func save(_ draft: ReportDraft, reportId: String, existing: DailyReport?, submit: Bool) throws {
        if existing?.status == .approved { throw ReportError.approved }
        // 新しい日報は、選んだ日付から ID を決める（作成後は日付を変えられない）
        let docId = existing == nil ? self.reportId(for: draft.date) : reportId
        let dateKey = WorkCalendar.dayKey(draft.date)
        if reports.contains(where: { $0.date == dateKey && $0.id != docId }) {
            throw ReportError.duplicate(WorkCalendar.shortDayLabel(draft.date))
        }
        let willBeSubmitted = submit || existing?.status == .submitted
        if willBeSubmitted {
            let missing = missingRequiredFields(draft)
            if !missing.isEmpty { throw ReportError.missing(missing) }
        }

        // 写真は縮小して端末に保存し、裏で順番に送る
        var paths = draft.photoPaths
        var n = paths.compactMap { Int(($0 as NSString).lastPathComponent.replacingOccurrences(of: ".jpg", with: "")) }.max() ?? 0
        for image in draft.newPhotos {
            guard let data = ImageProcessing.reportPhoto(image) else { continue }
            n += 1
            let path = "reports/\(uid)/\(docId)/\(n).jpg"
            try UploadQueue.shared.enqueue(data, path: path)
            paths.append(path)
        }

        var values = draft.values.filter { !$0.value.isEmpty }
        let siteNames = draft.siteIds.compactMap { settings.site(id: $0)?.name } + draft.manualSites
        values[ReportKey.site] = siteNames.isEmpty ? nil : siteNames.joined(separator: "、")

        let now = Date()
        let report = DailyReport(
            userId: uid,
            date: dateKey,
            month: settings.period.monthKey(for: draft.date),
            status: willBeSubmitted ? .submitted : .draft,
            values: values,
            siteIds: draft.siteIds,
            photoPaths: paths,
            createdAt: existing?.createdAt ?? now,
            updatedAt: now,
            submittedAt: existing?.submittedAt ?? (submit ? now : nil)
        )

        let ref = collection.document(docId)
        let batch = Firestore.db.batch()
        if let existing, existing.status == .submitted,
           existing.values != report.values || existing.photoPaths != report.photoPaths || existing.date != report.date {
            var before = existing.values
            if existing.date != report.date { before["date"] = existing.date }
            let revision = ReportRevision(values: before, photoPaths: existing.photoPaths, editedAt: now, editedBy: uid)
            try batch.setData(from: revision, forDocument: ref.collection("revisions").document())
        }
        try batch.setData(from: report, forDocument: ref)
        // 電波がなくても端末に保存され、つながったら自動で送信される
        batch.commit { error in
            if let error { print("Report save error: \(error)") }
        }
    }

    func deleteDraft(_ report: DailyReport) {
        guard let id = report.id, report.status == .draft else { return }
        collection.document(id).delete()
    }

    func revisionsQuery(reportId: String) -> Query {
        collection.document(reportId).collection("revisions")
    }
}

/// 作業時間（"08:52-18:05"）
struct TimeRange: Equatable {
    var start: Int  // 0:00 からの分
    var end: Int

    init(start: Int, end: Int) {
        self.start = start
        self.end = end
    }

    init?(_ raw: String?) {
        let parts = (raw ?? "").split(separator: "-").map { $0.split(separator: ":").compactMap { Int($0) } }
        guard parts.count == 2, parts[0].count == 2, parts[1].count == 2 else { return nil }
        start = parts[0][0] * 60 + parts[0][1]
        end = parts[1][0] * 60 + parts[1][1]
    }

    init(start: Date, end: Date) {
        let c = WorkCalendar.calendar
        let s = c.dateComponents([.hour, .minute], from: start)
        self.start = s.hour! * 60 + s.minute!
        let dayOffset = c.dateComponents([.day], from: c.startOfDay(for: start), to: c.startOfDay(for: end)).day ?? 0
        let e = c.dateComponents([.hour, .minute], from: end)
        self.end = dayOffset * 1440 + e.hour! * 60 + e.minute!
    }

    /// 終了が開始より前なら日付をまたいだとみなす
    var minutes: Int {
        end >= start ? end - start : end + 1440 - start
    }

    var raw: String {
        String(format: "%02d:%02d-%02d:%02d", start / 60, start % 60, (end / 60) % 24, end % 60)
    }

    var label: String {
        String(format: "%02d:%02d〜%02d:%02d（%@）", start / 60, start % 60, (end / 60) % 24, end % 60,
               WorkCalendar.durationLabel(minutes: minutes))
    }
}
