// 経費の一覧・保存。

import { collection, deleteDoc, deleteField, doc, query, setDoc, Timestamp, updateDoc, where, type Unsubscribe } from 'firebase/firestore'
import { classifyCategory, isValidInvoiceNumber, otherCategoryId } from '../core/receipt'
import { dateFromDayKey, dayKey } from '../core/workCalendar'
import { db } from '../firebase'
import { receiptImage, uploadQueue } from './images'
import { parseExpense, type Expense } from './models'
import { listenQuery, Observable } from './observable'
import { recognizeReceipt } from './ocr'
import type { SettingsStore } from './settings'

/** 経費の確認・編集画面で入力中の内容 */
export interface ExpenseDraft {
  usedOn: string
  amount: number | null
  vendor: string
  categoryId: string
  invoiceNumber: string
  memo: string
  ocrText: string
  receiptPath: string | null
  /** 撮影・選択した領収書（まだ保存していない） */
  newReceipt: Blob | null
}

export const emptyExpenseDraft = (): ExpenseDraft => ({
  usedOn: dayKey(new Date()),
  amount: null,
  vendor: '',
  categoryId: otherCategoryId,
  invoiceNumber: '',
  memo: '',
  ocrText: '',
  receiptPath: null,
  newReceipt: null,
})

export const hasReceipt = (d: ExpenseDraft) => d.newReceipt !== null || d.receiptPath !== null

const expenseCollection = collection(db, 'expenses')

export class ExpenseStore extends Observable {
  /** 利用日の新しい順 */
  expenses: Expense[] = []
  unsentIds = new Set<string>()
  /** 最初の読み込みが終わったか */
  isLoaded = false
  /** 一覧で領収書を読み取ってから、新しい経費の画面に渡す内容 */
  newDraft: ExpenseDraft | null = null
  private unsub: Unsubscribe | null = null
  private readonly uid: string
  private readonly settings: SettingsStore

  constructor(uid: string, settings: SettingsStore) {
    super()
    this.uid = uid
    this.settings = settings
  }

  start() {
    this.unsub = listenQuery(query(expenseCollection, where('userId', '==', this.uid)), parseExpense, (items, pending) => {
      this.expenses = items.sort((a, b) => b.usedOn.localeCompare(a.usedOn) || b.createdAt.getTime() - a.createdAt.getTime())
      this.unsentIds = pending
      this.isLoaded = true
      this.changed()
    })
  }

  stop() {
    this.unsub?.()
    this.unsub = null
  }

  expensesIn(month: string) {
    return this.expenses.filter((e) => e.month === month)
  }

  expense(id: string) {
    return this.expenses.find((e) => e.id === id) ?? null
  }

  newExpenseId() {
    return doc(expenseCollection).id
  }

  draft(e: Expense): ExpenseDraft {
    return {
      usedOn: e.usedOn,
      amount: e.amount,
      vendor: e.vendor,
      categoryId: e.categoryId,
      invoiceNumber: e.invoiceNumber,
      memo: e.memo,
      ocrText: e.ocrText,
      receiptPath: e.receiptPath,
      newReceipt: null,
    }
  }

  /** 撮影した領収書を読み取って入力欄を埋める */
  async draftFromReceipt(image: Blob, onProgress?: (ratio: number) => void): Promise<ExpenseDraft> {
    const draft: ExpenseDraft = { ...emptyExpenseDraft(), newReceipt: image }
    const result = await recognizeReceipt(image, onProgress).catch((e) => {
      console.warn('OCR error', e)
      return null
    })
    if (!result) return draft
    draft.ocrText = result.text
    if (result.fields.usedOn && result.fields.usedOn <= new Date()) draft.usedOn = dayKey(result.fields.usedOn)
    draft.amount = result.fields.amount
    draft.vendor = result.fields.vendor ?? ''
    draft.invoiceNumber = result.fields.invoiceNumber ?? ''
    draft.categoryId = classifyCategory(result.fields.vendor, result.text, this.settings.categories)
    return draft
  }

  validate(d: ExpenseDraft) {
    const missing: string[] = []
    if ((d.amount ?? 0) <= 0) missing.push('金額')
    if (d.vendor.trim() === '') missing.push('お店・会社名')
    if (!hasReceipt(d)) missing.push('領収書の画像')
    if (missing.length) throw new Error(`必須の項目が入力されていません：${missing.join('、')}`)
    if (!isValidInvoiceNumber(d.invoiceNumber)) throw invalidInvoice()
  }

  /** 保存する。submit: true = 申請、false = 下書き、null = 状態を変えない（申請済みの修正） */
  async save(d: ExpenseDraft, expenseId: string, existing: Expense | null, submit: boolean | null) {
    if (existing?.status === 'approved') throw new Error('承認済みの経費は修正できません。')
    const status = submit === true ? 'submitted' : submit === false ? 'draft' : existing?.status === 'submitted' ? 'submitted' : 'draft'
    if (status === 'submitted') this.validate(d)
    else if (!isValidInvoiceNumber(d.invoiceNumber)) throw invalidInvoice()

    let receiptPath = d.receiptPath
    if (d.newReceipt) {
      const path = `receipts/${this.uid}/${expenseId}.jpg`
      await uploadQueue.enqueue(await receiptImage(d.newReceipt), path)
      receiptPath = path
    }

    const now = new Date()
    const usedOn = dateFromDayKey(d.usedOn) ?? now
    const submittedAt = status === 'submitted' ? (existing?.submittedAt ?? now) : null
    // 電波がなくてもスマホに保存され、つながったら自動で送信される
    setDoc(doc(expenseCollection, expenseId), {
      userId: this.uid,
      usedOn: d.usedOn,
      month: this.settings.period.monthKey(usedOn),
      amount: d.amount ?? 0,
      vendor: d.vendor.trim(),
      categoryId: d.categoryId,
      invoiceNumber: d.invoiceNumber,
      memo: d.memo,
      ...(receiptPath ? { receiptPath } : {}),
      ocrText: d.ocrText,
      status,
      createdAt: Timestamp.fromDate(existing?.createdAt ?? now),
      ...(existing ? { updatedAt: Timestamp.fromDate(now) } : {}),
      ...(submittedAt ? { submittedAt: Timestamp.fromDate(submittedAt) } : {}),
    }).catch((e) => console.error('Expense save error', e))
  }

  /** 申請する（下書き・差し戻しから） */
  submit(e: Expense) {
    return this.save(this.draft(e), e.id, e, true)
  }

  /** 申請を取り消す（下書きに戻す） */
  cancelSubmission(e: Expense) {
    if (e.status !== 'submitted') return
    updateDoc(doc(expenseCollection, e.id), { status: 'draft', submittedAt: deleteField(), updatedAt: Timestamp.now() }).catch((err) =>
      console.error('Expense cancel error', err),
    )
  }

  deleteDraft(e: Expense) {
    if (e.status !== 'draft' && e.status !== 'returned') return
    deleteDoc(doc(expenseCollection, e.id)).catch((err) => console.error('Expense delete error', err))
  }
}

const invalidInvoice = () => new Error('インボイス番号は「T」と13桁の数字です。書かれていなければ空欄にしてください。')
