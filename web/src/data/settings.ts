// クラウドの設定（settings/*）と勤務先の一覧（sites）。管理者アプリから変えると、すぐに反映される。

import { collection, doc, query, where, type Unsubscribe } from 'firebase/firestore'
import { BusinessDays, ClosingPeriod } from '../core/closingPeriod'
import { jstParts } from '../core/workCalendar'
import { db } from '../firebase'
import { uploadQueue } from './images'
import {
  defaultCategories,
  defaultCompanySettings,
  defaultReportFields,
  parseCategories,
  parseCompany,
  parseHolidays,
  parseReportFields,
  parseSite,
  type CompanySettings,
  type ExpenseCategory,
  type Holiday,
  type ReportField,
  type Site,
} from './models'
import { listenDoc, listenQuery, Observable } from './observable'

export class SettingsStore extends Observable {
  company: CompanySettings = defaultCompanySettings
  template: ReportField[] = defaultReportFields
  categories: ExpenseCategory[] = defaultCategories
  sites: Site[] = []
  period = new ClosingPeriod(0)
  businessDays = new BusinessDays([])
  private holidaysByYear = new Map<number, Holiday[]>()
  private unsubs: Unsubscribe[] = []

  start() {
    const settings = collection(db, 'settings')
    this.unsubs.push(
      listenDoc(doc(settings, 'company'), (d) => {
        this.company = parseCompany(d)
        this.period = new ClosingPeriod(this.company.closingDay)
        uploadQueue.setEnabled(this.company.imageUploadEnabled)
        this.changed()
      }),
      listenDoc(doc(settings, 'reportTemplate'), (d) => {
        this.template = parseReportFields(d)
        this.changed()
      }),
      listenDoc(doc(settings, 'expenseCategories'), (d) => {
        this.categories = parseCategories(d)
        this.changed()
      }),
      listenQuery(query(collection(db, 'sites'), where('active', '==', true)), parseSite, (items) => {
        this.sites = items.sort((a, b) => a.order - b.order || a.name.localeCompare(b.name, 'ja'))
        this.changed()
      }),
    )
    const year = jstParts(new Date()).year
    for (const y of [year - 1, year, year + 1]) {
      this.unsubs.push(
        listenDoc(doc(settings, `calendar_${y}`), (d) => {
          this.holidaysByYear.set(y, parseHolidays(d))
          this.businessDays = new BusinessDays([...this.holidaysByYear.values()].flat().map((h) => h.date))
          this.changed()
        }),
      )
    }
  }

  stop() {
    this.unsubs.forEach((u) => u())
    this.unsubs = []
  }

  holiday(dayKey: string): Holiday | null {
    for (const list of this.holidaysByYear.values()) {
      const h = list.find((x) => x.date === dayKey)
      if (h) return h
    }
    return null
  }

  category(id: string): ExpenseCategory {
    return (
      this.categories.find((c) => c.id === id) ??
      defaultCategories.find((c) => c.id === id) ?? { id, name: 'その他', keywords: [], order: 99 }
    )
  }

  site(id: string): Site | null {
    return this.sites.find((s) => s.id === id) ?? null
  }

  /** 修正申請の期限 */
  correctionDeadline(monthKey: string): Date | null {
    return this.businessDays.correctionDeadline(monthKey, this.period, this.company.correctionDeadlineBusinessDays)
  }

  canRequestCorrection(monthKey: string, today = new Date()): boolean {
    return this.businessDays.canRequestCorrection(monthKey, this.period, this.company.correctionDeadlineBusinessDays, today)
  }
}
