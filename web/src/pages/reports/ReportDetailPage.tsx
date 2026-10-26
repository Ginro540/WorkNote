import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { query } from 'firebase/firestore'
import { IconArrowBackUp, IconFileUnknown, IconHistory } from '@tabler/icons-react'
import { parseTimeRange, timeRangeLabel } from '../../core/timeRange'
import { shortDayLabelFromKey } from '../../core/workCalendar'
import { parseRevision, reportStatusLabel, type ReportField, type ReportRevision } from '../../data/models'
import { listenQuery, useObserve } from '../../data/observable'
import { revisionsCollection } from '../../data/reports'
import { useSession } from '../../data/session'
import { Card, Chevron, Empty, HeaderButton, openImageViewer, Page, StatusBadge, StoredImage, UnsentMark } from '../../ui/common'
import { colors, statusColor } from '../../ui/theme'
import { monthDayTime } from '../attendance/parts'

/** 項目の表示用の文字 */
export function displayValue(field: ReportField, values: Record<string, string>): string {
  const raw = (values[field.key] ?? '').trim()
  if (!raw) return '—'
  if (field.type === 'timeRange') {
    const r = parseTimeRange(raw)
    if (r) return timeRangeLabel(r)
  }
  return raw
}

/** 日報の修正履歴を読む */
export function useRevisions(reportId: string) {
  const [revisions, setRevisions] = useState<ReportRevision[]>([])
  useEffect(() => {
    if (!reportId) return
    return listenQuery(query(revisionsCollection(reportId)), (id, d) => parseRevision(id, d), (items) =>
      setRevisions(items.sort((a, b) => a.editedAt.getTime() - b.editedAt.getTime())),
    )
  }, [reportId])
  return revisions
}

/** 日報の詳細：提出した内容を表示。承認前なら「修正する」で直せる。修正した日報には「修正履歴」が出る */
export function ReportDetailPage() {
  const { id = '' } = useParams()
  const session = useSession()
  const store = useObserve(session.reports)
  const settings = useObserve(session.settings)
  const navigate = useNavigate()
  const revisions = useRevisions(id)
  const report = store.report(id)

  if (!report) {
    return (
      <Page title="日報" back="/reports" backLabel="日報">
        {store.isLoaded && <Empty title="日報が見つかりません" icon={<IconFileUnknown size={40} />} />}
      </Page>
    )
  }

  const fields = settings.template.filter((f) => f.type !== 'date' && f.type !== 'photos')
  const isReturned = report.status === 'draft' && !!report.returnReason

  return (
    <Page
      title={shortDayLabelFromKey(report.date)}
      back="/reports"
      backLabel="日報"
      right={
        report.status !== 'approved' && (
          <HeaderButton bold onClick={() => navigate(`/reports/write/${report.date}`)}>
            {report.status === 'draft' ? '編集する' : '修正する'}
          </HeaderButton>
        )
      }
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <StatusBadge text={isReturned ? '差し戻し' : reportStatusLabel[report.status]} color={isReturned ? statusColor.returned : statusColor[report.status]} />
        {store.unsentIds.has(report.id) && <UnsentMark />}
        {report.submittedAt && (
          <span className="dimmed" style={{ marginLeft: 'auto', fontSize: 12 }}>
            提出 {monthDayTime(report.submittedAt)}
          </span>
        )}
      </div>

      {isReturned && (
        <div style={{ color: colors.warning, fontSize: 14, display: 'flex', gap: 6 }}>
          <IconArrowBackUp size={18} style={{ flexShrink: 0 }} /> 差し戻し：{report.returnReason}
        </div>
      )}

      <div className="card list">
        {fields.map((f) => (
          <div key={f.key} className="row" style={{ flexDirection: 'column', alignItems: 'stretch', gap: 6 }}>
            <span className="dimmed" style={{ fontSize: 12 }}>
              {f.label}
            </span>
            <span className="pre">{displayValue(f, report.values)}</span>
          </div>
        ))}
      </div>

      {report.photoPaths.length > 0 && (
        <Card>
          <span className="dimmed" style={{ fontSize: 12 }}>
            写真（{report.photoPaths.length}枚）
          </span>
          <div className="photo-grid">
            {report.photoPaths.map((path) => (
              <div key={path} className="photo-tile">
                <StoredImage path={path} onClick={openImageViewer} />
              </div>
            ))}
          </div>
        </Card>
      )}

      {revisions.length > 0 && (
        <Link to={`/reports/${report.id}/history`} className="link-card" style={{ padding: 18 }}>
          <IconHistory size={20} color="var(--mantine-color-blue-6)" />
          <span style={{ flex: 1 }}>修正履歴（{revisions.length}件）</span>
          <Chevron />
        </Link>
      )}
    </Page>
  )
}
