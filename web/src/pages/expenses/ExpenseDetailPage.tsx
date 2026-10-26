import { useNavigate, useParams } from 'react-router-dom'
import { IconArrowBackUp, IconCurrencyYen, IconSend } from '@tabler/icons-react'
import { shortDayLabel, shortDayLabelFromKey, timeLabel } from '../../core/workCalendar'
import { expenseStatusLabel, yen, type Expense } from '../../data/models'
import { useObserve } from '../../data/observable'
import { useSession } from '../../data/session'
import { alertMessage, CategoryIcon, confirmAction, Empty, HeaderButton, openImageViewer, Page, StatusBadge, StoredImage, UnsentMark } from '../../ui/common'
import { colors, gradients, statusColor } from '../../ui/theme'

/**
 * 経費の詳細：金額・お店・区分・インボイス番号・メモと領収書の画像。
 * 承認前なら修正と申請の取り消し（下書きに戻す）ができる
 */
export function ExpenseDetailPage() {
  const { id = '' } = useParams()
  const session = useSession()
  const store = useObserve(session.expenses)
  const settings = useObserve(session.settings)
  const navigate = useNavigate()
  const e = store.expense(id)

  if (!e) {
    return (
      <Page title="経費" back="/expenses" backLabel="経費">
        {store.isLoaded && <Empty title="経費が見つかりません" icon={<IconCurrencyYen size={40} />} />}
      </Page>
    )
  }

  const dateTime = (d: Date) => `${shortDayLabel(d)} ${timeLabel(d)}`
  const rows: [string, string][] = [
    ['利用日', shortDayLabelFromKey(e.usedOn)],
    ['区分', settings.category(e.categoryId).name],
    ['インボイス番号', e.invoiceNumber || '—'],
    ['メモ', e.memo || '—'],
    ...(e.submittedAt ? [['申請日時', dateTime(e.submittedAt)] as [string, string]] : []),
    ...(e.updatedAt ? [['更新日時', dateTime(e.updatedAt)] as [string, string]] : []),
  ]

  return (
    <Page
      title="経費"
      back="/expenses"
      backLabel="経費"
      right={
        e.status !== 'approved' && (
          <HeaderButton bold onClick={() => navigate(`/expenses/edit/${e.id}`)}>
            修正する
          </HeaderButton>
        )
      }
    >
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10, paddingTop: 8 }}>
        <CategoryIcon categoryId={e.categoryId} size={64} />
        <div className="num" style={{ fontSize: 44, fontWeight: 700 }}>
          {yen(e.amount)}
        </div>
        <div style={{ fontSize: 20, fontWeight: 600, textAlign: 'center' }}>{e.vendor}</div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <StatusBadge text={expenseStatusLabel[e.status]} color={statusColor[e.status]} />
          {store.unsentIds.has(e.id) && <UnsentMark />}
        </div>
      </div>

      {e.status === 'returned' && e.returnReason && (
        <div style={{ color: colors.warning, fontSize: 14, display: 'flex', gap: 6 }}>
          <IconArrowBackUp size={18} style={{ flexShrink: 0 }} /> 差し戻し：{e.returnReason}
        </div>
      )}

      <div className="card list">
        {rows.map(([label, value]) => (
          <div key={label} className="row" style={{ alignItems: 'flex-start' }}>
            <span className="label">{label}</span>
            <span className="value pre">{value}</span>
          </div>
        ))}
      </div>

      {e.receiptPath && (
        <div style={{ borderRadius: 16, overflow: 'hidden', background: 'var(--card)', minHeight: 200 }} aria-label="領収書の画像を拡大">
          <StoredImage path={e.receiptPath} fit="contain" onClick={openImageViewer} />
        </div>
      )}

      <Actions expense={e} onDeleted={() => navigate('/expenses', { replace: true })} />
    </Page>
  )
}

function Actions({ expense: e, onDeleted }: { expense: Expense; onDeleted: () => void }) {
  const store = useSession().expenses
  const danger = { color: 'var(--mantine-color-red-6)', alignSelf: 'center', fontSize: 14 } as const
  switch (e.status) {
    case 'draft':
    case 'returned':
      return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <button
            className="pill-btn"
            style={{ background: gradients.expense, minHeight: 52 }}
            onClick={() => store.submit(e).catch((err) => alertMessage((err as Error).message))}
          >
            <IconSend size={20} /> 申請する
          </button>
          <button
            className="header-btn"
            style={danger}
            onClick={() =>
              confirmAction({
                title: 'この下書きを削除しますか？',
                confirm: '削除',
                danger: true,
                onConfirm: () => {
                  store.deleteDraft(e)
                  onDeleted()
                },
              })
            }
          >
            下書きを削除
          </button>
        </div>
      )
    case 'submitted':
      return (
        <button
          className="header-btn"
          style={danger}
          onClick={() =>
            confirmAction({ title: '申請を取り消して下書きに戻しますか？', confirm: '申請を取り消す', danger: true, onConfirm: () => store.cancelSubmission(e) })
          }
        >
          申請を取り消す（下書きに戻す）
        </button>
      )
    case 'approved':
      return (
        <div className="dimmed" style={{ fontSize: 12 }}>
          承認済みのため修正できません。直す必要があるときは管理者に連絡してください。
        </div>
      )
  }
}
