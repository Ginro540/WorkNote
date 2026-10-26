// 休暇の申請（leaveRequests）。1日1件。まとめて申請した日は同じ groupId を付ける。

import { collection, doc, query, Timestamp, where, writeBatch, type Unsubscribe } from 'firebase/firestore'
import { checkLeaveDay, leaveDayCheckMessage, type LeaveDayContext } from '../core/leave'
import { dayKey } from '../core/workCalendar'
import { db } from '../firebase'
import { isHalfDayLeave, parseLeave, type LeaveKind, type LeaveRequest } from './models'
import { listenQuery, Observable } from './observable'
import type { SettingsStore } from './settings'

const leaveCollection = collection(db, 'leaveRequests')

export class LeaveStore extends Observable {
  /** 自分の休暇（申請の新しい順） */
  leaves: LeaveRequest[] = []
  unsentIds = new Set<string>()
  isLoaded = false
  private unsub: Unsubscribe | null = null
  private readonly uid: string
  private readonly settings: SettingsStore

  constructor(uid: string, settings: SettingsStore) {
    super()
    this.uid = uid
    this.settings = settings
  }

  start() {
    this.unsub = listenQuery(query(leaveCollection, where('userId', '==', this.uid)), parseLeave, (items, pending) => {
      this.leaves = items.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime() || a.date.localeCompare(b.date))
      this.unsentIds = pending
      this.isLoaded = true
      this.changed()
    })
  }

  stop() {
    this.unsub?.()
    this.unsub = null
  }

  /** その日の休暇（取り消し・却下も含む） */
  leavesOn(date: string) {
    return this.leaves.filter((l) => l.date === date)
  }

  /** その日の申請中・承認済みの休暇 */
  activeLeaveOn(date: string): LeaveRequest | null {
    return this.leaves.find((l) => l.date === date && (l.status === 'pending' || l.status === 'approved')) ?? null
  }

  /** その日が承認された全日の休暇か（日報の未提出に数えない日） */
  approvedFullDayLeaveOn(date: string): LeaveRequest | null {
    return this.leaves.find((l) => l.date === date && l.status === 'approved' && !isHalfDayLeave(l.kind)) ?? null
  }

  get pendingCount() {
    return this.leaves.filter((l) => l.status === 'pending').length
  }

  /** 申請できる日の判定に使う情報 */
  dayContext(): LeaveDayContext {
    return {
      today: dayKey(new Date()),
      isHoliday: (d) => this.settings.holiday(d) !== null,
      hasActiveLeave: (d) => this.activeLeaveOn(d) !== null,
      canRequestCorrection: (d) => {
        const month = this.settings.period.monthKeyForDayKey(d)
        return month !== null && this.settings.canRequestCorrection(month)
      },
    }
  }

  /**
   * 申請する。電波がなくてもスマホに保存され、つながったら自動で送信される。
   * 申請できない日があれば Error を投げる（メッセージをそのまま画面に出す）。
   */
  submit(kind: LeaveKind, dates: string[], reason: string) {
    const days = [...new Set(dates)].sort()
    if (days.length === 0) throw new Error('日付を選んでください。')
    const trimmed = reason.trim()
    if (!isPaid(kind) && trimmed === '') throw new Error('理由を入力してください。')
    const ctx = this.dayContext()
    for (const d of days) {
      const check = checkLeaveDay(d, kind, ctx)
      if (check !== 'ok') throw new Error(leaveDayCheckMessage[check])
    }

    const batch = writeBatch(db)
    const refs = days.map(() => doc(leaveCollection))
    const groupId = refs[0].id
    const createdAt = Timestamp.now()
    days.forEach((date, i) => {
      batch.set(refs[i], {
        userId: this.uid,
        date,
        month: this.settings.period.monthKeyForDayKey(date) ?? date.slice(0, 7),
        kind,
        reason: trimmed,
        groupId,
        status: 'pending',
        createdAt,
      })
    })
    batch.commit().catch((e) => console.error('Leave save error', e))
  }

  /** 申請中の休暇を取り消す（承認済みは管理者に連絡） */
  cancel(leaves: LeaveRequest[]) {
    const targets = leaves.filter((l) => l.status === 'pending')
    if (targets.length === 0) return
    const batch = writeBatch(db)
    const cancelledAt = Timestamp.now()
    for (const l of targets) batch.update(doc(leaveCollection, l.id), { status: 'cancelled', cancelledAt })
    batch.commit().catch((e) => console.error('Leave cancel error', e))
  }
}

export const isPaid = (kind: LeaveKind) => kind === 'paid' || kind === 'paidAm' || kind === 'paidPm'

/** 同じ groupId の休暇をまとめる（申請の新しい順） */
export function groupLeaves(leaves: LeaveRequest[]): LeaveRequest[][] {
  const groups = new Map<string, LeaveRequest[]>()
  for (const l of leaves) groups.set(l.groupId, [...(groups.get(l.groupId) ?? []), l])
  return [...groups.values()]
    .map((g) => g.sort((a, b) => a.date.localeCompare(b.date)))
    .sort((a, b) => Math.max(...b.map((l) => l.createdAt.getTime())) - Math.max(...a.map((l) => l.createdAt.getTime())))
}
