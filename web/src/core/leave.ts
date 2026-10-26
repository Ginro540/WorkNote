// 休暇の申請で使う計算：申請できる日の判定、月の日数の集計、まとめて申請した日の書き方

import type { LeaveKind, LeaveRequest } from '../data/models'
import { isHalfDayLeave, leaveDays } from '../data/models'
import { addDays, dateFromDayKey, dayKey, jstParts, makeDate, shortDayLabelFromKey, weekday } from './workCalendar'

/** 申請できる日の判定に使う情報 */
export interface LeaveDayContext {
  /** 今日（"yyyy-MM-dd"） */
  today: string
  /** 祝日・会社の休業日か */
  isHoliday: (dayKey: string) => boolean
  /** その日に申請中・承認済みの休暇があるか */
  hasActiveLeave: (dayKey: string) => boolean
  /** その日の月の修正申請の期限内か（今日と過去の日に使う） */
  canRequestCorrection: (dayKey: string) => boolean
}

export type LeaveDayCheck =
  | 'ok'
  /** 土日・休業日（欠勤だけは選べる） */
  | 'dayOff'
  /** すでに申請中・承認済みの休暇がある */
  | 'alreadyRequested'
  /** 修正申請の期限を過ぎた月 */
  | 'pastDeadline'
  /** 1年より先 */
  | 'tooFar'
  | 'invalid'

/** 1年後の日（"yyyy-MM-dd"）。2/29 は 2/28 にする */
export function oneYearLater(today: string): string {
  const p = jstParts(dateFromDayKey(today)!)
  const d = makeDate(p.year + 1, p.month, p.day) ?? makeDate(p.year + 1, p.month, p.day - 1)!
  return dayKey(d)
}

/** その日を休暇として申請できるか */
export function checkLeaveDay(day: string, kind: LeaveKind, ctx: LeaveDayContext): LeaveDayCheck {
  const date = dateFromDayKey(day)
  if (!date) return 'invalid'
  if (ctx.hasActiveLeave(day)) return 'alreadyRequested'
  const w = weekday(date)
  if (kind !== 'absence' && (w === 1 || w === 7 || ctx.isHoliday(day))) return 'dayOff'
  if (day > oneYearLater(ctx.today)) return 'tooFar'
  if (day <= ctx.today && !ctx.canRequestCorrection(day)) return 'pastDeadline'
  return 'ok'
}

export const leaveDayCheckMessage: Record<Exclude<LeaveDayCheck, 'ok'>, string> = {
  dayOff: '土日・休業日は申請できません（欠勤を除く）。',
  alreadyRequested: 'すでに申請済みの日です。',
  pastDeadline: 'この月の申請の期限を過ぎています。管理者に連絡してください。',
  tooFar: '申請できるのは1年先までです。',
  invalid: '日付が正しくありません。',
}

/** 全日の休暇か（その日に打刻があれば確かめる） */
export const isFullDayLeave = (kind: LeaveKind) => !isHalfDayLeave(kind)

export interface LeaveTotals {
  paid: number
  special: number
  absence: number
}

/** 月の集計：承認された休暇だけを数える。半休は0.5日 */
export function leaveTotals(leaves: LeaveRequest[], dayKeys: string[]): LeaveTotals {
  const days = new Set(dayKeys)
  const totals: LeaveTotals = { paid: 0, special: 0, absence: 0 }
  for (const l of leaves) {
    if (l.status !== 'approved' || !days.has(l.date)) continue
    if (l.kind === 'special') totals.special += leaveDays(l.kind)
    else if (l.kind === 'absence') totals.absence += leaveDays(l.kind)
    else totals.paid += leaveDays(l.kind)
  }
  return totals
}

/** 日数の表示（0.5 → "0.5"、2 → "2"） */
export const daysLabel = (n: number) => (Number.isInteger(n) ? String(n) : n.toFixed(1))

/**
 * まとめて申請した日の書き方。
 * 続いた日は「10/28（火）〜10/30（木）」、とびとびの日は「10/28, 10/31」
 */
export function leaveDatesLabel(dates: string[]): string {
  const sorted = [...new Set(dates)].sort()
  if (sorted.length === 0) return ''
  if (sorted.length === 1) return shortDayLabelFromKey(sorted[0])
  const consecutive = sorted.every((d, i) => i === 0 || dayKey(addDays(1, dateFromDayKey(sorted[i - 1])!)) === d)
  if (consecutive) return `${shortDayLabelFromKey(sorted[0])}〜${shortDayLabelFromKey(sorted[sorted.length - 1])}`
  return sorted
    .map((d) => {
      const p = jstParts(dateFromDayKey(d)!)
      return `${p.month}/${p.day}`
    })
    .join(', ')
}
