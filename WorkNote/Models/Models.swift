import Foundation
import FirebaseFirestore
import WorkNoteCore

// MARK: - ユーザー（users/{uid}）

struct AppUser: Codable {
    var displayName: String?
    var email: String?
    var role: String?
    var createdAt: Date?

    var roleLabel: String { role == "admin" ? "管理者" : "従業員" }
}

// MARK: - 打刻（attendancePunches/{id}）

enum LocationStatus: String, Codable {
    case pending, acquired, unavailable, denied
}

struct PunchLocation: Codable, Equatable {
    var lat: Double
    var lng: Double
    var accuracy: Double
    var address: String?
    var locatedAt: Date
}

struct AttendancePunch: Codable, Identifiable {
    @DocumentID var id: String? = nil
    var userId: String
    var workDate: String
    var month: String
    var kind: PunchKind
    /// 端末の時刻（押した瞬間）
    var punchedAt: Date
    /// サーバーが受け取った時刻
    @ServerTimestamp var receivedAt: Date? = nil
    var location: PunchLocation?
    var locationStatus: LocationStatus
    /// 修正申請の承認で書き換えた打刻
    var corrected: Bool
    /// 以下は管理者が修正したときに残す（アプリからは書かない）
    var originalPunchedAt: Date?
    var correctionId: String?

    var point: PunchPoint { PunchPoint(id: id ?? UUID().uuidString, kind: kind, time: punchedAt) }

    /// 端末の時刻とサーバーが受け取った時刻が大きく（10分以上）ずれているか。
    /// 電波がなく後から送った打刻もここに当たる。
    var hasClockSkew: Bool {
        guard let receivedAt, !corrected else { return false }
        return abs(receivedAt.timeIntervalSince(punchedAt)) > 600
    }

    /// 住所の表示
    var locationLabel: String {
        switch locationStatus {
        case .pending: return "位置を取得中…"
        case .denied: return "位置なし（許可なし）"
        case .unavailable: return "位置なし"
        case .acquired:
            guard let location else { return "位置なし" }
            return location.address ?? String(format: "%.5f, %.5f", location.lat, location.lng)
        }
    }

    /// 「打刻から◯分後に取得」
    var locationDelayLabel: String? {
        guard locationStatus == .acquired, let location else { return nil }
        let minutes = Int(location.locatedAt.timeIntervalSince(punchedAt) / 60)
        return minutes >= 1 ? "打刻から\(minutes)分後に取得" : nil
    }
}

// MARK: - 打刻の修正申請（attendanceCorrections/{id}）

enum CorrectionKind: String, Codable, CaseIterable, Identifiable {
    case missingClockIn, missingClockOut, wrongTime, noBreak

    var id: String { rawValue }

    var label: String {
        switch self {
        case .missingClockIn: "出勤の打刻漏れ"
        case .missingClockOut: "退勤の打刻漏れ"
        case .wrongTime: "時刻の誤り"
        case .noBreak: "休憩を取れなかった"
        }
    }
}

enum CorrectionStatus: String, Codable {
    case pending, approved, rejected, cancelled

    var label: String {
        switch self {
        case .pending: "修正申請中"
        case .approved: "承認済み"
        case .rejected: "却下"
        case .cancelled: "取り消し"
        }
    }
}

struct AttendanceCorrection: Codable, Identifiable {
    @DocumentID var id: String? = nil
    var userId: String
    var workDate: String
    var month: String
    var targetPunchIds: [String]
    var kind: CorrectionKind
    var requestedClockIn: Date?
    var requestedClockOut: Date?
    var requestedBreakMinutes: Int?
    var reason: String
    var status: CorrectionStatus
    var reviewedBy: String?
    var reviewedAt: Date?
    var createdAt: Date
    var cancelledAt: Date?
}

// MARK: - 日報（dailyReports/{id}）

enum ReportStatus: String, Codable {
    case draft, submitted, approved

    var label: String {
        switch self {
        case .draft: "下書き"
        case .submitted: "提出済み"
        case .approved: "承認済み"
        }
    }
}

/// 日報の項目キー（初期の項目）
enum ReportKey {
    static let weather = "weather"
    static let workTime = "workTime"
    static let site = "site"
    static let content = "content"
}

struct DailyReport: Codable, Identifiable {
    @DocumentID var id: String? = nil
    var userId: String
    var date: String
    var month: String
    var status: ReportStatus
    /// 項目キー → 値（訪問先・現場名は site、作業内容は content）
    var values: [String: String]
    var siteIds: [String]
    var photoPaths: [String]
    var createdAt: Date
    var updatedAt: Date
    var submittedAt: Date?

