import { useState } from 'react'
import { Button, NumberInput, Radio, Select, Stack, Text, Textarea } from '@mantine/core'
import { modals } from '@mantine/modals'
import type { DaySummary, WorkSession } from '../../core/attendance'
import { addDays, dateFromDayKey, jstParts, makeDate, shortDayLabel, shortDayLabelFromKey, timeLabel } from '../../core/workCalendar'
import { correctionKindLabel, type CorrectionKind } from '../../data/models'
import type { AppSession } from '../../data/session'
import { alertMessage } from '../../ui/common'

const pad2 = (n: number) => String(n).padStart(2, '0')

/** "YYYY-MM-DDTHH:mm"（日本時間）⇔ Date */
function toInput(d: Date) {
  const p = jstParts(d)
  return `${p.year}-${pad2(p.month)}-${pad2(p.day)}T${pad2(p.hour)}:${pad2(p.minute)}`
}
function fromInput(s: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(s)
  return m ? makeDate(+m[1], +m[2], +m[3], +m[4], +m[5]) : null
}

export function openCorrectionRequest(session: AppSession, workDate: string, summary: DaySummary) {
  modals.open({
    title: '修正申請',
    fullScreen: true,
    children: <CorrectionRequest session={session} workDate={workDate} summary={summary} onClose={() => modals.closeAll()} />,
  })
}

