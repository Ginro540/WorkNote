import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Button, Stack } from '@mantine/core'
import { modals } from '@mantine/modals'
import { IconChevronRight, IconFileText, IconPencil } from '@tabler/icons-react'
import { dayKey, monthLabel, shortDayLabel, shortDayLabelFromKey } from '../../core/workCalendar'
import { reportStatusLabel, reportSummaryLine, type DailyReport } from '../../data/models'
import { useObserve } from '../../data/observable'
import { useSession } from '../../data/session'
import { Chevron, Empty, HeaderButton, OfflineBanner, Page, StatusBadge, UnsentMark } from '../../ui/common'
import { gradients, statusColor } from '../../ui/theme'

/** 日報一覧：日付の新しい順、月ごと。今日の日報がなければ「今日の日報を書く」 */
export function ReportListPage() {
  const store = useObserve(useSession().reports)
  const navigate = useNavigate()
  const today = dayKey(new Date())
  const todayReport = store.reportOn(today)

  const groups = new Map<string, DailyReport[]>()
  for (const r of store.reports) groups.set(r.month, [...(groups.get(r.month) ?? []), r])
  const months = [...groups.keys()].sort().reverse()

  const pickDate = () => {
    modals.open({
      title: '日報の日付',
      centered: true,
      children: (
        <DatePick
          onPick={(d) => {
            modals.closeAll()
            const r = store.reportOn(d)
            navigate(r ? `/reports/${r.id}` : `/reports/write/${d}`)
          }}
        />
      ),
    })
  }

  return (
    <Page
      title="日報"
      large
      right={
        <HeaderButton onClick={pickDate} label="日付を選んで日報を書く">
          <IconPencil size={22} />
        </HeaderButton>
      }
    >
      <OfflineBanner />

      {(!todayReport || todayReport.status === 'draft') && (
        <button
          className="hero-btn"
          style={{ background: gradients.report, boxShadow: '0 8px 16px rgba(30,143,196,0.3)' }}
          onClick={() => navigate(`/reports/write/${today}`)}
        >
          <span className="icon">
            <IconPencil size={26} />
          </span>
          <span style={{ flex: 1 }}>
            <span style={{ display: 'block', fontSize: 20, fontWeight: 700 }}>{todayReport ? '今日の日報を続ける' : '今日の日報を書く'}</span>
            <span style={{ display: 'block', fontSize: 14, opacity: 0.9 }}>
              {shortDayLabel(new Date())}
              {todayReport ? '　下書き' : ''}
            </span>
          </span>
          <IconChevronRight size={22} />
        </button>
      )}

      {store.isLoaded && store.reports.length === 0 && (
        <Empty title="日報はまだありません" icon={<IconFileText size={40} />}>
          「今日の日報を書く」から作成できます。
        </Empty>
      )}

      {months.map((m) => (
        <div key={m} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div className="section-title">{monthLabel(m)}</div>
          {groups.get(m)!.map((r) => (
            <Link key={r.id} to={`/reports/${r.id}`} className="link-card" style={{ padding: 16, borderRadius: 20 }}>
              <span style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <b style={{ fontSize: 17 }}>{shortDayLabelFromKey(r.date)}</b>
                  <StatusBadge text={r.status === 'draft' && r.returnReason ? '差し戻し' : reportStatusLabel[r.status]} color={r.status === 'draft' && r.returnReason ? statusColor.returned : statusColor[r.status]} />
                  {store.unsentIds.has(r.id) && <UnsentMark />}
                </span>
                <span className="dimmed ellipsis" style={{ fontSize: 14 }}>
                  {reportSummaryLine(r) || '内容なし'}
                </span>
              </span>
              <Chevron />
            </Link>
          ))}
        </div>
      ))}
    </Page>
  )
}

function DatePick({ onPick }: { onPick: (dayKey: string) => void }) {
  const today = dayKey(new Date())
  const [value, setValue] = useState(today)
  return (
    <Stack>
      <input type="date" className="native-picker" style={{ fontSize: 18, padding: 10 }} value={value} max={today} onChange={(e) => setValue(e.target.value)} />
      <Button onClick={() => value && value <= today && onPick(value)} disabled={!value || value > today}>
        書く
      </Button>
    </Stack>
  )
}