    enum CodingKeys: String, CodingKey {
        case id, userId, date, month, status, values, siteIds, photoPaths, createdAt, updatedAt, submittedAt
    }

    var dateValue: Date? { WorkCalendar.date(fromDayKey: date) }

    /// 一覧・勤怠の備考に出す1行（「訪問先・現場名 ／ 作業内容の1行目」）
    var summaryLine: String {
        let site = values[ReportKey.site]?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let content = values[ReportKey.content]?
            .split(whereSeparator: \.isNewline).first.map(String.init)?
            .trimmingCharacters(in: .whitespaces) ?? ""
        return [site, content].filter { !$0.isEmpty }.joined(separator: " ／ ")
    }
}

struct ReportRevision: Codable, Identifiable {
    @DocumentID var id: String? = nil
    /// 修正前の内容
    var values: [String: String]
    var photoPaths: [String]
    var editedAt: Date
    var editedBy: String

    enum CodingKeys: String, CodingKey {
        case id, values, photoPaths, editedAt, editedBy
    }
}

// MARK: - 日報の保存形式
//
// アプリの中では values を [項目キー: 文字] で扱い、保存するときだけ形を変える。
// 作業時間は Firestore では {start: "08:52", end: "18:05"} の形（試作版のデータと同じ）。
// 足りないフィールドがある古いデータも読めるようにする。

/// values の1つの値
private struct StoredReportValue: Codable {
    var text: String

    private struct Range: Codable {
        var start: String
        var end: String
    }

    init(_ text: String) {
        self.text = text
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if let s = try? c.decode(String.self) {
            text = s
        } else if let r = try? c.decode(Range.self) {
            text = "\(r.start)-\(r.end)"
        } else if let list = try? c.decode([String].self) {
            text = list.joined(separator: "、")
        } else if let n = try? c.decode(Double.self) {
            text = n == n.rounded() ? String(Int(n)) : String(n)
        } else if let b = try? c.decode(Bool.self) {
            text = b ? "はい" : "いいえ"
        } else {
            text = ""
        }
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.singleValueContainer()
        // "08:52-18:05" の形（作業時間）は {start, end} にする。読むときに同じ文字に戻る
        if let range = TimeRange(text), range.raw == text {
            let parts = text.split(separator: "-").map(String.init)
            try c.encode(Range(start: parts[0], end: parts[1]))
        } else {
            try c.encode(text)
        }
    }
}

private func decodeValues<K: CodingKey>(_ c: KeyedDecodingContainer<K>, _ key: K) throws -> [String: String] {
    let stored = try c.decodeIfPresent([String: StoredReportValue].self, forKey: key) ?? [:]
    return stored.mapValues(\.text)
}

private func encodeValues<K: CodingKey>(_ values: [String: String], _ c: inout KeyedEncodingContainer<K>, _ key: K) throws {
    try c.encode(values.mapValues(StoredReportValue.init), forKey: key)
}

extension DailyReport {
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        _id = try c.decode(DocumentID<String>.self, forKey: .id)
        userId = try c.decode(String.self, forKey: .userId)
        date = try c.decode(String.self, forKey: .date)
        month = try c.decodeIfPresent(String.self, forKey: .month) ?? String(date.prefix(7))
        status = try c.decodeIfPresent(ReportStatus.self, forKey: .status) ?? .draft
        values = try decodeValues(c, .values)
        siteIds = try c.decodeIfPresent([String].self, forKey: .siteIds) ?? []
        photoPaths = try c.decodeIfPresent([String].self, forKey: .photoPaths) ?? []
        let updated = try c.decodeIfPresent(Date.self, forKey: .updatedAt)
        createdAt = try c.decodeIfPresent(Date.self, forKey: .createdAt) ?? updated ?? Date()
        updatedAt = updated ?? createdAt
        submittedAt = try c.decodeIfPresent(Date.self, forKey: .submittedAt)
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try c.encode(userId, forKey: .userId)
        try c.encode(date, forKey: .date)
        try c.encode(month, forKey: .month)
        try c.encode(status, forKey: .status)
        try encodeValues(values, &c, .values)
        try c.encode(siteIds, forKey: .siteIds)
        try c.encode(photoPaths, forKey: .photoPaths)
        try c.encode(createdAt, forKey: .createdAt)
        try c.encode(updatedAt, forKey: .updatedAt)
        try c.encodeIfPresent(submittedAt, forKey: .submittedAt)
    }
}

