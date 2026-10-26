// 打刻（ホーム画面）と修正申請。

import {
  collection,
  doc,
  getDocs,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  type Unsubscribe,
} from 'firebase/firestore'
import { summarize, type DaySummary, type PunchKind } from '../core/attendance'
import { dayKey, shiftMonthKey } from '../core/workCalendar'
import { db } from '../firebase'
import { reverseGeocode, type Fix, type LocationService } from './location'
import {
  parseCorrection,
  parsePunch,
  punchPoint,
  type AttendanceCorrection,
  type AttendancePunch,
  type CorrectionKind,
  type LocationStatus,
  type PunchLocation,
} from './models'
import { listenQuery, Observable } from './observable'
import type { SettingsStore } from './settings'

/** 押したあと数秒だけ取り消せる打刻（まだ保存していない） */
export interface PendingPunch {
  id: string
  kind: PunchKind
  time: Date
  workDate: string
}

export type HomeStatus = 'notStarted' | 'working' | 'finished'

export const homeStatusLabel: Record<HomeStatus, string> = { notStarted: '未出勤', working: '勤務中', finished: '退勤済み' }

/** 日付をまたぐ勤務を「勤務中」とみなす長さ。これを過ぎて退勤がなければ「退勤漏れ」 */
const OVERNIGHT_LIMIT_MS = 16 * 3600_000
/** 押したあと取り消せる秒数 */
export const UNDO_SECONDS = 5
/** 位置の取得を続ける時間（打刻から） */
const LOCATION_TIMEOUT_MS = 10 * 60_000

const punchCollection = collection(db, 'attendancePunches')
const correctionCollection = collection(db, 'attendanceCorrections')

export interface NewCorrection {
  workDate: string
  month: string
  targetPunchIds: string[]
  kind: CorrectionKind
  requestedClockIn: Date | null
  requestedClockOut: Date | null
  requestedBreakMinutes: number | null
  reason: string
}

export class AttendanceStore extends Observable {
  /** 最近（前月〜翌月）の打刻（時刻順） */
  punches: AttendancePunch[] = []
  unsentPunchIds = new Set<string>()
  corrections: AttendanceCorrection[] = []
  pendingPunch: PendingPunch | null = null

  /** 取り消し待ちの打刻のために先に取れた位置 */
  private pendingFix: Fix | null = null
  /** 位置を取得中の打刻（ID → 打刻の時刻） */
  private acquiring = new Map<string, Date>()
  private geocoded = new Set<string>()
  private commitTimer: number | null = null
  private timeoutTimer: number | null = null
  private unsubs: Unsubscribe[] = []
  private readonly uid: string
  private readonly settings: SettingsStore
  private readonly location: LocationService

  constructor(uid: string, settings: SettingsStore, location: LocationService) {
    super()
    this.uid = uid
    this.settings = settings
    this.location = location
  }

  start() {
    // 月は締め日で決まるので、カレンダーの前月〜翌月を読めば最近の打刻はすべて入る
    const thisMonth = dayKey(new Date()).slice(0, 7)
    const months = [-1, 0, 1].map((n) => shiftMonthKey(thisMonth, n))
    this.unsubs.push(
      listenQuery(
        query(punchCollection, where('userId', '==', this.uid), where('month', 'in', months)),
        parsePunch,
        (items, pending) => {
          this.punches = items.sort((a, b) => a.punchedAt.getTime() - b.punchedAt.getTime())
          this.unsentPunchIds = pending
          this.changed()
          this.resumeLocationWork()
        },
      ),
      listenQuery(query(correctionCollection, where('userId', '==', this.uid)), parseCorrection, (items) => {
        this.corrections = items.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        this.changed()
      }),
    )
    this.location.onLocation = (fix) => this.handle(fix)
    this.location.onPermissionChange = () => this.handlePermissionChange()
    this.timeoutTimer = window.setInterval(() => this.expireLocationRequests(), 20_000)
  }

