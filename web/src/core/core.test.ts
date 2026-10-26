// WorkNoteCoreTests.swift の移植（仕様書の例）
import { describe, expect, test } from 'vitest'
import { summarize, type PunchKind, type PunchPoint } from './attendance'
import { BusinessDays, ClosingPeriod } from './closingPeriod'
import { dayKey, makeDate } from './workCalendar'

const jst = (y: number, mo: number, d: number, h = 0, mi = 0) => makeDate(y, mo, d, h, mi)!
let seq = 0
const punch = (kind: PunchKind, h: number, m: number, day = 14): PunchPoint => ({ id: `p${seq++}`, kind, time: jst(2026, 10, day, h, m) })

describe('締め日', () => {
  test('月末', () => {
    const p = new ClosingPeriod(0)
    expect(p.monthKey(jst(2026, 10, 31, 23, 59))).toBe('2026-10')
    expect(p.monthKey(jst(2026, 11, 1))).toBe('2026-11')
    const r = p.dateRange('2026-10')!
    expect(dayKey(r.start)).toBe('2026-10-01')
    expect(dayKey(r.end)).toBe('2026-10-31')
    expect(p.days('2026-02').length).toBe(28)
  })
  test('20日', () => {
    const p = new ClosingPeriod(20)
    expect(p.monthKey(jst(2026, 10, 20))).toBe('2026-10')
    expect(p.monthKey(jst(2026, 10, 21))).toBe('2026-11')
    expect(p.monthKey(jst(2026, 12, 25))).toBe('2027-01')
    const r = p.dateRange('2026-10')!
    expect(dayKey(r.start)).toBe('2026-09-21')
    expect(dayKey(r.end)).toBe('2026-10-20')
  })
})

test('修正申請の期限（仕様書の例：10月分は 11/5 まで）', () => {
  const b = new BusinessDays(['2026-11-03'])
  expect(dayKey(b.correctionDeadline('2026-10', new ClosingPeriod(), 3)!)).toBe('2026-11-05')
  expect(b.canRequestCorrection('2026-10', new ClosingPeriod(), 3, jst(2026, 11, 5, 23, 0))).toBe(true)
  expect(b.canRequestCorrection('2026-10', new ClosingPeriod(), 3, jst(2026, 11, 6))).toBe(false)
})

describe('勤怠', () => {
  test('2回勤務（中抜け2時間）', () => {
    const s = summarize([punch('in', 8, 30), punch('out', 12, 0), punch('in', 14, 0), punch('out', 19, 0)])
    expect(s.status).toBe('finished')
    expect(s.sessions.length).toBe(2)
    expect([s.spanMinutes, s.gapMinutes, s.deductedBreakMinutes, s.workMinutes, s.overtimeMinutes]).toEqual([630, 120, 0, 510, 30])
  })
  test('仕様書の行', () => {
    const a = summarize([punch('in', 9, 0), punch('out', 14, 30)])
    expect([a.workMinutes, a.deductedBreakMinutes]).toEqual([330, 0])
    const b = summarize([punch('in', 8, 52), punch('out', 18, 5)])
    expect([b.spanMinutes, b.deductedBreakMinutes, b.workMinutes]).toEqual([553, 60, 493])
  })
  test('休憩の境目', () => {
    const work = (minutes: number) => {
      const start = jst(2026, 10, 14, 9, 0)
      return summarize([
        { id: 'a', kind: 'in', time: start },
        { id: 'b', kind: 'out', time: new Date(start.getTime() + minutes * 60000) },
      ]).workMinutes
    }
    expect([work(360), work(361), work(525), work(526)]).toEqual([360, 316, 480, 466])
  })
  test('中抜けを休憩に充てる', () => {
    const s = summarize([punch('in', 9, 0), punch('out', 12, 0), punch('in', 12, 30), punch('out', 18, 0)])
    expect([s.spanMinutes, s.gapMinutes, s.deductedBreakMinutes, s.workMinutes]).toEqual([540, 30, 30, 480])
  })
  test('休憩を取れなかった', () => {
    expect(summarize([punch('in', 9, 0), punch('out', 18, 0)], undefined, 0).workMinutes).toBe(540)
  })
  test('状態', () => {
    expect(summarize([]).status).toBe('off')
    expect(summarize([punch('in', 9, 0)]).status).toBe('working')
    expect(summarize([punch('in', 9, 0)], undefined, null, true).status).toBe('missingPunch')
    expect(summarize([punch('out', 9, 0)]).status).toBe('missingPunch')
  })
  test('日付をまたぐ勤務', () => {
    const s = summarize([
      { id: 'a', kind: 'in', time: jst(2026, 10, 14, 22, 0) },
      { id: 'b', kind: 'out', time: jst(2026, 10, 15, 5, 0) },
    ])
    expect([s.spanMinutes, s.workMinutes]).toEqual([420, 375])
  })
})
