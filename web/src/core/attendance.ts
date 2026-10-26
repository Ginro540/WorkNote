// WorkNoteCore/AttendanceCalculator.swift の移植。従業員アプリと同じ結果になること（attendance.test.ts）。

export type PunchKind = 'in' | 'out'

export const punchKindLabel = (kind: PunchKind) => (kind === 'in' ? '出勤' : '退勤')

/** 計算に使う打刻 */
export interface PunchPoint {
  id: string
  kind: PunchKind
  time: Date
}

/** 出勤から退勤までの1回の勤務。どちらかが欠けていれば打刻漏れ。 */
export interface WorkSession {
  clockIn: PunchPoint | null
  clockOut: PunchPoint | null
}

export function sessionMinutes(s: WorkSession): number | null {
  if (!s.clockIn || !s.clockOut) return null
  return Math.max(0, Math.trunc((s.clockOut.time.getTime() - s.clockIn.time.getTime()) / 60000))
}

/** 休憩のルール：拘束時間が overMinutes を超えたら breakMinutes の休憩が必要 */
export interface BreakRule {
  overMinutes: number
  breakMinutes: number
}

/** 労働基準法 第34条に合わせた初期値（6:00 超 → 45分、8:45 超 → 60分） */
export const defaultBreakRules: BreakRule[] = [
  { overMinutes: 360, breakMinutes: 45 },
  { overMinutes: 525, breakMinutes: 60 },
]

export type DayStatus = 'off' | 'working' | 'finished' | 'missingPunch'

export const dayStatusLabel: Record<DayStatus, string> = {
  off: '休み',
  working: '勤務中',
  finished: '退勤済み',
  missingPunch: '退勤漏れ',
}

/** 1日分の集計 */
export interface DaySummary {
  sessions: WorkSession[]
  status: DayStatus
  firstIn: Date | null
  lastOut: Date | null
  /** 拘束時間（最後の退勤 − 最初の出勤） */
  spanMinutes: number | null
  /** 中抜け（退勤と次の出勤の間） */
  gapMinutes: number | null
  /** 必要な休憩 */
  requiredBreakMinutes: number | null
  /** 自動で差し引く休憩（「休憩を取れなかった」の承認があればその値） */
  deductedBreakMinutes: number | null
  /** 実働時間 */
  workMinutes: number | null
  /** 1日8時間を超えた分 */
  overtimeMinutes: number | null
}

export const overtimeThresholdMinutes = 8 * 60

/** 打刻を時刻順に並べ、出勤〜退勤の組にする */
export function sessionsFrom(punches: PunchPoint[]): WorkSession[] {
  const result: WorkSession[] = []
  let open: WorkSession | null = null
  // Swift の sorted と同じく、同じ時刻の打刻は元の順番のまま（安定ソート）
  const sorted = [...punches].sort((a, b) => a.time.getTime() - b.time.getTime())
  for (const punch of sorted) {
    if (punch.kind === 'in') {
      if (open) result.push(open) // 退勤漏れのまま次の出勤
      open = { clockIn: punch, clockOut: null }
    } else if (open) {
      open.clockOut = punch
      result.push(open)
      open = null
    } else {
      result.push({ clockIn: null, clockOut: punch }) // 出勤漏れ
    }
  }
  if (open) result.push(open)
  return result
}

export function requiredBreak(spanMinutes: number, rules: BreakRule[]): number {
  const list = rules.filter((r) => spanMinutes > r.overMinutes).map((r) => r.breakMinutes)
  return list.length ? Math.max(...list) : 0
}

/**
 * @param isPastDay 今日より前の勤務日か（閉じていない勤務を「退勤漏れ」とする）
 * @param breakOverride 承認された「休憩を取れなかった」申請の休憩時間
 */
export function summarize(
  punches: PunchPoint[],
  rules: BreakRule[] = defaultBreakRules,
  breakOverride: number | null = null,
  isPastDay = false,
): DaySummary {
  const sessions = sessionsFrom(punches)
  const summary: DaySummary = {
    sessions,
    status: 'off',
    firstIn: null,
    lastOut: null,
    spanMinutes: null,
    gapMinutes: null,
    requiredBreakMinutes: null,
    deductedBreakMinutes: null,
    workMinutes: null,
    overtimeMinutes: null,
  }
  if (sessions.length === 0) return summary

  const ins = sessions.flatMap((s) => (s.clockIn ? [s.clockIn.time.getTime()] : []))
  const outs = sessions.flatMap((s) => (s.clockOut ? [s.clockOut.time.getTime()] : []))
  summary.firstIn = ins.length ? new Date(Math.min(...ins)) : null
  summary.lastOut = outs.length ? new Date(Math.max(...outs)) : null

  const isComplete = (s: WorkSession) => s.clockIn !== null && s.clockOut !== null
  if (!sessions.every(isComplete)) {
    const last = sessions[sessions.length - 1]
    const onlyLastOpen = sessions.slice(0, -1).every(isComplete) && last.clockIn !== null && last.clockOut === null
    summary.status = onlyLastOpen && !isPastDay ? 'working' : 'missingPunch'
    return summary
  }
  summary.status = 'finished'

  const span = Math.max(0, Math.trunc((summary.lastOut!.getTime() - summary.firstIn!.getTime()) / 60000))
  const worked = sessions.reduce((sum, s) => sum + (sessionMinutes(s) ?? 0), 0)
  const gap = Math.max(0, span - worked)
  const required = requiredBreak(span, rules)
  const deducted = breakOverride ?? Math.max(0, required - gap)
  const work = Math.max(0, worked - deducted)

  summary.spanMinutes = span
  summary.gapMinutes = gap
  summary.requiredBreakMinutes = required
  summary.deductedBreakMinutes = deducted
  summary.workMinutes = work
  summary.overtimeMinutes = Math.max(0, work - overtimeThresholdMinutes)
  return summary
}