  stop() {
    this.commitPendingNow()
    this.unsubs.forEach((u) => u())
    this.unsubs = []
    if (this.timeoutTimer !== null) window.clearInterval(this.timeoutTimer)
    this.location.onLocation = null
    this.location.onPermissionChange = null
    this.location.stop()
  }

  // MARK: - ホーム画面の状態

  private get today() {
    return dayKey(new Date())
  }

  /** 取り消し待ちも含めた打刻（時刻順） */
  private get effectivePunches() {
    const list = this.punches.map((p) => ({ workDate: p.workDate, kind: p.kind, time: p.punchedAt }))
    if (this.pendingPunch) list.push({ workDate: this.pendingPunch.workDate, kind: this.pendingPunch.kind, time: this.pendingPunch.time })
    return list.sort((a, b) => a.time.getTime() - b.time.getTime())
  }

  /** 勤務中の勤務日（日付をまたぐ勤務は出勤した日） */
  get openWorkDate(): string | null {
    const list = this.effectivePunches
    const last = list[list.length - 1]
    if (!last || last.kind !== 'in') return null
    if (last.workDate === this.today) return this.today
    return Date.now() - last.time.getTime() < OVERNIGHT_LIMIT_MS ? last.workDate : null
  }

  get homeStatus(): HomeStatus {
    if (this.openWorkDate !== null) return 'working'
    return this.effectivePunches.some((p) => p.workDate === this.today) ? 'finished' : 'notStarted'
  }

  /** 次に押せる打刻 */
  get nextKind(): PunchKind {
    return this.homeStatus === 'working' ? 'out' : 'in'
  }

  get buttonLabel() {
    return { notStarted: '出勤', working: '退勤', finished: '再出勤' }[this.homeStatus]
  }

  /** ホームの「今日の勤務」に出す勤務日 */
  get timelineWorkDate() {
    return this.openWorkDate ?? this.today
  }

  punchesOn(workDate: string) {
    return this.punches.filter((p) => p.workDate === workDate)
  }

  /** 退勤漏れ（または出勤漏れ）のある過去の勤務日。申請中・承認済みの修正がある日は除く */
  get missingPunchDays(): string[] {
    const open = this.openWorkDate
    const today = this.today
    const days = new Set(this.punches.map((p) => p.workDate).filter((d) => d < today && d !== open))
    return [...days]
      .filter((day) => {
        const s = summarize(this.punchesOn(day).map(punchPoint), undefined, null, true)
        if (s.status !== 'missingPunch') return false
        return !this.corrections.some((c) => c.workDate === day && (c.status === 'pending' || c.status === 'approved'))
      })
      .sort()
  }

  summary(workDate: string, dayPunches?: AttendancePunch[]): DaySummary {
    const list = dayPunches ?? this.punchesOn(workDate)
    return summarize(
      list.map(punchPoint),
      this.settings.company.breakRules,
      this.approvedBreakOverride(workDate),
      workDate < this.today && workDate !== this.openWorkDate,
    )
  }

  /** 承認された「休憩を取れなかった」申請の休憩時間 */
  approvedBreakOverride(workDate: string): number | null {
    return this.corrections.find((c) => c.workDate === workDate && c.kind === 'noBreak' && c.status === 'approved')?.requestedBreakMinutes ?? null
  }

  /** その日の打刻（最近の打刻になければクラウドから読む） */
  async fetchPunches(workDate: string): Promise<AttendancePunch[]> {
    const recent = this.punchesOn(workDate)
    if (recent.length) return recent
    try {
      const snap = await getDocs(query(punchCollection, where('userId', '==', this.uid), where('workDate', '==', workDate)))
      return snap.docs
        .map((d) => parsePunch(d.id, d.data({ serverTimestamps: 'estimate' })))
        .filter((p): p is AttendancePunch => p !== null)
        .sort((a, b) => a.punchedAt.getTime() - b.punchedAt.getTime())
    } catch {
      return []
    }
  }

