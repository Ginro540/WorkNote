import Foundation

public enum PunchKind: String, Codable, Sendable {
    case clockIn = "in"
    case clockOut = "out"

    public var label: String { self == .clockIn ? "出勤" : "退勤" }
}

/// 計算に使う打刻
public struct PunchPoint: Equatable, Sendable {
    public var id: String
    public var kind: PunchKind
    public var time: Date

    public init(id: String, kind: PunchKind, time: Date) {
        self.id = id
        self.kind = kind
        self.time = time
    }
}

/// 出勤から退勤までの1回の勤務。どちらかが欠けていれば打刻漏れ。
public struct WorkSession: Equatable, Sendable {
    public var clockIn: PunchPoint?
    public var clockOut: PunchPoint?

    public var minutes: Int? {
        guard let i = clockIn, let o = clockOut else { return nil }
        return max(0, Int(o.time.timeIntervalSince(i.time) / 60))
    }
}

/// 休憩のルール：拘束時間が overMinutes を超えたら breakMinutes の休憩が必要
public struct BreakRule: Codable, Equatable, Sendable {
    public var overMinutes: Int
    public var breakMinutes: Int

    public init(overMinutes: Int, breakMinutes: Int) {
        self.overMinutes = overMinutes
        self.breakMinutes = breakMinutes
    }

    /// 労働基準法 第34条に合わせた初期値（6:00 超 → 45分、8:45 超 → 60分）
    public static let defaults = [
        BreakRule(overMinutes: 360, breakMinutes: 45),
        BreakRule(overMinutes: 525, breakMinutes: 60),
    ]
}

public enum DayStatus: Equatable, Sendable {
    case off            // 打刻なし
    case working        // 勤務中
    case finished       // 退勤済み
    case missingPunch   // 退勤漏れ・出勤漏れ（過去日で勤務が閉じていない）

    public var label: String {
        switch self {
        case .off: "休み"
        case .working: "勤務中"
        case .finished: "退勤済み"
        case .missingPunch: "退勤漏れ"
        }
    }
}

/// 1日分の集計
public struct DaySummary: Equatable, Sendable {
    public var sessions: [WorkSession]
    public var status: DayStatus
    public var firstIn: Date?
    public var lastOut: Date?
    /// 拘束時間（最後の退勤 − 最初の出勤）
    public var spanMinutes: Int?
    /// 中抜け（退勤と次の出勤の間）
    public var gapMinutes: Int?
    /// 必要な休憩
    public var requiredBreakMinutes: Int?
    /// 自動で差し引く休憩（「休憩を取れなかった」の承認があればその値）
    public var deductedBreakMinutes: Int?
    /// 実働時間
    public var workMinutes: Int?
    /// 1日8時間を超えた分
    public var overtimeMinutes: Int?

    public var sessionCount: Int { sessions.count }
}

public enum AttendanceCalculator {
    public static let overtimeThresholdMinutes = 8 * 60

    /// 打刻を時刻順に並べ、出勤〜退勤の組にする
    public static func sessions(from punches: [PunchPoint]) -> [WorkSession] {
        var result: [WorkSession] = []
        var open: WorkSession?
        for punch in punches.sorted(by: { $0.time < $1.time }) {
            switch punch.kind {
            case .clockIn:
                if let o = open { result.append(o) }   // 退勤漏れのまま次の出勤
                open = WorkSession(clockIn: punch, clockOut: nil)
            case .clockOut:
                if var o = open {
                    o.clockOut = punch
                    result.append(o)
                    open = nil
                } else {
                    result.append(WorkSession(clockIn: nil, clockOut: punch)) // 出勤漏れ
                }
            }
        }
        if let o = open { result.append(o) }
        return result
    }

    public static func requiredBreak(spanMinutes: Int, rules: [BreakRule]) -> Int {
        rules.filter { spanMinutes > $0.overMinutes }.map(\.breakMinutes).max() ?? 0
    }

    /// - Parameters:
    ///   - isPastDay: 今日より前の勤務日か（閉じていない勤務を「退勤漏れ」とする）
    ///   - breakOverride: 承認された「休憩を取れなかった」申請の休憩時間
    public static func summarize(
        punches: [PunchPoint],
        rules: [BreakRule] = BreakRule.defaults,
        breakOverride: Int? = nil,
        isPastDay: Bool = false
    ) -> DaySummary {
        let sessions = sessions(from: punches)
        var summary = DaySummary(sessions: sessions, status: .off)
        guard !sessions.isEmpty else { return summary }

        summary.firstIn = sessions.compactMap { $0.clockIn?.time }.min()
        summary.lastOut = sessions.compactMap { $0.clockOut?.time }.max()

        let complete = sessions.allSatisfy { $0.clockIn != nil && $0.clockOut != nil }
        if !complete {
            let onlyLastOpen = sessions.dropLast().allSatisfy { $0.clockIn != nil && $0.clockOut != nil }
                && sessions.last?.clockIn != nil && sessions.last?.clockOut == nil
            summary.status = (onlyLastOpen && !isPastDay) ? .working : .missingPunch
            return summary
        }
        summary.status = .finished

        let first = summary.firstIn!, last = summary.lastOut!
        let span = max(0, Int(last.timeIntervalSince(first) / 60))
        let worked = sessions.compactMap(\.minutes).reduce(0, +)
        let gap = max(0, span - worked)
        let required = requiredBreak(spanMinutes: span, rules: rules)
        let deducted = breakOverride ?? max(0, required - gap)
        let work = max(0, worked - deducted)

        summary.spanMinutes = span
        summary.gapMinutes = gap
        summary.requiredBreakMinutes = required
        summary.deductedBreakMinutes = deducted
        summary.workMinutes = work
        summary.overtimeMinutes = max(0, work - overtimeThresholdMinutes)
        return summary
    }
}
