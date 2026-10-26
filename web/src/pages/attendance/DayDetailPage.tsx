import { lazy, Suspense } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { IconAlertTriangleFilled, IconClock, IconFileTextFilled, IconFlag, IconPencil } from '@tabler/icons-react'
import type { DaySummary, WorkSession } from '../../core/attendance'
import { dateFromDayKey, durationLabel, shortDayLabelFromKey } from '../../core/workCalendar'
import { leaveKindLabel, reportStatusLabel, reportSummaryLine } from '../../data/models'
import { useObserve } from '../../data/observable'
import { useSession } from '../../data/session'
import { Card, Chevron, Page, StatusBadge } from '../../ui/common'
import { colors, gradients, statusColor } from '../../ui/theme'
import { openCorrectionRequest } from './CorrectionRequest'
import { LeaveStatusBadge, openCancel } from './LeaveCard'
import { CorrectionCard, PunchRow, usePunches } from './parts'

// 地図の部品（Leaflet）は大きいので、この画面を開いたときに読み込む
const PunchMap = lazy(() => import('./PunchMap').then((m) => ({ default: m.PunchMap })))

/** 日ごとの詳細：勤務ごとの出勤・退勤の時刻と場所、地図。集計と、その日の日報へのリンク */
export function DayDetailPage() {
  const { date: dayKey = '' } = useParams()
  const session = useSession()
  const store = useObserve(session.attendance)
  const settings = useObserve(session.settings)
  const reports = useObserve(session.reports)
  const leaveStore = useObserve(session.leaves)
  const navigate = useNavigate()
  const { punches, isLoaded } = usePunches('workDate', dayKey)

  const date = dateFromDayKey(dayKey)
  if (!date) return <Page title="勤怠" back={true}>日付が正しくありません</Page>

  const summary = store.summary(dayKey, punches)
  const corrections = store.correctionsOn(dayKey)
  const monthKey = settings.period.monthKey(date)
  const isPastOrToday = date <= new Date()
  const canRequest = settings.canRequestCorrection(monthKey) && isPastOrToday
  const holiday = settings.holiday(dayKey)
  const report = reports.reportOn(dayKey)
  const leaves = leaveStore.leavesOn(dayKey)

  const punchesOf = (s: WorkSession) => {
    const ids = [s.clockIn?.id, s.clockOut?.id]
    return punches.filter((p) => ids.includes(p.id))
  }

  return (
    <Page title={shortDayLabelFromKey(dayKey)} back={true}>
      {holiday && (
        <div style={{ color: colors.holiday, fontSize: 14, display: 'flex', gap: 6, alignItems: 'center' }}>
          <IconFlag size={16} /> {holiday.name}
        </div>
      )}

      {leaves.length > 0 && (
        <Card>
          <b style={{ fontSize: 15 }}>休暇</b>
          {leaves.map((l) => (
            <div key={l.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14, flexWrap: 'wrap' }}>
              <span>{leaveKindLabel[l.kind]}</span>
              <LeaveStatusBadge leave={l} />
              {l.status === 'rejected' && l.rejectReason && <span style={{ color: 'var(--mantine-color-red-6)', fontSize: 12 }}>却下の理由：{l.rejectReason}</span>}
              {l.status === 'pending' && (
                <button className="header-btn" style={{ marginLeft: 'auto', color: 'var(--mantine-color-red-6)', padding: 0, fontSize: 14 }} onClick={() => openCancel(leaveStore, [l])}>
                  取り消す
                </button>
              )}
            </div>
          ))}
        </Card>
      )}

      {isLoaded && summary.sessions.length === 0 && (
        <Card>
          <span className="dimmed">この日の打刻はありません</span>
        </Card>
      )}

      {summary.sessions.map((s, i) => {
        const list = punchesOf(s)
        const isWorking = summary.status === 'working' && i === summary.sessions.length - 1
        return (
          <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div className="section-title" style={{ fontSize: 15 }}>
              {i + 1}回目の勤務
            </div>
            <Card className="flush">
              <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 14 }}>
                {!s.clockIn && (
                  <div style={{ color: 'var(--mantine-color-red-6)', fontSize: 14, display: 'flex', gap: 6 }}>
                    <IconAlertTriangleFilled size={18} /> 出勤の打刻がありません
                  </div>
                )}
                {list.map((p, j) => (
                  <div key={p.id} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                    {j > 0 && <div className="divider" />}
                    <PunchRow punch={p} />
                  </div>
                ))}
                {!s.clockOut &&
                  (isWorking ? (
                    <div style={{ color: colors.clockIn, fontSize: 14, display: 'flex', gap: 6 }}>
                      <IconClock size={18} /> 勤務中
                    </div>
                  ) : (
                    <div style={{ color: colors.warning, fontSize: 14, display: 'flex', gap: 6 }}>
                      <IconAlertTriangleFilled size={18} /> 退勤の打刻がありません（退勤漏れ）
                    </div>
                  ))}
              </div>
              <Suspense fallback={null}>
                <PunchMap punches={list} />
              </Suspense>
            </Card>
          </div>
        )
      })}

      {summary.sessions.length > 0 && <SummaryCard summary={summary} breakCorrected={store.approvedBreakOverride(dayKey) !== null} />}

      <button className="link-card" onClick={() => navigate(report ? `/reports/${report.id}` : `/reports/write/${dayKey}`)}>
        <span
          style={{ width: 36, height: 36, borderRadius: 10, background: gradients.report, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}
        >
          <IconFileTextFilled size={20} />
        </span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <b style={{ fontSize: 14 }}>この日の日報</b>
            {report && <StatusBadge text={reportStatusLabel[report.status]} color={statusColor[report.status]} />}
          </span>
          <span className="ellipsis" style={{ display: 'block', fontSize: 12, color: report ? 'var(--dimmed)' : colors.warning }}>
            {report ? reportSummaryLine(report) || '内容なし' : '日報未提出'}
          </span>
        </span>
        <Chevron />
      </button>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div className="section-title" style={{ fontSize: 15 }}>
          修正申請
        </div>
        {corrections.map((c) => (
          <CorrectionCard key={c.id} correction={c} />
        ))}
        {canRequest ? (
          <button className="pill-btn gray" style={{ minHeight: 48, color: 'var(--mantine-color-blue-6)' }} onClick={() => openCorrectionRequest(session, dayKey, summary)}>
            <IconPencil size={18} /> 修正を申請する
          </button>
        ) : (
          isPastOrToday && (
            <div className="dimmed" style={{ fontSize: 12 }}>
              この月の修正申請の期限を過ぎています。修正が必要なときは管理者に連絡してください。
            </div>
          )
        )}
      </div>
    </Page>
  )
}

