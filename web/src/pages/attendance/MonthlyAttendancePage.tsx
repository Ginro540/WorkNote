import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { IconBeach, IconChevronLeft, IconChevronRight } from '@tabler/icons-react'
import type { DaySummary } from '../../core/attendance'
import { dateFromDayKey, dayKey, durationLabel, monthLabel, shiftMonthKey, shortDayLabel, timeLabel, weekday } from '../../core/workCalendar'
import { daysLabel, leaveTotals } from '../../core/leave'
import { isHalfDayLeave, leaveKindShort, reportSummaryLine, type AttendanceCorrection, type DailyReport, type Holiday, type LeaveRequest } from '../../data/models'
import { useObserve } from '../../data/observable'
import { useSession } from '../../data/session'
import { Card, Chevron, HeaderButton, Page, StatusBadge } from '../../ui/common'
import { colors } from '../../ui/theme'
import { usePunches } from './parts'

/** 月の勤怠：1日を2行で表示（1行目に時刻と実働時間、2行目に日報の内容） */
export function MonthlyAttendancePage() {
  const session = useSession()
  const store = useObserve(session.attendance)
  const settings = useObserve(session.settings)
  const reports = useObserve(session.reports)
  const leaves = useObserve(session.leaves)
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const thisMonth = settings.period.monthKey(new Date())
  const month = params.get('m') ?? thisMonth
  const setMonth = (m: string) => setParams({ m }, { replace: true })

  const { punches } = usePunches('month', month)
  const days = settings.period.dayKeys(month)
  const summaries = new Map(days.map((key) => [key, store.summary(key, punches.filter((p) => p.workDate === key))]))
  const all = [...summaries.values()]
  const workedDays = all.filter((s) => s.sessions.length > 0).length
  const totalWork = all.reduce((sum, s) => sum + (s.workMinutes ?? 0), 0)
  const totalOvertime = all.reduce((sum, s) => sum + (s.overtimeMinutes ?? 0), 0)
  const deadline = settings.correctionDeadline(month)
  // 休暇は month で絞らず、日付で選ぶ（締め日を変えたあとも正しく出るように）
  const leaveTotal = leaveTotals(leaves.leaves, days)
  const hasLeave = leaveTotal.paid + leaveTotal.special + leaveTotal.absence > 0

  /** 備考をタップするとその日の日報を開く（なければ書く） */
  const openReport = (key: string) => {
    const report = reports.reportOn(key)
    navigate(report ? `/reports/${report.id}` : `/reports/write/${key}`)
  }

  return (
    <Page
      title={monthLabel(month)}
      back="/"
      backLabel="勤怠"
      right={
        <>
          <HeaderButton onClick={() => navigate('/attendance/leaves/new')} label="休暇を申請">
            <IconBeach size={22} />
          </HeaderButton>
          <HeaderButton onClick={() => setMonth(shiftMonthKey(month, -1))} label="前月">
            <IconChevronLeft size={22} />
          </HeaderButton>
          <HeaderButton onClick={() => setMonth(shiftMonthKey(month, 1))} disabled={month >= thisMonth} label="翌月">
            <IconChevronRight size={22} />
          </HeaderButton>
        </>
      }
    >
      <Card>
        <div className="stats">
          <div>
            <div className="t">出勤日数</div>
            <div className="v">{workedDays}日</div>
          </div>
          <div>
            <div className="t">合計実働</div>
            <div className="v">{durationLabel(totalWork)}</div>
          </div>
          <div>
            <div className="t">時間外</div>
            <div className="v">{durationLabel(totalOvertime)}</div>
          </div>
        </div>
        {hasLeave && (
          <div style={{ fontSize: 13, textAlign: 'center' }}>
            有給 {daysLabel(leaveTotal.paid)}日・特別休暇 {daysLabel(leaveTotal.special)}日・欠勤 {daysLabel(leaveTotal.absence)}日
          </div>
        )}
        {deadline && (
          <div className="dimmed" style={{ fontSize: 12 }}>
            修正申請の期限：{shortDayLabel(deadline)}まで
          </div>
        )}
      </Card>

      <Card className="flush">
        {days.map((key) => (
          <DayRow
            key={key}
            dayKey={key}
            summary={summaries.get(key)!}
            report={reports.reportOn(key)}
            corrections={store.correctionsOn(key)}
            holiday={settings.holiday(key)}
            leave={leaves.activeLeaveOn(key)}
            onOpenReport={() => openReport(key)}
          />
        ))}
      </Card>

      <Link to="/attendance/leaves" className="link-card">
        <span style={{ flex: 1 }}>休暇の申請の一覧</span>
        <Chevron />
      </Link>
      <Link to="/attendance/corrections" className="link-card">
        <span style={{ flex: 1 }}>修正申請の一覧</span>
        <Chevron />
      </Link>
    </Page>
  )
}