  correctionsOn(workDate: string) {
    return this.corrections.filter((c) => c.workDate === workDate)
  }

  // MARK: - 打刻

  /** 出勤・退勤ボタン。数秒間は取り消せるように、保存を少し待つ。 */
  tapPunch() {
    this.commitPendingNow()
    const now = new Date()
    const kind = this.nextKind
    const workDate = kind === 'out' ? (this.openWorkDate ?? this.today) : this.today
    this.pendingPunch = { id: crypto.randomUUID(), kind, time: now, workDate }
    this.pendingFix = null
    this.changed()

    this.location.start()
    this.commitTimer = window.setTimeout(() => this.commitPendingNow(), UNDO_SECONDS * 1000)
  }

  undoPunch() {
    if (this.commitTimer !== null) window.clearTimeout(this.commitTimer)
    this.commitTimer = null
    this.pendingPunch = null
    this.pendingFix = null
    this.changed()
    this.stopLocationIfIdle()
  }

  /** 取り消し待ちの打刻をすぐ保存する（アプリを閉じるときなど） */
  commitPendingNow() {
    if (this.commitTimer !== null) window.clearTimeout(this.commitTimer)
    this.commitTimer = null
    const p = this.pendingPunch
    if (!p) return
    this.pendingPunch = null

    const ref = doc(punchCollection)
    let status: LocationStatus = 'pending'
    let punchLocation: PunchLocation | null = null
    if (this.location.isDenied) {
      status = 'denied'
    } else if (this.pendingFix) {
      status = 'acquired'
      punchLocation = toPunchLocation(this.pendingFix, p.time)
    }
    this.pendingFix = null

    // 電波がなくてもスマホに保存され、つながったら自動で送信される
    setDoc(ref, {
      userId: this.uid,
      workDate: p.workDate,
      month: this.settings.period.monthKeyForDayKey(p.workDate) ?? p.workDate.slice(0, 7),
      kind: p.kind,
      punchedAt: Timestamp.fromDate(p.time),
      receivedAt: serverTimestamp(),
      ...(punchLocation ? { location: encodeLocation(punchLocation) } : {}),
      locationStatus: status,
      corrected: false,
    }).catch((e) => console.error('Punch save error', e))

    if (status === 'pending') {
      this.acquiring.set(ref.id, p.time)
    } else if (status === 'acquired' && punchLocation) {
      this.fillAddress(ref.id, punchLocation)
    }
    this.changed()
    this.stopLocationIfIdle()
  }

  // MARK: - 位置情報

  /** 位置の精度が十分か。打刻から時間がたつほど条件をゆるめる */
  private isAcceptable(fix: Fix, punchedAt: Date) {
    if (fix.accuracy < 0 || fix.timestamp.getTime() <= punchedAt.getTime() - 60_000) return false
    const elapsed = Date.now() - punchedAt.getTime()
    return fix.accuracy <= 100 || (elapsed > 30_000 && fix.accuracy <= 1000)
  }

  private handle(fix: Fix) {
    const p = this.pendingPunch
    if (p && !this.pendingFix && this.isAcceptable(fix, p.time)) this.pendingFix = fix
    for (const [punchId, punchedAt] of this.acquiring) {
      if (!this.isAcceptable(fix, punchedAt)) continue
      this.acquiring.delete(punchId)
      const loc = toPunchLocation(fix, punchedAt)
      this.update(punchId, { location: encodeLocation(loc), locationStatus: 'acquired' })
      this.fillAddress(punchId, loc)
    }
    this.stopLocationIfIdle()
  }

  private handlePermissionChange() {
    if (this.location.permission === 'granted') {
      if (this.pendingPunch || this.acquiring.size) this.location.start()
    } else if (this.location.isDenied) {
      for (const punchId of this.acquiring.keys()) this.update(punchId, { locationStatus: 'denied' })
      this.acquiring.clear()
      this.location.stop()
    }
  }

