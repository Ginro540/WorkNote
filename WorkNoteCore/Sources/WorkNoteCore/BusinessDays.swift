import Foundation

/// 営業日（土日・祝日・会社の休業日を除いた日）の計算。
public struct BusinessDays: Sendable {
    /// 休日の "yyyy-MM-dd"（祝日と会社の休業日）
    public var holidays: Set<String>

    public init(holidays: Set<String>) {
        self.holidays = holidays
    }

    public func isBusinessDay(_ date: Date) -> Bool {
        let weekday = WorkCalendar.weekday(date)
        return weekday != 1 && weekday != 7 && !holidays.contains(WorkCalendar.dayKey(date))
    }

    /// 修正申請の期限：締め日の翌日から数えて n 番目の営業日（この日まで申請できる）
    public func correctionDeadline(monthKey: String, period: ClosingPeriod, businessDays: Int) -> Date? {
        guard let range = period.dateRange(monthKey: monthKey) else { return nil }
        var d = range.end
        var count = 0
        while count < max(businessDays, 1) {
            d = WorkCalendar.addDays(1, to: d)
            if isBusinessDay(d) { count += 1 }
        }
        return d
    }

    /// 今日がまだ期限内か
    public func canRequestCorrection(monthKey: String, period: ClosingPeriod, businessDays: Int, today: Date) -> Bool {
        guard let deadline = correctionDeadline(monthKey: monthKey, period: period, businessDays: businessDays) else { return false }
        return WorkCalendar.startOfDay(today) <= deadline
    }
}