/** 打刻の修正申請：対象の日と勤務を選び、正しい内容と理由を入力する */
function CorrectionRequest({ session, workDate, summary, onClose }: { session: AppSession; workDate: string; summary: DaySummary; onClose: () => void }) {
  const { settings, attendance } = session
  const date = dateFromDayKey(workDate)!
  const sessions = summary.sessions
  const last = sessions[sessions.length - 1]

  const initialKind: CorrectionKind = sessions.some((s) => !s.clockIn)
    ? 'missingClockIn'
    : sessions.some((s) => !s.clockOut)
      ? 'missingClockOut'
      : sessions.length
        ? 'wrongTime'
        : 'missingClockIn'
  const [kind, setKind] = useState<CorrectionKind>(initialKind)
  const [sessionIndex, setSessionIndex] = useState(Math.max(0, sessions.length - 1))
  const [clockIn, setClockIn] = useState(toInput(last?.clockIn?.time ?? makeDate(...ymd(date), 9, 0)!))
  const [clockOut, setClockOut] = useState(toInput(last?.clockOut?.time ?? makeDate(...ymd(date), 18, 0)!))
  const [breakMinutes, setBreakMinutes] = useState<number>(0)
  const [reason, setReason] = useState('')

  // 選べる時刻の範囲（日付をまたぐ勤務のため翌日まで）
  const min = toInput(date)
  const max = toInput(new Date(addDays(2, date).getTime() - 60_000))

  const needsSession = kind !== 'noBreak' && sessions.length > 0
  const selected: WorkSession | null = sessions[sessionIndex] ?? null
  const needsClockOutForMissingIn = !selected || !selected.clockOut

  const selectSession = (i: number) => {
    setSessionIndex(i)
    const s = sessions[i]
    if (s?.clockIn) setClockIn(toInput(s.clockIn.time))
    if (s?.clockOut) setClockOut(toInput(s.clockOut.time))
  }

  const monthKey = settings.period.monthKey(date)
  const deadline = settings.correctionDeadline(monthKey)

  const submit = () => {
    if (!settings.canRequestCorrection(monthKey)) {
      alertMessage('この月の修正申請の期限を過ぎています。管理者に連絡してください。')
      return
    }
    let requestedIn: Date | null = null
    let requestedOut: Date | null = null
    let requestedBreak: number | null = null
    switch (kind) {
      case 'missingClockIn':
        requestedIn = fromInput(clockIn)
        if (needsClockOutForMissingIn) requestedOut = fromInput(clockOut)
        break
      case 'missingClockOut':
        requestedOut = fromInput(clockOut)
        break
      case 'wrongTime':
        requestedIn = fromInput(clockIn)
        requestedOut = fromInput(clockOut)
        break
      case 'noBreak':
        requestedBreak = breakMinutes
        break
    }
    if ((kind !== 'noBreak' && !requestedIn && !requestedOut) || (requestedIn && requestedOut && requestedOut <= requestedIn)) {
      alertMessage('退勤時刻は出勤時刻より後にしてください。')
      return
    }
    const targets = needsSession ? [selected?.clockIn?.id, selected?.clockOut?.id].filter((x): x is string => !!x) : []
    attendance.submitCorrection({
      workDate,
      month: monthKey,
      targetPunchIds: targets,
      kind,
      requestedClockIn: requestedIn,
      requestedClockOut: requestedOut,
      requestedBreakMinutes: requestedBreak,
      reason: reason.trim(),
    })
    onClose()
  }

  const sessionLabel = (s: WorkSession) => `${s.clockIn ? timeLabel(s.clockIn.time) : '--:--'}〜${s.clockOut ? timeLabel(s.clockOut.time) : '--:--'}`
  const timeInput = (label: string, value: string, set: (v: string) => void) => (
    <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
      <Text size="sm">{label}</Text>
      <input type="datetime-local" className="native-picker" value={value} min={min} max={max} onChange={(e) => set(e.target.value)} />
    </label>
  )

  return (
    <Stack gap="lg" pb="xl">
      <Text size="sm">
        対象の日：<b>{shortDayLabelFromKey(workDate)}</b>
      </Text>
      <Select
        label="申請の種類"
        value={kind}
        onChange={(v) => v && setKind(v as CorrectionKind)}
        data={Object.entries(correctionKindLabel).map(([value, label]) => ({ value, label }))}
        allowDeselect={false}
        comboboxProps={{ withinPortal: true }}
      />

      {needsSession && (
        <Radio.Group label="対象の勤務" value={String(sessionIndex)} onChange={(v) => selectSession(Number(v))}>
          <Stack gap={8} mt={6}>
            {sessions.map((s, i) => (
              <Radio key={i} value={String(i)} label={`${i + 1}回目（${sessionLabel(s)}）`} />
            ))}
            {kind === 'missingClockIn' && <Radio value={String(sessions.length)} label="新しい勤務（中抜け後の再出勤など）" />}
          </Stack>
        </Radio.Group>
      )}

      <Stack gap="sm">
        <Text size="sm" fw={600}>
          正しい内容
        </Text>
        {kind === 'missingClockIn' && (
          <>
            {timeInput('出勤時刻', clockIn, setClockIn)}
            {needsClockOutForMissingIn && timeInput('退勤時刻', clockOut, setClockOut)}
          </>
        )}
        {kind === 'missingClockOut' && timeInput('退勤時刻', clockOut, setClockOut)}
        {kind === 'wrongTime' && (
          <>
            {timeInput('出勤時刻', clockIn, setClockIn)}
            {timeInput('退勤時刻', clockOut, setClockOut)}
          </>
        )}
        {kind === 'noBreak' && (
          <NumberInput label="実際に取った休憩（分）" value={breakMinutes} onChange={(v) => setBreakMinutes(Number(v) || 0)} min={0} max={180} step={5} />
        )}
      </Stack>

      <Textarea label="理由（必須）" autosize minRows={3} maxRows={6} value={reason} onChange={(e) => setReason(e.currentTarget.value)} />
      {deadline && (
        <Text size="xs" c="dimmed">
          管理者が承認すると勤怠に反映されます。承認されるまでは元の記録のままです。申請の期限は {shortDayLabel(deadline)} までです。
        </Text>
      )}

      <Stack gap="xs">
        <Button size="lg" radius="xl" onClick={submit} disabled={reason.trim() === ''}>
          申請する
        </Button>
        <Button size="md" variant="subtle" onClick={onClose}>
          キャンセル
        </Button>
      </Stack>
    </Stack>
  )
}

function ymd(d: Date): [number, number, number] {
  const p = jstParts(d)
  return [p.year, p.month, p.day]
}