  /** 打刻から10分たっても取れなければ「位置なし」 */
  private expireLocationRequests() {
    const now = Date.now()
    for (const [punchId, punchedAt] of this.acquiring) {
      if (now - punchedAt.getTime() <= LOCATION_TIMEOUT_MS) continue
      this.acquiring.delete(punchId)
      this.update(punchId, { locationStatus: 'unavailable' })
    }
    this.stopLocationIfIdle()
  }

  /** アプリを開き直したとき：取得中の打刻を引き継ぎ、住所がまだない打刻に住所を入れる */
  private resumeLocationWork() {
    const now = Date.now()
    for (const punch of this.punches) {
      if (punch.locationStatus === 'pending' && !this.acquiring.has(punch.id)) {
        if (this.location.isDenied) {
          this.update(punch.id, { locationStatus: 'denied' })
        } else if (now - punch.punchedAt.getTime() > LOCATION_TIMEOUT_MS) {
          this.update(punch.id, { locationStatus: 'unavailable' })
        } else {
          this.acquiring.set(punch.id, punch.punchedAt)
          this.location.start()
        }
      }
      if (punch.locationStatus === 'acquired' && punch.location && punch.location.address === null && !this.unsentPunchIds.has(punch.id)) {
        this.fillAddress(punch.id, punch.location)
      }
    }
  }

  private fillAddress(punchId: string, loc: PunchLocation) {
    if (this.geocoded.has(punchId)) return
    this.geocoded.add(punchId)
    reverseGeocode(loc.lat, loc.lng).then((address) => {
      if (!address) {
        this.geocoded.delete(punchId) // 電波がないときは次の機会にもう一度
        return
      }
      // 住所だけを足す（緯度・経度・取得時刻はそのまま。ルールで変更できない）
      this.update(punchId, { 'location.address': address })
    })
  }

  private stopLocationIfIdle() {
    if (!this.pendingPunch && this.acquiring.size === 0) this.location.stop()
  }

  private update(punchId: string, fields: Record<string, unknown>) {
    updateDoc(doc(punchCollection, punchId), fields).catch((e) => console.error('Punch update error', e))
  }

  // MARK: - 修正申請

  submitCorrection(c: NewCorrection) {
    setDoc(doc(correctionCollection), {
      userId: this.uid,
      workDate: c.workDate,
      month: c.month,
      targetPunchIds: c.targetPunchIds,
      kind: c.kind,
      ...(c.requestedClockIn ? { requestedClockIn: Timestamp.fromDate(c.requestedClockIn) } : {}),
      ...(c.requestedClockOut ? { requestedClockOut: Timestamp.fromDate(c.requestedClockOut) } : {}),
      ...(c.requestedBreakMinutes !== null ? { requestedBreakMinutes: c.requestedBreakMinutes } : {}),
      reason: c.reason,
      status: 'pending',
      createdAt: Timestamp.now(),
    }).catch((e) => console.error('Correction save error', e))
  }

  cancelCorrection(c: AttendanceCorrection) {
    if (c.status !== 'pending') return
    updateDoc(doc(correctionCollection, c.id), { status: 'cancelled', cancelledAt: Timestamp.now() }).catch((e) =>
      console.error('Correction cancel error', e),
    )
  }
}

/** 押す前から取れていた位置は、押した時刻で記録する */
function toPunchLocation(fix: Fix, punchedAt: Date): PunchLocation {
  return {
    lat: fix.lat,
    lng: fix.lng,
    accuracy: fix.accuracy,
    address: null,
    locatedAt: fix.timestamp > punchedAt ? fix.timestamp : punchedAt,
  }
}

function encodeLocation(loc: PunchLocation) {
  return {
    lat: loc.lat,
    lng: loc.lng,
    accuracy: loc.accuracy,
    ...(loc.address ? { address: loc.address } : {}),
    locatedAt: Timestamp.fromDate(loc.locatedAt ?? new Date()),
  }
}
