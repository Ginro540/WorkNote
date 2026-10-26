import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { IconChevronLeft, IconChevronRight, IconPencil, IconPhoto, IconScan } from '@tabler/icons-react'
import { monthLabel, shiftMonthKey, shortDayLabelFromKey } from '../../core/workCalendar'
import { emptyExpenseDraft } from '../../data/expenses'
import { expenseStatusLabel, yen, type Expense } from '../../data/models'
import { useObserve } from '../../data/observable'
import { useSession } from '../../data/session'
import { CategoryIcon, HeaderButton, LoadingOverlay, OfflineBanner, Page, StatusBadge, UnsentMark, useFilePicker } from '../../ui/common'
import { categoryStyle, colors, gradients, statusColor } from '../../ui/theme'

/** 経費一覧：月ごとに表示し、月の合計金額と区分別の合計を表示 */
export function ExpenseListPage() {
  const session = useSession()
  const store = useObserve(session.expenses)
  const settings = useObserve(session.settings)
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const thisMonth = settings.period.monthKey(new Date())
  const month = params.get('m') ?? thisMonth
  const [reading, setReading] = useState<number | null>(null)
  const expenses = store.expensesIn(month)

  const read = async (files: File[]) => {
    setReading(0)
    const draft = await store.draftFromReceipt(files[0], setReading)
    setReading(null)
    store.newDraft = draft
    navigate('/expenses/new')
  }
  const camera = useFilePicker(read, { camera: true })
  const album = useFilePicker(read)

  return (
    <Page
      title="経費"
      large
      right={
        <HeaderButton
          label="手入力で経費を作る"
          onClick={() => {
            store.newDraft = emptyExpenseDraft()
            navigate('/expenses/new')
          }}
        >
          <IconPencil size={22} />
        </HeaderButton>
      }
    >
      <OfflineBanner />

      <div className="capture-row">
        <button className="hero-btn" style={{ background: gradients.expense, boxShadow: '0 6px 14px rgba(236,72,153,0.3)' }} onClick={camera.open}>
          <span className="icon">
            <IconScan size={26} />
          </span>
          <span>
            <span style={{ display: 'block', fontSize: 17, fontWeight: 700 }}>領収書を撮影</span>
            <span style={{ display: 'block', fontSize: 12, opacity: 0.9 }}>自動で読み取ります</span>
          </span>
        </button>
        <button className="side-btn" style={{ color: colors.expense }} onClick={album.open}>
          <IconPhoto size={26} />
          写真から
        </button>
      </div>
      {camera.input}
      {album.input}

      <MonthTotalCard month={month} thisMonth={thisMonth} expenses={expenses} onMonth={(m) => setParams({ m }, { replace: true })} />

      {expenses.length === 0 ? (
        <div className="dimmed" style={{ textAlign: 'center', padding: '24px 0', fontSize: 14 }}>
          この月の経費はありません
        </div>
      ) : (
        <div className="card flush">
          {expenses.map((e, i) => (
            <div key={e.id}>
              {i > 0 && <div className="divider" style={{ marginLeft: 76 }} />}
              <ExpenseRow expense={e} isUnsent={store.unsentIds.has(e.id)} />
            </div>
          ))}
        </div>
      )}

      {reading !== null && <LoadingOverlay text="領収書を読み取っています…" progress={reading > 0 ? reading : null} />}
    </Page>
  )
}

/** 月の合計金額と区分別の合計（色の帯） */
function MonthTotalCard({ month, thisMonth, expenses, onMonth }: { month: string; thisMonth: string; expenses: Expense[]; onMonth: (m: string) => void }) {
  const settings = useObserve(useSession().settings)
  const total = expenses.reduce((s, e) => s + e.amount, 0)
  const byCategory = [...expenses.reduce((m, e) => m.set(e.categoryId, (m.get(e.categoryId) ?? 0) + e.amount), new Map<string, number>())]
    .map(([id, amount]) => ({ id, amount }))
    .sort((a, b) => b.amount - a.amount)

  return (
    <div className="card" style={{ padding: 20 }}>
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <HeaderButton onClick={() => onMonth(shiftMonthKey(month, -1))} label="前月">
          <IconChevronLeft size={22} />
        </HeaderButton>
        <b style={{ flex: 1, textAlign: 'center', fontSize: 17 }}>{monthLabel(month)}</b>
        <HeaderButton onClick={() => onMonth(shiftMonthKey(month, 1))} disabled={month >= thisMonth} label="翌月">
          <IconChevronRight size={22} />
        </HeaderButton>
      </div>
      <div>
        <div className="dimmed" style={{ fontSize: 12 }}>
          合計
        </div>
        <div className="num" style={{ fontSize: 40, fontWeight: 700 }}>
          {yen(total)}
        </div>
      </div>
      {total > 0 && (
        <>
          <div className="cat-bar">
            {byCategory.map((c) => (
              <div key={c.id} style={{ flex: `${c.amount} 0 4px`, background: categoryStyle(c.id).color }} />
            ))}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {byCategory.map((c) => (
              <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 14 }}>
                <span style={{ width: 10, height: 10, borderRadius: '50%', background: categoryStyle(c.id).color }} />
                {settings.category(c.id).name}
                <b className="num" style={{ marginLeft: 'auto' }}>
                  {yen(c.amount)}
                </b>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function ExpenseRow({ expense: e, isUnsent }: { expense: Expense; isUnsent: boolean }) {
  const settings = useObserve(useSession().settings)
  return (
    <Link to={`/expenses/${e.id}`} style={{ display: 'flex', alignItems: 'center', gap: 14, padding: 16, color: 'inherit', textDecoration: 'none' }}>
      <CategoryIcon categoryId={e.categoryId} />
      <span style={{ flex: 1, minWidth: 0 }}>
        <b className="ellipsis" style={{ display: 'block', fontSize: 17 }}>
          {e.vendor || '（支払先なし）'}
        </b>
        <span className="dimmed" style={{ fontSize: 12, display: 'flex', gap: 6, alignItems: 'center' }}>
          {shortDayLabelFromKey(e.usedOn)} {settings.category(e.categoryId).name}
          {isUnsent && <UnsentMark />}
        </span>
      </span>
      <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
        <b className="num" style={{ fontSize: 17 }}>
          {yen(e.amount)}
        </b>
        <StatusBadge text={expenseStatusLabel[e.status]} color={statusColor[e.status]} />
      </span>
    </Link>
  )
}
