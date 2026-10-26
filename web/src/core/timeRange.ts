// 日報の作業時間（"08:52-18:05"）。Firestore には {start: "08:52", end: "18:05"} の形で保存する。

import { durationLabel, jstParts, startOfDay } from './workCalendar'

const pad2 = (n: number) => String(n).padStart(2, '0')
const hm = (minutes: number) => `${pad2(Math.floor(minutes / 60) % 24)}:${pad2(minutes % 60)}`

export interface TimeRange {
  /** 0:00 からの分 */
  start: number
  end: number
}

export function parseTimeRange(raw: string | null | undefined): TimeRange | null {
  const m = /^(\d{2}):(\d{2})-(\d{2}):(\d{2})$/.exec(raw ?? '')
  if (!m) return null
  return { start: Number(m[1]) * 60 + Number(m[2]), end: Number(m[3]) * 60 + Number(m[4]) }
}

/** 出勤・退勤の時刻から（翌日にまたがるときは end が 1440 以上） */
export function timeRangeFromDates(start: Date, end: Date): TimeRange {
  const s = jstParts(start)
  const e = jstParts(end)
  const dayOffset = Math.round((startOfDay(end).getTime() - startOfDay(start).getTime()) / 86_400_000)
  return { start: s.hour * 60 + s.minute, end: dayOffset * 1440 + e.hour * 60 + e.minute }
}

/** 終了が開始より前なら日付をまたいだとみなす */
export const timeRangeMinutes = (r: TimeRange) => (r.end >= r.start ? r.end - r.start : r.end + 1440 - r.start)

export const timeRangeRaw = (r: TimeRange) => `${hm(r.start)}-${hm(r.end)}`

/** "08:52〜18:05（9:13）" */
export const timeRangeLabel = (r: TimeRange) => `${hm(r.start)}〜${hm(r.end)}（${durationLabel(timeRangeMinutes(r))}）`

/** 保存するときの values の形（作業時間だけ {start, end} にする） */
export function encodeValues(values: Record<string, string>): Record<string, string | { start: string; end: string }> {
  return Object.fromEntries(
    Object.entries(values).map(([k, v]) => {
      const r = parseTimeRange(v)
      if (r && timeRangeRaw(r) === v) {
        const [start, end] = v.split('-')
        return [k, { start, end }]
      }
      return [k, v]
    }),
  )
}
