// 勤怠の画面で共通の部品：打刻1件、打刻の点と線、修正申請1件、月・日の打刻の読み込み

import { useEffect, useState } from 'react'
import { collection, query, where } from 'firebase/firestore'
import { IconMapPin, IconMapPinOff } from '@tabler/icons-react'
import { punchKindLabel } from '../../core/attendance'
import { jstParts, shortDayLabelFromKey, timeLabel } from '../../core/workCalendar'
import { db } from '../../firebase'
import {
  correctionKindLabel,
  correctionStatusLabel,
  hasClockSkew,
  locationDelayLabel,
  locationLabel,
  parsePunch,
  type AttendanceCorrection,
  type AttendancePunch,
} from '../../data/models'
import { listenQuery, useObserve } from '../../data/observable'
import { useSession } from '../../data/session'
import { Card, confirmAction, StatusBadge, UnsentMark } from '../../ui/common'
import { colors, statusColor } from '../../ui/theme'

/** 1か月分（field = month）または1日分（field = workDate）の打刻を読む */
export function usePunches(field: 'month' | 'workDate', value: string) {
  const { uid } = useSession()
  const [state, setState] = useState<{ key: string; punches: AttendancePunch[] }>({ key: '', punches: [] })
  const key = `${field}:${value}`
  useEffect(() => {
    if (!value) return
    return listenQuery(
      query(collection(db, 'attendancePunches'), where('userId', '==', uid), where(field, '==', value)),
      parsePunch,
      (items) => setState({ key, punches: items.sort((a, b) => a.punchedAt.getTime() - b.punchedAt.getTime()) }),
    )
  }, [uid, field, value, key])
  return { punches: state.key === key ? state.punches : [], isLoaded: state.key === key }
}

/** 打刻1件（時刻・出勤/退勤・場所） */
export function PunchRow({ punch, isUnsent = false }: { punch: AttendancePunch; isUnsent?: boolean }) {
  const delay = locationDelayLabel(punch)
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
        <span className="num" style={{ fontSize: 22, fontWeight: 700 }}>
          {timeLabel(punch.punchedAt)}
        </span>
        <span className="dimmed">{punchKindLabel(punch.kind)}</span>
        {punch.corrected && <StatusBadge text="修正済み" color="grape" />}
        {isUnsent && <UnsentMark />}
      </div>
      <div className="dimmed" style={{ fontSize: 12, display: 'flex', gap: 4, alignItems: 'center' }}>
        {punch.location ? <IconMapPin size={14} /> : <IconMapPinOff size={14} />}
        {locationLabel(punch)}
      </div>
      {delay && (
        <div className="dimmed" style={{ fontSize: 11 }}>
          {delay}
        </div>
      )}
      {punch.corrected && punch.originalPunchedAt && (
        <div className="dimmed" style={{ fontSize: 11 }}>
          元の打刻 {timeLabel(punch.originalPunchedAt)}
        </div>
      )}
      {hasClockSkew(punch) && punch.receivedAt && (
        <div style={{ fontSize: 11, color: colors.warning }}>サーバー受信 {monthDayTime(punch.receivedAt)}</div>
      )}
    </div>
  )
}

/** 打刻の点と線 */
export function PunchTimeline({ punches, unsentIds }: { punches: AttendancePunch[]; unsentIds?: Set<string> }) {
  return (
    <div className="timeline">
      {punches.map((p, i) => (
        <div className="item" key={p.id}>
          <div className="rail">
            <div className="dot" style={{ background: p.kind === 'in' ? colors.clockIn : colors.clockOut }} />
            {i < punches.length - 1 && <div className="line" />}
          </div>
          <div className="body">
            <PunchRow punch={p} isUnsent={unsentIds?.has(p.id)} />
          </div>
        </div>
      ))}
    </div>
  )
}

/** "10/19 08:57" */
export const monthDayTime = (d: Date) => {
  const p = jstParts(d)
  return `${p.month}/${p.day} ${timeLabel(d)}`
}
const md = monthDayTime

/** 修正申請1件 */
export function CorrectionCard({ correction: c, showsDate = false }: { correction: AttendanceCorrection; showsDate?: boolean }) {
  const attendance = useObserve(useSession().attendance)
  return (
    <Card>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        {showsDate && <b style={{ fontSize: 14 }}>{shortDayLabelFromKey(c.workDate)}</b>}
        <span style={{ fontSize: 14, fontWeight: 600 }}>{correctionKindLabel[c.kind]}</span>
        <span style={{ marginLeft: 'auto' }}>
          <StatusBadge text={correctionStatusLabel[c.status]} color={statusColor[c.status]} />
        </span>
      </div>
      <div style={{ fontSize: 14, display: 'flex', flexDirection: 'column', gap: 4 }}>
        {c.requestedClockIn && <div>出勤 {md(c.requestedClockIn)}</div>}
        {c.requestedClockOut && <div>退勤 {md(c.requestedClockOut)}</div>}
        {c.requestedBreakMinutes !== null && <div>休憩 {c.requestedBreakMinutes}分</div>}
        <div className="dimmed">理由：{c.reason}</div>
        {c.status === 'rejected' && c.rejectReason && <div style={{ color: 'var(--mantine-color-red-6)' }}>却下の理由：{c.rejectReason}</div>}
        <div className="dimmed" style={{ fontSize: 12 }}>
          申請 {md(c.createdAt)}
        </div>
      </div>
      {c.status === 'pending' && (
        <button
          className="header-btn"
          style={{ color: 'var(--mantine-color-red-6)', alignSelf: 'flex-start', padding: 0, fontSize: 14 }}
          onClick={() =>
            confirmAction({
              title: 'この修正申請を取り消しますか？',
              confirm: '申請を取り消す',
              danger: true,
              onConfirm: () => attendance.cancelCorrection(c),
            })
          }
        >
          申請を取り消す
        </button>
      )}
    </Card>
  )
}