/** 月の勤怠の1日分 */
function DayRow(props: {
  dayKey: string
  summary: DaySummary
  report: DailyReport | null
  corrections: AttendanceCorrection[]
  holiday: Holiday | null
  /** 申請中・承認済みの休暇 */
  leave: LeaveRequest | null
  onOpenReport: () => void
}) {
  const { summary, report, holiday, leave } = props
  const date = dateFromDayKey(props.dayKey)!
  const w = weekday(date)
  const dayColor = w === 1 || holiday ? colors.holiday : w === 7 ? colors.saturday : undefined
  const first = summary.firstIn ?? summary.sessions[0]?.clockOut?.time ?? null

  let badge = null
  if (props.corrections.some((c) => c.status === 'pending')) badge = <StatusBadge text="修正申請中" color={colors.warning} />
  else if (summary.status === 'missingPunch') badge = <StatusBadge text="退勤漏れ" color="red" />
  else if (summary.status === 'working') badge = <StatusBadge text="勤務中" color={colors.clockIn} />

  return (
    <div className="day-row">
      <Link to={`/attendance/day/${props.dayKey}`} className="main">
        <span className="date" style={{ color: dayColor }}>
          {shortDayLabel(date)}
        </span>
        {leave && (
          <span style={{ fontSize: 13, fontWeight: 600, color: colors.reportGreen, opacity: leave.status === 'pending' ? 0.55 : 1 }}>
            {leaveKindShort[leave.kind]}
            {leave.status === 'pending' && '（申請中）'}
          </span>
        )}
        {first ? (
          <span className="num" style={{ fontSize: 14 }}>
            {timeLabel(first)}〜{summary.lastOut ? timeLabel(summary.lastOut) : ''}
            {summary.sessions.length > 1 && (
              <span className="dimmed" style={{ fontSize: 11, marginLeft: 4 }}>
                {summary.sessions.length}回
              </span>
            )}
          </span>
        ) : (
          holiday && !leave && <span style={{ fontSize: 12, color: colors.holiday }}>{holiday.name}</span>
        )}
        <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          {badge}
          {summary.workMinutes !== null && (
            <b className="num" style={{ fontSize: 14 }}>
              {durationLabel(summary.workMinutes)}
            </b>
          )}
          <Chevron />
        </span>
      </Link>
      {/* 2行目：その日の日報（訪問先・現場名 ／ 作業内容の1行目） */}
      {report ? (
        <button className="remark ellipsis" onClick={props.onOpenReport}>
          {(report.status === 'draft' ? '（下書き）' : '') + (reportSummaryLine(report) || '内容なし')}
        </button>
      ) : (
        summary.sessions.length > 0 &&
        props.dayKey <= dayKey(new Date()) &&
        // 承認された全日の休暇の日は、日報の未提出に数えない
        !(leave?.status === 'approved' && !isHalfDayLeave(leave.kind)) && (
          <button className="remark" style={{ color: colors.warning, fontWeight: 600 }} onClick={props.onOpenReport}>
            日報未提出
          </button>
        )
      )}
    </div>
  )
}
