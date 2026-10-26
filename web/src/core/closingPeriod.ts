// WorkNoteCore/ClosingPeriod.swift と BusinessDays.swift の移植。
// 締め日による1か月の区切り。勤怠と経費で共通（settings/company.closingDay）。
// closingDay = 0 は月末締め（「10月分」= 10/1〜10/31）。closingDay = 20 なら「10月分」= 9/21〜10/20。

import { addDays, dateFromDayKey, dayKey, jstParts, makeDate, monthKeyOf, shiftMonthKey, startOfDay, weekday, yearMonth } from './workCalendar'

export class ClosingPeriod {
  readonly closingDay: number

  constructor(closingDay = 0) {
    this.closingDay = Math.max(0, Math.min(closingDay, 31))
  }

  /** その日が属する月（"yyyy-MM"） */
  monthKey(date: Date): string {
    const p = jstParts(date)
    const key = monthKeyOf(p.year, p.month)
    if (this.closingDay <= 0) return key
    return p.day > this.endDay(p.year, p.month) ? shiftMonthKey(key, 1) : key
  }

  monthKeyForDayKey(key: string): string | null {
    const d = dateFromDayKey(key)
    return d ? this.monthKey(d) : null
  }

  /** その月の最初の日と最後の日（どちらも 0:00、両端を含む） */
  dateRange(monthKey: string): { start: Date; end: Date } | null {
    const ym = yearMonth(monthKey)
    if (!ym) return null
    const end = makeDate(ym[0], ym[1], this.endDay(ym[0], ym[1]))
    const prev = yearMonth(shiftMonthKey(monthKey, -1))
    if (!end || !prev) return null
    const prevEnd = makeDate(prev[0], prev[1], this.endDay(prev[0], prev[1]))
    if (!prevEnd) return null
    return { start: addDays(1, prevEnd), end }
  }

  /** その月の日付（0:00）を順に並べたもの */
  days(monthKey: string): Date[] {
    const range = this.dateRange(monthKey)
    if (!range) return []
    const days: Date[] = []
    for (let d = range.start; d <= range.end; d = addDays(1, d)) days.push(d)
    return days
  }

  /** その月の "yyyy-MM-dd" を順に並べたもの */
  dayKeys(monthKey: string): string[] {
    return this.days(monthKey).map(dayKey)
  }

  private endDay(year: number, month: number): number {
    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate()
    return this.closingDay === 0 ? daysInMonth : Math.min(this.closingDay, daysInMonth)
  }
}

/** 営業日（土日・祝日・会社の休業日を除いた日）の計算 */
export class BusinessDays {
  /** 休日の "yyyy-MM-dd"（祝日と会社の休業日） */
  readonly holidays: Set<string>

  constructor(holidays: Iterable<string>) {
    this.holidays = new Set(holidays)
  }

  isBusinessDay(date: Date): boolean {
    const w = weekday(date)
    return w !== 1 && w !== 7 && !this.holidays.has(dayKey(date))
  }

  /** 修正申請の期限：締め日の翌日から数えて n 番目の営業日（この日まで申請できる） */
  correctionDeadline(monthKey: string, period: ClosingPeriod, businessDays: number): Date | null {
    const range = period.dateRange(monthKey)
    if (!range) return null
    let d = range.end
    let count = 0
    while (count < Math.max(businessDays, 1)) {
      d = addDays(1, d)
      if (this.isBusinessDay(d)) count += 1
    }
    return d
  }

  /** 今日がまだ期限内か */
  canRequestCorrection(monthKey: string, period: ClosingPeriod, businessDays: number, today: Date): boolean {
    const deadline = this.correctionDeadline(monthKey, period, businessDays)
    if (!deadline) return false
    return startOfDay(today) <= deadline
  }
}
