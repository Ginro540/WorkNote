import { Button, Stack } from '@mantine/core'
import { modals } from '@mantine/modals'
import { leaveDatesLabel, daysLabel } from '../../core/leave'
import { shortDayLabelFromKey } from '../../core/workCalendar'
import type { LeaveStore } from '../../data/leaves'
import { leaveDays, leaveKindLabel, leaveStatusLabel, type LeaveRequest } from '../../data/models'
import { useObserve } from '../../data/observable'
import { useSession } from '../../data/session'
import { Card, confirmAction, StatusBadge, UnsentMark } from '../../ui/common'
import { statusColor } from '../../ui/theme'
import { monthDayTime } from './parts'

export const LeaveStatusBadge = ({ leave }: { leave: LeaveRequest }) => (
  <StatusBadge text={leaveStatusLabel[leave.status]} color={statusColor[leave.status]} />
)

/** 休暇の申請1件（まとめて申請した日は1枚にまとめる） */
export function LeaveCard({ group }: { group: LeaveRequest[] }) {
  const store = useObserve(useSession().leaves)
  const first = group[0]
  const sameStatus = group.every((l) => l.status === first.status)
  const pending = group.filter((l) => l.status === 'pending')
  const total = group.filter((l) => l.status !== 'cancelled' && l.status !== 'rejected').reduce((s, l) => s + leaveDays(l.kind), 0)
  const unsent = group.some((l) => store.unsentIds.has(l.id))

  return (
    <Card>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <b style={{ fontSize: 15, flex: 1, minWidth: 0 }}>
          {leaveDatesLabel(group.map((l) => l.date))}
          {group.length > 1 && <span className="dimmed" style={{ fontWeight: 400 }}> {group.length}日</span>}
        </b>
        {sameStatus && <LeaveStatusBadge leave={first} />}
      </div>
      <div style={{ fontSize: 14, display: 'flex', flexDirection: 'column', gap: 4 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          {leaveKindLabel[first.kind]}
          {total > 0 && group.length > 1 && <span className="dimmed">（{daysLabel(total)}日分）</span>}
          {unsent && <UnsentMark />}
        </div>
        {!sameStatus &&
          group.map((l) => (
            <div key={l.id} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span style={{ width: 90 }}>{shortDayLabelFromKey(l.date)}</span>
              <LeaveStatusBadge leave={l} />
            </div>
          ))}
        {first.reason && <div className="dimmed">理由：{first.reason}</div>}
        {first.createdBy && <div className="dimmed">管理者が登録</div>}
        {group
          .filter((l) => l.status === 'rejected' && l.rejectReason)
          .slice(0, 1)
          .map((l) => (
            <div key={l.id} style={{ color: 'var(--mantine-color-red-6)' }}>
              却下の理由：{l.rejectReason}
            </div>
          ))}
        {group
          .filter((l) => l.cancelReason)
          .slice(0, 1)
          .map((l) => (
            <div key={l.id} className="dimmed">
              管理者が取り消し：{l.cancelReason}
            </div>
          ))}
        <div className="dimmed" style={{ fontSize: 12 }}>
          申請 {monthDayTime(first.createdAt)}
        </div>
      </div>
      {pending.length > 0 && (
        <button
          className="header-btn"
          style={{ color: 'var(--mantine-color-red-6)', alignSelf: 'flex-start', padding: 0, fontSize: 14 }}
          onClick={() => openCancel(store, pending)}
        >
          申請を取り消す
        </button>
      )}
      {group.some((l) => l.status === 'approved') && (
        <div className="dimmed" style={{ fontSize: 12 }}>
          承認済みの休暇を取り消したいときは、管理者に連絡してください。
        </div>
      )}
    </Card>
  )
}

/** 申請中の休暇を取り消す。まとめて申請したものは、全部の日か1日ずつかを選べる */
export function openCancel(store: LeaveStore, pending: LeaveRequest[]) {
  if (pending.length === 1) {
    confirmAction({
      title: 'この休暇の申請を取り消しますか？',
      message: `${shortDayLabelFromKey(pending[0].date)} ${leaveKindLabel[pending[0].kind]}`,
      confirm: '申請を取り消す',
      danger: true,
      onConfirm: () => store.cancel(pending),
    })
    return
  }
  modals.open({
    title: '休暇の申請を取り消す',
    centered: true,
    children: (
      <Stack gap="sm">
        <Button
          color="red"
          onClick={() => {
            store.cancel(pending)
            modals.closeAll()
          }}
        >
          全部の日（{pending.length}日）を取り消す
        </Button>
        <div className="dimmed" style={{ fontSize: 12 }}>
          1日ずつ取り消す
        </div>
        {pending.map((l) => (
          <Button
            key={l.id}
            variant="light"
            color="red"
            onClick={() => {
              store.cancel([l])
              modals.closeAll()
            }}
          >
            {shortDayLabelFromKey(l.date)} だけ取り消す
          </Button>
        ))}
        <Button variant="subtle" onClick={() => modals.closeAll()}>
          やめる
        </Button>
      </Stack>
    ),
  })
}
