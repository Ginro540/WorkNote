// WorkNoteCore/WorkCalendar.swift の移植。
// 日付の扱いはいつも日本時間（Asia/Tokyo、+09:00。夏時間はない）。端末のタイムゾーンには左右されない。
// Firestore の workDate / date / usedOn は "yyyy-MM-dd"、month は "yyyy-MM" の文字列。

const JST_OFFSET_MS = 9 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000

const pad2 = (n: number) => String(n).padStart(2, '0')
const pad4 = (n: number) => String(n).padStart(4, '0')

/** 日本時間での年月日・時分・曜日 */
export function jstParts(date: Date) {
  const d = new Date(date.getTime() + JST_OFFSET_MS)
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hour: d.getUTCHours(),
    minute: d.getUTCMinutes(),
    /** 1 = 日曜 … 7 = 土曜（Swift の Calendar と同じ） */
    weekday: d.getUTCDay() + 1,
  }
}

/** "yyyy-MM-dd" */
export function dayKey(date: Date): string {
  const p = jstParts(date)
  return `${pad4(p.year)}-${pad2(p.month)}-${pad2(p.day)}`
}

/** 日本時間の日時。存在しない日付（2/30 など）は null */
export function makeDate(year: number, month: number, day: number, hour = 0, minute = 0): Date | null {
  const utc = Date.UTC(year, month - 1, day, hour, minute)
  const check = new Date(utc)
  if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== day) return null
  return new Date(utc - JST_OFFSET_MS)
}

/** "yyyy-MM-dd" をその日の 0:00 に変換する */
export function dateFromDayKey(key: string): Date | null {
  const parts = key.split('-').map(Number)
  if (parts.length !== 3 || parts.some((n) => !Number.isInteger(n))) return null
  return makeDate(parts[0], parts[1], parts[2])
}

export function monthKeyOf(year: number, month: number): string {
  return `${pad4(year)}-${pad2(month)}`
}

/** "yyyy-MM" → [年, 月] */
export function yearMonth(key: string): [number, number] | null {
  const parts = key.split('-').map(Number)
  if (parts.length !== 2 || parts.some((n) => !Number.isInteger(n)) || parts[1] < 1 || parts[1] > 12) return null
  return [parts[0], parts[1]]
}

export function shiftMonthKey(key: string, months: number): string {
  const ym = yearMonth(key)
  if (!ym) return key
  const index = ym[0] * 12 + (ym[1] - 1) + months
  return monthKeyOf(Math.floor(index / 12), (((index % 12) + 12) % 12) + 1)
}

export function addDays(days: number, date: Date): Date {
  // 日本時間には夏時間がないので、24時間ずつ足せばよい
  return new Date(date.getTime() + days * DAY_MS)
}

export function startOfDay(date: Date): Date {
  return dateFromDayKey(dayKey(date))!
}

/** 1 = 日曜 … 7 = 土曜 */
export function weekday(date: Date): number {
  return jstParts(date).weekday
}

export const weekdaySymbols = ['日', '月', '火', '水', '木', '金', '土']

/** "10/19（月）" */
export function shortDayLabel(date: Date): string {
  const p = jstParts(date)
  return `${p.month}/${p.day}（${weekdaySymbols[p.weekday - 1]}）`
}

/** "yyyy-MM-dd" → "10/19（月）" */
export function shortDayLabelFromKey(key: string): string {
  const d = dateFromDayKey(key)
  return d ? shortDayLabel(d) : key
}

/** "HH:mm" */
export function timeLabel(date: Date): string {
  const p = jstParts(date)
  return `${pad2(p.hour)}:${pad2(p.minute)}`
}

/** 分 → "h:mm" */
export function durationLabel(minutes: number): string {
  const sign = minutes < 0 ? '-' : ''
  const m = Math.abs(minutes)
  return `${sign}${Math.floor(m / 60)}:${pad2(m % 60)}`
}

/** "2026-10" → "2026年10月" */
export function monthLabel(key: string): string {
  const ym = yearMonth(key)
  return ym ? `${ym[0]}年${ym[1]}月` : key
}

/** "2026/10/19 08:57" */
export function dateTimeLabel(date: Date): string {
  const p = jstParts(date)
  return `${p.year}/${p.month}/${p.day} ${pad2(p.hour)}:${pad2(p.minute)}`
}