function SummaryCard({ summary, breakCorrected }: { summary: DaySummary; breakCorrected: boolean }) {
  const row = (title: string, minutes: number | null, color?: string) => (
    <div style={{ display: 'flex', fontSize: 14 }}>
      <span className="dimmed">{title}</span>
      <span className="num" style={{ marginLeft: 'auto', color }}>
        {minutes === null ? '—' : durationLabel(minutes)}
      </span>
    </div>
  )
  return (
    <Card>
      <b style={{ fontSize: 17 }}>集計</b>
      {summary.workMinutes === null ? (
        <span className="dimmed" style={{ fontSize: 14 }}>
          {summary.status === 'working' ? '勤務が終わると集計します' : '打刻漏れがあるため集計できません。修正申請をしてください。'}
        </span>
      ) : (
        <>
          {row('拘束時間', summary.spanMinutes)}
          {row('中抜け', summary.gapMinutes)}
          {row(breakCorrected ? '休憩（修正済み）' : '休憩（自動）', summary.deductedBreakMinutes)}
          <div className="divider" />
          <div style={{ display: 'flex', alignItems: 'center' }}>
            <b style={{ fontSize: 17 }}>実働</b>
            <span className="num" style={{ marginLeft: 'auto', fontSize: 22, fontWeight: 700 }}>
              {durationLabel(summary.workMinutes)}
            </span>
          </div>
          {(summary.overtimeMinutes ?? 0) > 0 && row('時間外', summary.overtimeMinutes, colors.warning)}
        </>
      )}
    </Card>
  )
}
