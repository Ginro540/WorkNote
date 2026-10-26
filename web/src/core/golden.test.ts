// Swift の WorkNoteCore で計算した結果（golden.json、tools/core-golden で作る）と同じになるか
import { describe, expect, test } from 'vitest'
import golden from './golden.json'
import { summarize, type BreakRule, type PunchKind } from './attendance'
import { BusinessDays, ClosingPeriod } from './closingPeriod'
import { dayKey, weekday } from './workCalendar'

const t = (d: Date | null) => (d ? d.getTime() : null)

describe('勤怠の集計が Swift と同じ', () => {
  test(`${golden.attendance.length} 件`, () => {
    for (const c of golden.attendance) {
      const punches = c.punches.map((p) => ({ id: p.id, kind: p.kind as PunchKind, time: new Date(p.time) }))
      const s = summarize(punches, c.rules as BreakRule[], c.breakOverride, c.isPastDay)
      const actual = {
        status: s.status,
        sessions: s.sessions.map((x) => [x.clockIn?.id ?? null, x.clockOut?.id ?? null]),
        firstIn: t(s.firstIn),
        lastOut: t(s.lastOut),
        spanMinutes: s.spanMinutes,
        gapMinutes: s.gapMinutes,
        requiredBreakMinutes: s.requiredBreakMinutes,
        deductedBreakMinutes: s.deductedBreakMinutes,
        workMinutes: s.workMinutes,
        overtimeMinutes: s.overtimeMinutes,
      }
      expect(actual, JSON.stringify(c.punches)).toEqual(c.expected)
    }
  })
})

describe('締め日・日付が Swift と同じ', () => {
  for (const p of golden.periods) {
    test(`締め日 ${p.closingDay}`, () => {
      const period = new ClosingPeriod(p.closingDay)
      for (const m of p.monthKeys) {
        const d = new Date(m.time)
        expect(period.monthKey(d)).toBe(m.monthKey)
        expect(dayKey(d)).toBe(m.dayKey)
        expect(weekday(d)).toBe(m.weekday)
      }
      for (const r of p.ranges) {
        const range = period.dateRange(r.monthKey)!
        expect([dayKey(range.start), dayKey(range.end), period.days(r.monthKey).length]).toEqual([r.start, r.end, r.count])
      }
    })
  }
})

describe('修正申請の期限が Swift と同じ', () => {
  test(`${golden.deadlines.length} 件`, () => {
    for (const c of golden.deadlines) {
      const d = new BusinessDays(c.holidays).correctionDeadline(c.monthKey, new ClosingPeriod(c.closingDay), c.businessDays)!
      expect(dayKey(d), JSON.stringify(c)).toBe(c.deadline)
    }
  })
})
