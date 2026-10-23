import Foundation

/// 締め日による1か月の区切り。勤怠と経費で共通（settings/company.closingDay）。
/// closingDay = 0 は月末締め（「10月分」= 10/1〜10/31）。
/// closingDay = 20 なら「10月分」= 9/21〜10/20。
public struct ClosingPeriod: Equatable, Sendable {
    public var closingDay: Int

    public init(closingDay: Int = 0) {
        self.closingDay = max(0, min(closingDay, 31))
    }

    /// その日が属する月（"yyyy-MM"）
    public func monthKey(for date: Date) -> String {
        let c = WorkCalendar.calendar.dateComponents([.year, .month, .day], from: date)
        let key = WorkCalendar.monthKey(year: c.year!, month: c.month!)
        guard closingDay > 0 else { return key }
        let end = endDay(year: c.year!, month: c.month!)
        return c.day! > end ? WorkCalendar.shiftMonthKey(key, by: 1) : key
    }

    public func monthKey(forDayKey dayKey: String) -> String? {
        WorkCalendar.date(fromDayKey: dayKey).map(monthKey(for:))
    }

    /// その月の最初の日と最後の日（どちらも 0:00、両端を含む）
    public func dateRange(monthKey: String) -> (start: Date, end: Date)? {
        guard let (y, m) = WorkCalendar.yearMonth(fromMonthKey: monthKey) else { return nil }
        guard let end = WorkCalendar.date(year: y, month: m, day: endDay(year: y, month: m)) else { return nil }
        let prevKey = WorkCalendar.shiftMonthKey(monthKey, by: -1)
        guard let (py, pm) = WorkCalendar.yearMonth(fromMonthKey: prevKey),
              let prevEnd = WorkCalendar.date(year: py, month: pm, day: endDay(year: py, month: pm)) else { return nil }
        return (WorkCalendar.addDays(1, to: prevEnd), end)
    }

    /// その月の日付（0:00）を順に並べたもの
    public func days(monthKey: String) -> [Date] {
        guard let range = dateRange(monthKey: monthKey) else { return [] }
        var days: [Date] = []
        var d = range.start
        while d <= range.end {
            days.append(d)
            d = WorkCalendar.addDays(1, to: d)
        }
        return days
    }

    private func endDay(year: Int, month: Int) -> Int {
        let first = WorkCalendar.date(year: year, month: month, day: 1)!
        let daysInMonth = WorkCalendar.calendar.range(of: .day, in: .month, for: first)!.count
        return closingDay == 0 ? daysInMonth : min(closingDay, daysInMonth)
    }
}
