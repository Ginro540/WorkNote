import { useState, type ReactNode } from 'react'
import { Navigate, useNavigate, useParams } from 'react-router-dom'
import { Center, Loader } from '@mantine/core'
import { IconArrowBackUp, IconArrowsMaximize, IconFileText, IconPhoto, IconScan, IconSend, IconX } from '@tabler/icons-react'
import { isValidInvoiceNumber, otherCategoryId } from '../../core/receipt'
import { dayKey } from '../../core/workCalendar'
import { emptyExpenseDraft, hasReceipt, type ExpenseDraft } from '../../data/expenses'
import { loadImage } from '../../data/images'
import type { Expense } from '../../data/models'
import { useObserve } from '../../data/observable'
import { useSession } from '../../data/session'
import { alertMessage, Card, confirmAction, goBack, HeaderButton, openImageViewer, Page, StoredImage, useFilePicker, useObjectUrl } from '../../ui/common'
import { categoryStyle, colors, gradients } from '../../ui/theme'

/** 経費の確認・編集：領収書の画像を見ながら、読み取った内容と自動判定した区分を確認して申請する */
export function ExpenseEditPage() {
  const { id } = useParams()
  const store = useObserve(useSession().expenses)
  if (id) {
    if (!store.isLoaded) {
      return (
        <Center h="100dvh">
          <Loader />
        </Center>
      )
    }
    const existing = store.expense(id)
    if (!existing || existing.status === 'approved') return <Navigate to={`/expenses/${id}`} replace />
    return <Editor expenseId={id} existing={existing} initial={store.draft(existing)} />
  }
  return <NewEditor />
}

function NewEditor() {
  const store = useSession().expenses
  const [state] = useState(() => {
    const draft = store.newDraft ?? emptyExpenseDraft()
    store.newDraft = null
    return { id: store.newExpenseId(), draft }
  })
  return <Editor expenseId={state.id} existing={null} initial={state.draft} />
}

