import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Radio, Stack, Text, Textarea } from '@mantine/core'
import { DatePicker } from '@mantine/dates'
import { notifications } from '@mantine/notifications'
import { IconSend, IconX } from '@tabler/icons-react'
import { checkLeaveDay, isFullDayLeave, oneYearLater } from '../../core/leave'
import { shortDayLabelFromKey } from '../../core/workCalendar'
import { isPaid } from '../../data/leaves'
import { leaveKindLabel, leaveKinds, type LeaveKind } from '../../data/models'
import { useObserve } from '../../data/observable'
import { useSession } from '../../data/session'
import { alertMessage, Card, confirmAction, goBack, HeaderButton, Page } from '../../ui/common'
import { colors } from '../../ui/theme'

/** 休暇の申請：種類・日付（複数可）・理由 */
export function LeaveRequestPage() {
  const session = useSession()
  const store = useObserve(session.leaves)
  const settings = useObserve(session.settings)
  const navigate = useNavigate()
  const [kind, setKind] = useState<LeaveKind>('paid')
  const [dates, setDates] = useState<string[]>([])
  const [reason, setReason] = useState('')
  const [sending, setSending] = useState(false)

  const ctx = store.dayContext()
  const today = ctx.today
  // 申請できるいちばん前の日：前の月がまだ修正申請の期限内なら、その月の初日から
  const thisMonth = settings.period.monthKey(new Date())
  const prevMonth = settings.period.monthKey(new Date((settings.period.dateRange(thisMonth)?.start ?? new Date()).getTime() - 86_400_000))
  const minMonth = settings.canRequestCorrection(prevMonth) ? prevMonth : thisMonth
  const minDate = settings.period.dayKeys(minMonth)[0] ?? today

  const changeKind = (k: LeaveKind) => {
    setKind(k)
    // 種類を変えて申請できなくなった日（土日など）は外す
    setDates((list) => list.filter((d) => checkLeaveDay(d, k, ctx) === 'ok'))
  }

  const canSend = dates.length > 0 && (isPaid(kind) || reason.trim() !== '') && !sending

  const send = async () => {
    if (!canSend) return
    const sorted = [...dates].sort()
    setSending(true)
    // 全日の休暇は、打刻がある日を確かめる
    let punchedDays: string[] = []
    if (isFullDayLeave(kind)) {
      const past = sorted.filter((d) => d <= today)
      const results = await Promise.all(past.map(async (d) => ((await session.attendance.fetchPunches(d)).length > 0 ? d : null)))
      punchedDays = results.filter((d): d is string => d !== null)
    }
    setSending(false)

    const summary = `${shortDayLabelFromKey(sorted[0])}${sorted.length > 1 ? `ほか${sorted.length - 1}日` : ''}を「${leaveKindLabel[kind]}」で申請します。`
    const warning = punchedDays.length
      ? `\n\n${punchedDays.map(shortDayLabelFromKey).join('、')} は出勤の打刻があります。打刻はそのまま残ります。`
      : ''
    confirmAction({
      title: '休暇を申請しますか？',
      message: summary + warning,
      confirm: '申請する',
      onConfirm: () => {
        try {
          store.submit(kind, sorted, reason)
        } catch (e) {
          alertMessage((e as Error).message)
          return
        }
        notifications.show({ message: '申請しました。管理者の承認をお待ちください', color: 'green' })
        navigate('/attendance/leaves', { replace: true })
      },
    })
  }

  return (
    <Page
      title="休暇を申請"
      noTabbar
      left={
        <HeaderButton onClick={() => goBack(navigate, '/attendance/leaves')}>
          <IconX size={20} /> 閉じる
        </HeaderButton>
      }
    >
      <Card>
        <b style={{ fontSize: 17 }}>種類</b>
        <Radio.Group value={kind} onChange={(v) => changeKind(v as LeaveKind)}>
          <Stack gap={12}>
            {leaveKinds.map((k) => (
              <Radio key={k} value={k} label={leaveKindLabel[k]} size="md" />
            ))}
          </Stack>
        </Radio.Group>
      </Card>

      <Card>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <b style={{ fontSize: 17 }}>日付</b>
          <span className="dimmed" style={{ fontSize: 12 }}>
            複数の日を選べます
          </span>
        </div>
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <DatePicker
            type="multiple"
            value={dates}
            onChange={setDates}
            minDate={minDate}
            maxDate={oneYearLater(today)}
            defaultDate={today}
            size="md"
            excludeDate={(d) => checkLeaveDay(d, kind, ctx) !== 'ok'}
            renderDay={(d) => {
              const day = Number(d.slice(8))
              const requested = store.activeLeaveOn(d) !== null
              return (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', lineHeight: 1 }}>
                  <span>{day}</span>
                  {requested && <span style={{ fontSize: 8, marginTop: 2 }}>申請済み</span>}
                </div>
              )
            }}
          />
        </div>
        {dates.length > 0 && (
          <div style={{ fontSize: 14 }}>
            選んだ日：{[...dates].sort().map(shortDayLabelFromKey).join('、')}（{dates.length}日）
          </div>
        )}
        <div className="dimmed" style={{ fontSize: 12 }}>
          {kind === 'absence' ? '' : '土日・休業日は選べません。'}過去の日は、その月の修正申請の期限まで申請できます。
        </div>
      </Card>

      <Card>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <b style={{ fontSize: 17 }}>理由</b>
          {!isPaid(kind) && <span className="required">必須</span>}
        </div>
        <Textarea autosize minRows={2} maxRows={6} placeholder={isPaid(kind) ? '（任意）' : '理由を入力'} value={reason} onChange={(e) => setReason(e.currentTarget.value)} />
        {isPaid(kind) && (
          <Text size="xs" c="dimmed">
            有給は理由がなくても申請できます
          </Text>
        )}
      </Card>

      <div className="bottom-bar">
        <button className="pill-btn" style={{ background: colors.accent }} disabled={!canSend} onClick={send}>
          <IconSend size={20} /> {dates.length ? `${dates.length}日を申請する` : '申請する'}
        </button>
      </div>
    </Page>
  )
}
