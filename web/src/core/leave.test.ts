import { describe, expect, test } from 'vitest'
import { parseLeave, type LeaveRequest } from '../data/models'
import { checkLeaveDay, leaveDatesLabel, leaveTotals, oneYearLater, type LeaveDayContext } from './leave'

const ctx = (over: Partial<LeaveDayContext> = {}): LeaveDayContext => ({
  today: '2026-10-27',
  isHoliday: (d) => d === '2026-11-03',
  hasActiveLeave: (d) => d === '2026-10-29',
  canRequestCorrection: (d) => d >= '2026-10-01',
  ...over,
})

const leave = (date: string, kind: LeaveRequest['kind'], status: LeaveRequest['status']): LeaveRequest =>
  parseLeave(`${date}-${kind}`, { userId: 'u', date, kind, status })!

describe('休暇', () => {
  test('parseLeave：古いデータ・知らない種類でも落ちない', () => {
    expect(parseLeave('a', { userId: 'u', date: '2026-10-28', kind: 'paid' })).toMatchObject({
      month: '2026-10',
      reason: '',
      groupId: 'a',
      status: 'pending',
      cancelledAt: null,
      createdBy: null,
    })
    expect(parseLeave('b', { userId: 'u', date: '2026-10-28', kind: 'compensatory' })).toBeNull()
    expect(parseLeave('c', { date: '2026-10-28', kind: 'paid' })).toBeNull()
    expect(parseLeave('d', { userId: 'u', date: '2026-10-28', kind: 'paid', status: 'unknown' })?.status).toBe('pending')
  })

  test('申請できる日', () => {
    expect(checkLeaveDay('2026-10-28', 'paid', ctx())).toBe('ok') // 水
    expect(checkLeaveDay('2026-10-31', 'paid', ctx())).toBe('dayOff') // 土
    expect(checkLeaveDay('2026-11-01', 'special', ctx())).toBe('dayOff') // 日
    expect(checkLeaveDay('2026-11-03', 'paidAm', ctx())).toBe('dayOff') // 祝日
    expect(checkLeaveDay('2026-10-31', 'absence', ctx())).toBe('ok') // 欠勤は土日も選べる
    expect(checkLeaveDay('2026-10-29', 'paid', ctx())).toBe('alreadyRequested')
    expect(checkLeaveDay('2026-10-29', 'absence', ctx())).toBe('alreadyRequested')
    expect(checkLeaveDay('2026-09-30', 'paid', ctx())).toBe('pastDeadline')
    expect(checkLeaveDay('2026-10-27', 'paid', ctx())).toBe('ok') // 今日
    expect(checkLeaveDay('2027-10-27', 'paid', ctx())).toBe('ok') // ちょうど1年後（水）
    expect(checkLeaveDay('2027-10-28', 'paid', ctx())).toBe('tooFar')
    expect(checkLeaveDay('2026-02-30', 'paid', ctx())).toBe('invalid')
    expect(oneYearLater('2028-02-29')).toBe('2029-02-28')
  })

  test('月の集計：承認だけ、半休は0.5日', () => {
    const days = ['2026-10-26', '2026-10-27', '2026-10-28', '2026-10-29', '2026-10-30']
    const t = leaveTotals(
      [
        leave('2026-10-26', 'paid', 'approved'),
        leave('2026-10-27', 'paidAm', 'approved'),
        leave('2026-10-28', 'paidPm', 'approved'),
        leave('2026-10-29', 'special', 'approved'),
        leave('2026-10-30', 'absence', 'approved'),
        leave('2026-10-30', 'paid', 'pending'),
        leave('2026-10-30', 'paid', 'rejected'),
        leave('2026-10-30', 'paid', 'cancelled'),
        leave('2026-11-02', 'paid', 'approved'), // 月の外
      ],
      days,
    )
    expect(t).toEqual({ paid: 2, special: 1, absence: 1 })
  })

  test('まとめて申請した日の書き方', () => {
    expect(leaveDatesLabel(['2026-10-30', '2026-10-28', '2026-10-29'])).toBe('10/28（水）〜10/30（金）')
    expect(leaveDatesLabel(['2026-10-28', '2026-10-31'])).toBe('10/28, 10/31')
    expect(leaveDatesLabel(['2026-10-28'])).toBe('10/28（水）')
    expect(leaveDatesLabel(['2026-10-31', '2026-11-01'])).toBe('10/31（土）〜11/1（日）')
  })
})