function Editor({ expenseId, existing, initial }: { expenseId: string; existing: Expense | null; initial: ExpenseDraft }) {
  const session = useSession()
  const store = session.expenses
  const settings = useObserve(session.settings)
  const navigate = useNavigate()
  const [draft, setDraft] = useState(initial)
  const [amountText, setAmountText] = useState(initial.amount !== null ? String(initial.amount) : '')
  const [reading, setReading] = useState(false)
  const [saving, setSaving] = useState(false)
  const isEditingSubmitted = existing?.status === 'submitted'
  const set = <K extends keyof ExpenseDraft>(key: K, value: ExpenseDraft[K]) => setDraft((d) => ({ ...d, [key]: value }))

  /** 領収書を差し替えて読み取り直す（空欄だけ埋める） */
  const replaceReceipt = async (files: File[]) => {
    const image = files[0]
    set('newReceipt', image)
    setReading(true)
    const read = await store.draftFromReceipt(image)
    setReading(false)
    setDraft((d) => {
      const next = { ...d, ocrText: read.ocrText }
      if (!d.vendor) next.vendor = read.vendor
      if (!d.invoiceNumber) next.invoiceNumber = read.invoiceNumber
      if (!existing && read.ocrText) {
        next.usedOn = read.usedOn
        if (d.categoryId === otherCategoryId) next.categoryId = read.categoryId
      }
      return next
    })
    setAmountText((t) => (t === '' && read.amount !== null ? String(read.amount) : t))
  }
  const camera = useFilePicker(replaceReceipt, { camera: true })
  const album = useFilePicker(replaceReceipt)

  const save = async (submit: boolean | null) => {
    if (saving) return
    setSaving(true)
    try {
      await store.save({ ...draft, amount: amountText ? Number(amountText) : null }, expenseId, existing, submit)
      goBack(navigate, '/expenses')
    } catch (e) {
      alertMessage((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const close = () =>
    confirmAction({ title: '入力した内容を保存せずに閉じますか？', confirm: '閉じる', danger: true, onConfirm: () => goBack(navigate, '/expenses') })

  return (
    <Page
      title={existing ? '経費を修正' : '経費を確認'}
      noTabbar
      left={
        <HeaderButton onClick={close}>
          <IconX size={20} /> 閉じる
        </HeaderButton>
      }
    >
      {existing?.status === 'returned' && existing.returnReason && (
        <div style={{ color: colors.warning, fontSize: 14, display: 'flex', gap: 6 }}>
          <IconArrowBackUp size={18} style={{ flexShrink: 0 }} /> 差し戻し：{existing.returnReason}
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div className="receipt-preview">
          <ReceiptPreview draft={draft} />
          {hasReceipt(draft) && (
            <button
              className="chip zoom"
              onClick={async () => {
                const blob = draft.newReceipt ?? (draft.receiptPath ? await loadImage(draft.receiptPath).catch(() => null) : null)
                if (blob) openImageViewer(blob)
              }}
            >
              <IconArrowsMaximize size={14} /> 拡大
            </button>
          )}
          {reading && (
            <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
              <div className="chip" style={{ cursor: 'default' }}>
                <Loader size="xs" /> 読み取り中…
              </div>
            </div>
          )}
        </div>
        <div style={{ display: 'flex', gap: 10 }}>
          <button className="pill-btn gray" style={{ flex: 1, minHeight: 40, fontSize: 14, color: colors.expense }} onClick={camera.open}>
            <IconScan size={18} /> {hasReceipt(draft) ? '撮り直す' : '撮影する'}
          </button>
          <button className="pill-btn gray" style={{ flex: 1, minHeight: 40, fontSize: 14, color: colors.expense }} onClick={album.open}>
            <IconPhoto size={18} /> 写真から
          </button>
        </div>
        {camera.input}
        {album.input}
      </div>

      <div className="card list">
        <Row label="利用日" required>
          <input type="date" className="native-picker" value={draft.usedOn} max={dayKey(new Date())} onChange={(e) => e.target.value && set('usedOn', e.target.value)} />
        </Row>
        <Row label="金額（税込）" required>
          <span className="dimmed">¥</span>
          <input
            className="inline-input num"
            style={{ fontSize: 20, fontWeight: 700 }}
            inputMode="numeric"
            placeholder="0"
            value={amountText}
            onChange={(e) => setAmountText(e.target.value.replace(/\D/g, ''))}
          />
        </Row>
        <Row label="お店・会社名" required>
          <input className="inline-input" placeholder="支払先" value={draft.vendor} onChange={(e) => set('vendor', e.target.value)} />
        </Row>
        <Row label="インボイス番号" note={'領収書の「T」で始まる番号。\nなければ空欄'}>
          <input
            className="inline-input num"
            style={{ color: isValidInvoiceNumber(draft.invoiceNumber) ? undefined : 'var(--mantine-color-red-6)' }}
            placeholder="T0000000000000"
            autoCapitalize="characters"
            autoCorrect="off"
            inputMode="text"
            value={draft.invoiceNumber}
            onChange={(e) => set('invoiceNumber', e.target.value.toUpperCase().replace(/\s/g, ''))}
          />
        </Row>
      </div>

      <Card>
        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <b style={{ fontSize: 17 }}>区分</b>
          <span className="dot-required" />
        </div>
        <div className="cat-grid">
          {settings.categories.map((c) => {
            const on = draft.categoryId === c.id
            const s = categoryStyle(c.id)
            return (
              <button key={c.id} className="cat-btn" style={on ? { background: s.color, color: '#fff' } : undefined} onClick={() => set('categoryId', c.id)}>
                <s.icon size={18} />
                <span className="ellipsis">{c.name}</span>
              </button>
            )
          })}
        </div>
      </Card>

      <Card>
        <b style={{ fontSize: 17 }}>メモ</b>
        <textarea className="field-input" rows={3} placeholder="用途・同行者など" value={draft.memo} onChange={(e) => set('memo', e.target.value)} />
      </Card>

      <div className="dimmed" style={{ fontSize: 12 }}>
        紙の領収書は会社に提出してください。
      </div>

      <div className="bottom-bar">
        {isEditingSubmitted ? (
          <button className="pill-btn" style={{ background: gradients.expense }} disabled={reading || saving} onClick={() => save(null)}>
            <IconSend size={20} /> 修正を保存
          </button>
        ) : (
          <>
            <button className="pill-btn gray" disabled={reading || saving} onClick={() => save(false)}>
              下書き保存
            </button>
            <button className="pill-btn" style={{ background: gradients.expense }} disabled={reading || saving} onClick={() => save(true)}>
              <IconSend size={20} /> 申請する
            </button>
          </>
        )}
      </div>
    </Page>
  )
}

function ReceiptPreview({ draft }: { draft: ExpenseDraft }) {
  const url = useObjectUrl(draft.newReceipt)
  if (url) return <img src={url} alt="領収書" />
  if (draft.receiptPath) return <StoredImage path={draft.receiptPath} />
  return (
    <div className="image-missing" style={{ fontSize: 14 }}>
      <IconFileText size={36} />
      領収書の画像がありません
    </div>
  )
}

function Row({ label, required, note, children }: { label: string; required?: boolean; note?: string; children: ReactNode }) {
  return (
    <div className="row">
      <span style={{ flexShrink: 0 }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 14, fontWeight: 600 }}>
          {label}
          {required && <span className="dot-required" />}
        </span>
        {note && (
          <span className="dimmed pre" style={{ display: 'block', fontSize: 11 }}>
            {note}
          </span>
        )}
      </span>
      <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, minWidth: 0, flex: 1, justifyContent: 'flex-end' }}>{children}</span>
    </div>
  )
}
