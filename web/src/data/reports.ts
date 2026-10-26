// 日報の一覧・保存。日報の ID は「{uid}_{日付}」（1日1件）。

import { collection, deleteDoc, doc, query, Timestamp, where, writeBatch, type Unsubscribe } from 'firebase/firestore'
import { encodeValues, parseTimeRange } from '../core/timeRange'
import { dateFromDayKey, dayKey, shortDayLabel } from '../core/workCalendar'
import { db } from '../firebase'
import { reportPhoto, uploadQueue } from './images'
import { parseReport, ReportKey, type DailyReport } from './models'
import { listenQuery, Observable } from './observable'
import type { SettingsStore } from './settings'

/** 日報の作成・編集画面で入力中の内容 */
export interface ReportDraft {
  date: string
  values: Record<string, string>
  siteIds: string[]
  /** 一覧にない現場（手入力） */
  manualSites: string[]
  photoPaths: string[]
  newPhotos: File[]
}

const reportCollection = collection(db, 'dailyReports')

export const revisionsCollection = (reportId: string) => collection(db, 'dailyReports', reportId, 'revisions')

export class ReportStore extends Observable {
  /** 日付の新しい順 */
  reports: DailyReport[] = []
  unsentIds = new Set<string>()
  /** 最初の読み込みが終わったか */
  isLoaded = false
  private unsub: Unsubscribe | null = null
  private readonly uid: string
  private readonly settings: SettingsStore

  constructor(uid: string, settings: SettingsStore) {
    super()
    this.uid = uid
    this.settings = settings
  }

  start() {
    this.unsub = listenQuery(query(reportCollection, where('userId', '==', this.uid)), parseReport, (items, pending) => {
      this.reports = items.sort((a, b) => b.date.localeCompare(a.date))
      this.unsentIds = pending
      this.isLoaded = true
      this.changed()
    })
  }

  stop() {
    this.unsub?.()
    this.unsub = null
  }

  reportOn(date: string) {
    return this.reports.find((r) => r.date === date) ?? null
  }

  report(id: string) {
    return this.reports.find((r) => r.id === id) ?? null
  }

  reportId(date: string) {
    return `${this.uid}_${date}`
  }

  /** 入力内容を日報の形にする */
  draft(report: DailyReport | null, date: string): ReportDraft {
    if (!report) return { date, values: {}, siteIds: [], manualSites: [], photoPaths: [], newPhotos: [] }
    const selectedNames = new Set(report.siteIds.map((id) => this.settings.site(id)?.name).filter(Boolean))
    const names = (report.values[ReportKey.site] ?? '')
      .split('、')
      .map((s) => s.trim())
      .filter((s) => s.length > 0)
    return {
      date: report.date,
      values: { ...report.values },
      siteIds: [...report.siteIds],
      manualSites: names.filter((n) => !selectedNames.has(n)),
      photoPaths: [...report.photoPaths],
      newPhotos: [],
    }
  }

  /** 必須で空の項目 */
  missingRequiredFields(d: ReportDraft): string[] {
    return this.settings.template
      .filter((f) => f.required)
      .filter((f) => {
        switch (f.type) {
          case 'date':
            return false
          case 'sites':
            return d.siteIds.length === 0 && d.manualSites.length === 0
          case 'photos':
            return d.photoPaths.length === 0 && d.newPhotos.length === 0
          case 'timeRange':
            return parseTimeRange(d.values[f.key]) === null
          default:
            return (d.values[f.key] ?? '').trim() === ''
        }
      })
      .map((f) => f.label)
  }

  /**
   * 保存する。submit = true なら提出（必須項目をチェック）。
   * 提出済みの日報を直したときは、修正前の内容を修正履歴に残す。
   * 入力の誤りは Error を投げる（メッセージをそのまま画面に出す）。
   */
  async save(d: ReportDraft, existing: DailyReport | null, submit: boolean) {
    if (existing?.status === 'approved') throw new Error('承認済みの日報は修正できません。')
    // 新しい日報は、選んだ日付から ID を決める（作成後は日付を変えられない）
    const docId = existing ? existing.id : this.reportId(d.date)
    if (this.reports.some((r) => r.date === d.date && r.id !== docId)) {
      throw new Error(`${shortDayLabel(dateFromDayKey(d.date)!)} の日報はすでにあります。日報は1日1件です。`)
    }
    const willBeSubmitted = submit || existing?.status === 'submitted'
    if (willBeSubmitted) {
      const missing = this.missingRequiredFields(d)
      if (missing.length) throw new Error(`必須の項目が入力されていません：${missing.join('、')}`)
    }

    // 写真は縮小してスマホに保存し、裏で順番に送る
    const paths = [...d.photoPaths]
    let n = Math.max(0, ...paths.map((p) => Number(p.split('/').pop()?.replace('.jpg', '')) || 0))
    for (const file of d.newPhotos) {
      const blob = await reportPhoto(file)
      n += 1
      const path = `reports/${this.uid}/${docId}/${n}.jpg`
      await uploadQueue.enqueue(blob, path)
      paths.push(path)
    }

    const values = Object.fromEntries(Object.entries(d.values).filter(([, v]) => v !== ''))
    const siteNames = [...d.siteIds.map((id) => this.settings.site(id)?.name).filter((s): s is string => !!s), ...d.manualSites]
    if (siteNames.length) values[ReportKey.site] = siteNames.join('、')
    else delete values[ReportKey.site]

    const now = new Date()
    const date = dateFromDayKey(d.date) ?? now
    const report = {
      userId: this.uid,
      date: d.date,
      month: this.settings.period.monthKey(date),
      status: willBeSubmitted ? 'submitted' : 'draft',
      values: encodeValues(values),
      siteIds: d.siteIds,
      photoPaths: paths,
      createdAt: Timestamp.fromDate(existing?.createdAt ?? now),
      updatedAt: Timestamp.fromDate(now),
      ...((existing?.submittedAt ?? (submit ? now : null)) ? { submittedAt: Timestamp.fromDate(existing?.submittedAt ?? now) } : {}),
    }

    const ref = doc(reportCollection, docId)
    const batch = writeBatch(db)
    if (existing && existing.status === 'submitted' && (!sameValues(existing.values, values) || !sameList(existing.photoPaths, paths))) {
      batch.set(doc(revisionsCollection(docId)), {
        values: encodeValues(existing.values),
        photoPaths: existing.photoPaths,
        editedAt: Timestamp.fromDate(now),
        editedBy: this.uid,
      })
    }
    batch.set(ref, report)
    // 電波がなくてもスマホに保存され、つながったら自動で送信される
    batch.commit().catch((e) => console.error('Report save error', e))
  }

  deleteDraft(report: DailyReport) {
    if (report.status !== 'draft') return
    deleteDoc(doc(reportCollection, report.id)).catch((e) => console.error('Report delete error', e))
  }
}

const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i])

function sameValues(a: Record<string, string>, b: Record<string, string>) {
  const ka = Object.keys(a)
  return ka.length === Object.keys(b).length && ka.every((k) => a[k] === b[k])
}

export const todayKey = () => dayKey(new Date())
