import Foundation

/// 日付の扱いをそろえるためのカレンダー（日本時間・グレゴリオ暦）。
/// Firestore の workDate / date / usedOn は "yyyy-MM-dd"、month は "yyyy-MM" の文字列で保存する。
public enum WorkCalendar {
    public static let timeZone = TimeZone(identifier: "Asia/Tokyo")!

    public static let calendar: Calendar = {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone
        calendar.locale = Locale(identifier: "ja_JP")
        return calendar
    }()

    /// "yyyy-MM-dd"
    public static func dayKey(_ date: Date) -> String {
        let c = calendar.dateComponents([.year, .month, .day], from: date)
        return String(format: "%04d-%02d-%02d", c.year!, c.month!, c.day!)
    }

    /// "yyyy-MM-dd" をその日の 0:00 に変換する。
    public static func date(fromDayKey key: String) -> Date? {
        let parts = key.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 3 else { return nil }
        return date(year: parts[0], month: parts[1], day: parts[2])
    }

    public static func date(year: Int, month: Int, day: Int, hour: Int = 0, minute: Int = 0) -> Date? {
        var c = DateComponents()
        c.year = year; c.month = month; c.day = day; c.hour = hour; c.minute = minute
        guard let date = calendar.date(from: c) else { return nil }
        // 2/30 などの存在しない日付を弾く
        let check = calendar.dateComponents([.year, .month, .day], from: date)
        guard check.year == year, check.month == month, check.day == day else { return nil }
        return date
    }

    public static func monthKey(year: Int, month: Int) -> String {
        String(format: "%04d-%02d", year, month)
    }

    /// "yyyy-MM" → (年, 月)
    public static func yearMonth(fromMonthKey key: String) -> (year: Int, month: Int)? {
        let parts = key.split(separator: "-").compactMap { Int($0) }
        guard parts.count == 2, (1...12).contains(parts[1]) else { return nil }
        return (parts[0], parts[1])
    }

    public static func shiftMonthKey(_ key: String, by months: Int) -> String {
        guard let (y, m) = yearMonth(fromMonthKey: key) else { return key }
        let index = y * 12 + (m - 1) + months
        return monthKey(year: index / 12, month: index % 12 + 1)
    }

    public static func addDays(_ days: Int, to date: Date) -> Date {
        calendar.date(byAdding: .day, value: days, to: date)!
    }

    public static func startOfDay(_ date: Date) -> Date {
        calendar.startOfDay(for: date)
    }

    /// 1 = 日曜 … 7 = 土曜
    public static func weekday(_ date: Date) -> Int {
        calendar.component(.weekday, from: date)
    }

    public static let weekdaySymbols = ["日", "月", "火", "水", "木", "金", "土"]

    /// "10/19（月）"
    public static func shortDayLabel(_ date: Date) -> String {
        let c = calendar.dateComponents([.month, .day, .weekday], from: date)
        return "\(c.month!)/\(c.day!)（\(weekdaySymbols[c.weekday! - 1])）"
    }

    /// "HH:mm"
    public static func timeLabel(_ date: Date) -> String {
        let c = calendar.dateComponents([.hour, .minute], from: date)
        return String(format: "%02d:%02d", c.hour!, c.minute!)
    }

    /// 分 → "h:mm"
    public static func durationLabel(minutes: Int) -> String {
        let sign = minutes < 0 ? "-" : ""
        let m = abs(minutes)
        return String(format: "%@%d:%02d", sign, m / 60, m % 60)
    }
}
