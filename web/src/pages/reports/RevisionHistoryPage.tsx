import { useParams } from 'react-router-dom'
import { IconCornerDownRight } from '@tabler/icons-react'
import { shortDayLabel, shortDayLabelFromKey, timeLabel } from '../../core/workCalendar'
import type { DailyReport, ReportField, ReportRevision } from '../../data/models'
import { useObserve } from '../../data/observable'
import { useSession } from '../../data/session'
import { Card, Page } from '../../ui/common'
import { displayValue, useRevisions } from './ReportDetailPage'

interface Change {
  id: string
  label: string
  before: string
  after: string
}

/** 修正履歴：いつ・どの項目が・どう変わったか。修正前の内容は取り消し線で表示 */
export function RevisionHistoryPage() {
  const { id = '' } = useParams()
  const session = useSession()
  const store = useObserve(session.reports)
  const settings = useObserve(session.settings)
  const revisions = useRevisions(id)
  const report = store.report(id)

  /** i 番目の修正で変わった項目（修正前 = revisions[i]、修正後 = 次の履歴か今の内容） */
  const changes = (report: DailyReport, i: number): Change[] => {
    const before: ReportRevision = revisions[i]
    const next = revisions[i + 1]
    const afterValues = next ? next.values : report.values
    const afterPhotos = next ? next.photoPaths : report.photoPaths
    const result: Change[] = []
    if (before.values.date) {
      result.push({ id: 'date', label: '日付', before: shortDayLabelFromKey(before.values.date), after: shortDayLabelFromKey(afterValues.date ?? report.date) })
    }
    const templateKeys = settings.template.map((f) => f.key)
    const extraKeys = [...new Set([...Object.keys(before.values), ...Object.keys(afterValues)])]
      .filter((k) => !templateKeys.includes(k) && k !== 'date')
      .sort()
    for (const key of [...templateKeys, ...extraKeys]) {
      const field: ReportField = settings.template.find((f) => f.key === key) ?? { key, label: key, type: 'text', required: false, order: 0 }
      if (field.type === 'date' || field.type === 'photos') continue
      const old = displayValue(field, before.values)
      const now = displayValue(field, afterValues)
      if (old !== now) result.push({ id: key, label: field.label, before: old, after: now })
    }
    if (before.photoPaths.join('\n') !== afterPhotos.join('\n')) {
      result.push({ id: 'photos', label: '写真', before: `${before.photoPaths.length}枚`, after: `${afterPhotos.length}枚` })
    }
    return result
  }

  return (
    <Page title="修正履歴" back={`/reports/${id}`}>
      {report &&
        revisions
          .map((r, i) => ({ r, i }))
          .reverse()
          .map(({ r, i }) => {
            const list = changes(report, i)
            return (
              <div key={r.id} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <div className="section-title" style={{ fontSize: 15 }}>
                  {shortDayLabel(r.editedAt)} {timeLabel(r.editedAt)} に修正
                </div>
                {list.length === 0 && (
                  <Card>
                    <span className="dimmed">内容の変更はありません</span>
                  </Card>
                )}
                {list.map((c) => (
                  <Card key={c.id}>
                    <span className="dimmed" style={{ fontSize: 12 }}>
                      {c.label}
                    </span>
                    <span className="strike pre">{c.before}</span>
                    <span style={{ display: 'flex', gap: 12 }}>
                      <IconCornerDownRight size={18} color="var(--mantine-color-blue-6)" style={{ flexShrink: 0 }} />
                      <span className="pre">{c.after}</span>
                    </span>
                  </Card>
                ))}
              </div>
            )
          })}
      <div className="dimmed" style={{ fontSize: 12, paddingLeft: 6 }}>
        修正履歴は本人も管理者も削除できません。
      </div>
    </Page>
  )
}