extension ReportRevision {
    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        _id = try c.decode(DocumentID<String>.self, forKey: .id)
        values = try decodeValues(c, .values)
        photoPaths = try c.decodeIfPresent([String].self, forKey: .photoPaths) ?? []
        editedAt = try c.decodeIfPresent(Date.self, forKey: .editedAt) ?? Date()
        editedBy = try c.decodeIfPresent(String.self, forKey: .editedBy) ?? ""
    }

    func encode(to encoder: Encoder) throws {
        var c = encoder.container(keyedBy: CodingKeys.self)
        try encodeValues(values, &c, .values)
        try c.encode(photoPaths, forKey: .photoPaths)
        try c.encode(editedAt, forKey: .editedAt)
        try c.encode(editedBy, forKey: .editedBy)
    }
}

// MARK: - 経費（expenses/{id}）

enum ExpenseStatus: String, Codable {
    case draft, submitted, approved, returned

    var label: String {
        switch self {
        case .draft: "下書き"
        case .submitted: "申請済み"
        case .approved: "承認済み"
        case .returned: "差し戻し"
        }
    }

    /// 本人が修正できるか（承認前）
    var isEditable: Bool { self != .approved }
}

struct Expense: Codable, Identifiable {
    @DocumentID var id: String? = nil
    var userId: String
    var usedOn: String
    var month: String
    var amount: Int
    var vendor: String
    var categoryId: String
    var invoiceNumber: String
    var memo: String
    var receiptPath: String?
    var ocrText: String
    var status: ExpenseStatus
    var createdAt: Date
    var updatedAt: Date?
    var submittedAt: Date?
    /// 差し戻しの理由（管理者が書く）
    var returnReason: String?

    var usedOnDate: Date? { WorkCalendar.date(fromDayKey: usedOn) }
}

// MARK: - 勤務先（sites/{id}）

struct Site: Codable, Identifiable, Hashable {
    @DocumentID var id: String? = nil
    var name: String
    var address: String
    var active: Bool
    var order: Int
}

// MARK: - 設定（settings/*）

/// settings/company
struct CompanySettings: Codable, Equatable {
    var closingDay: Int = 0
    var correctionDeadlineBusinessDays: Int = 3
    var breakRules: [BreakRule] = BreakRule.defaults
    /// 画像を Cloud Storage に送るか（Blaze プランにしたら true にする）。
    /// false の間は、日報の写真・領収書の画像を端末に保存しておく
    var imageUploadEnabled = false

    init() {}

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        closingDay = try c.decodeIfPresent(Int.self, forKey: .closingDay) ?? 0
        correctionDeadlineBusinessDays = try c.decodeIfPresent(Int.self, forKey: .correctionDeadlineBusinessDays) ?? 3
        breakRules = try c.decodeIfPresent([BreakRule].self, forKey: .breakRules) ?? BreakRule.defaults
        imageUploadEnabled = try c.decodeIfPresent(Bool.self, forKey: .imageUploadEnabled) ?? false
    }
}

enum ReportFieldType: String, Codable {
    case date, weather, timeRange, sites, longText, text, photos
}

/// settings/reportTemplate.fields[]
struct ReportField: Codable, Identifiable, Equatable {
    var key: String
    var label: String
    var type: ReportFieldType
    var required: Bool
    var order: Int

    var id: String { key }

    init(key: String, label: String, type: ReportFieldType, required: Bool, order: Int) {
        self.key = key; self.label = label; self.type = type; self.required = required; self.order = order
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        key = try c.decode(String.self, forKey: .key)
        label = try c.decodeIfPresent(String.self, forKey: .label) ?? key
        // 知らない種類は1行テキストとして扱う
        type = (try? c.decode(ReportFieldType.self, forKey: .type)) ?? .text
        required = try c.decodeIfPresent(Bool.self, forKey: .required) ?? false
        order = try c.decodeIfPresent(Int.self, forKey: .order) ?? 0
    }

    static let defaults: [ReportField] = [
        .init(key: "date", label: "日付", type: .date, required: true, order: 1),
        .init(key: ReportKey.weather, label: "天気", type: .weather, required: false, order: 2),
        .init(key: ReportKey.workTime, label: "作業時間", type: .timeRange, required: true, order: 3),
        .init(key: ReportKey.site, label: "訪問先・現場名", type: .sites, required: true, order: 4),
        .init(key: ReportKey.content, label: "作業内容", type: .longText, required: true, order: 5),
        .init(key: "impressions", label: "所感・報告事項", type: .longText, required: false, order: 6),
        .init(key: "tomorrow", label: "明日の予定", type: .longText, required: false, order: 7),
        .init(key: "photos", label: "写真", type: .photos, required: false, order: 8),
    ]
}

struct ReportTemplate: Codable {
    var fields: [ReportField]
}

struct ExpenseCategoryList: Codable {
    var categories: [ExpenseCategory]
}

struct Holiday: Codable, Hashable {
    var date: String
    var name: String
    var kind: String
}

struct HolidayCalendar: Codable {
    var holidays: [Holiday]
}
