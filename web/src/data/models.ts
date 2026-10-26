// Firestore のデータの形。管理者アプリ（WorkNoteAdmin/web/src/data/models.ts）と同じものを使う。
// 読むときは、足りないフィールドがある古いデータ（試作版のデータなど）も読めるようにする。

import { Timestamp, type DocumentData } from 'firebase/firestore'
import { defaultBreakRules, type BreakRule, type PunchKind, type PunchPoint } from '../core/attendance'

// MARK: - 読むときの変換

export function toDate(v: unknown): Date | null {
  if (v instanceof Timestamp) return v.toDate()
  if (v instanceof Date) return v
  if (v && typeof v === 'object' && 'seconds' in v && typeof (v as { seconds: unknown }).seconds === 'number') {
    const t = v as { seconds: number; nanoseconds?: number }
    return new Date(t.seconds * 1000 + Math.floor((t.nanoseconds ?? 0) / 1e6))
  }
  return null
}

const str = (v: unknown, fallback = ''): string => (typeof v === 'string' ? v : fallback)
const optStr = (v: unknown): string | null => (typeof v === 'string' ? v : null)
const num = (v: unknown, fallback = 0): number => (typeof v === 'number' && Number.isFinite(v) ? v : fallback)
const optNum = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const strArray = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [])

// MARK: - ユーザー（users/{uid}）

export type Role = 'employee' | 'admin'

export interface AppUser {
  id: string
  displayName: string
  email: string
  role: Role
  createdAt: Date | null
  /** 退職にした日時。あるあいだは従業員としての読み書きがルールで止まる */
  retiredAt: Date | null
  retiredBy: string | null
  /** 退職日（YYYY-MM-DD、表示用） */
  retireDate: string | null
  retireReason: string
}

export const roleLabel = (role: Role) => (role === 'admin' ? '管理者' : '従業員')

export function parseUser(id: string, d: DocumentData): AppUser {
  return {
    id,
    displayName: str(d.displayName),
    email: str(d.email),
    role: d.role === 'admin' ? 'admin' : 'employee',
    createdAt: toDate(d.createdAt),
    retiredAt: toDate(d.retiredAt),
    retiredBy: optStr(d.retiredBy),
    retireDate: optStr(d.retireDate),
    retireReason: str(d.retireReason),
  }
}

// MARK: - 打刻（attendancePunches/{id}）

export type LocationStatus = 'pending' | 'acquired' | 'unavailable' | 'denied'

export interface PunchLocation {
  lat: number
  lng: number
  accuracy: number
  address: string | null
  locatedAt: Date | null
}

export interface AttendancePunch {
  id: string
  userId: string
  workDate: string
  month: string
  kind: PunchKind
  /** 端末の時刻（押した瞬間） */
  punchedAt: Date
  /** サーバーが受け取った時刻 */
  receivedAt: Date | null
  location: PunchLocation | null
  locationStatus: LocationStatus
  /** 修正申請の承認・管理者の修正で書き換えた打刻 */
  corrected: boolean
  originalPunchedAt: Date | null
  correctionId: string | null
  /** 管理者が直接修正・追加したとき */
  correctedBy: string | null
  correctedAt: Date | null
  correctionReason: string | null
}

export function parsePunch(id: string, d: DocumentData): AttendancePunch | null {
  const punchedAt = toDate(d.punchedAt)
  if (!punchedAt || typeof d.userId !== 'string' || typeof d.workDate !== 'string') return null
  const loc = d.location
  return {
    id,
    userId: d.userId,
    workDate: d.workDate,
    month: str(d.month, d.workDate.slice(0, 7)),
    kind: d.kind === 'out' ? 'out' : 'in',
    punchedAt,
    receivedAt: toDate(d.receivedAt),
    location:
      loc && typeof loc.lat === 'number' && typeof loc.lng === 'number'
        ? { lat: loc.lat, lng: loc.lng, accuracy: num(loc.accuracy), address: optStr(loc.address), locatedAt: toDate(loc.locatedAt) }
        : null,
    locationStatus: (['pending', 'acquired', 'unavailable', 'denied'] as const).includes(d.locationStatus) ? d.locationStatus : 'unavailable',
    corrected: d.corrected === true,
    originalPunchedAt: toDate(d.originalPunchedAt),
    correctionId: optStr(d.correctionId),
    correctedBy: optStr(d.correctedBy),
    correctedAt: toDate(d.correctedAt),
    correctionReason: optStr(d.correctionReason),
  }
}

export const punchPoint = (p: AttendancePunch): PunchPoint => ({ id: p.id, kind: p.kind, time: p.punchedAt })

/** 端末の時刻とサーバーが受け取った時刻が大きく（10分以上）ずれているか（従業員アプリと同じ） */
export const hasClockSkew = (p: AttendancePunch) =>
  !!p.receivedAt && !p.corrected && Math.abs(p.receivedAt.getTime() - p.punchedAt.getTime()) > 600_000

/** 住所の表示（従業員アプリと同じ） */
export function locationLabel(p: AttendancePunch): string {
  switch (p.locationStatus) {
    case 'pending':
      return '位置を取得中…'
    case 'denied':
      return '位置なし（許可なし）'
    case 'unavailable':
      return '位置なし'
    case 'acquired':
      if (!p.location) return '位置なし'
      return p.location.address ?? `${p.location.lat.toFixed(5)}, ${p.location.lng.toFixed(5)}`
  }
}

/** 「打刻から◯分後に取得」 */
export function locationDelayLabel(p: AttendancePunch): string | null {
  if (p.locationStatus !== 'acquired' || !p.location?.locatedAt) return null
  const minutes = Math.trunc((p.location.locatedAt.getTime() - p.punchedAt.getTime()) / 60000)
  return minutes >= 1 ? `打刻から${minutes}分後に取得` : null
}

// MARK: - 打刻の修正申請（attendanceCorrections/{id}）

export type CorrectionKind = 'missingClockIn' | 'missingClockOut' | 'wrongTime' | 'noBreak'
export type CorrectionStatus = 'pending' | 'approved' | 'rejected' | 'cancelled'

export const correctionKindLabel: Record<CorrectionKind, string> = {
  missingClockIn: '出勤の打刻漏れ',
  missingClockOut: '退勤の打刻漏れ',
  wrongTime: '時刻の誤り',
  noBreak: '休憩を取れなかった',
}

export const correctionStatusLabel: Record<CorrectionStatus, string> = {
  pending: '修正申請中',
  approved: '承認済み',
  rejected: '却下',
  cancelled: '取り消し',
}

export interface AttendanceCorrection {
  id: string
  userId: string
  workDate: string
  month: string
  targetPunchIds: string[]
  kind: CorrectionKind
  requestedClockIn: Date | null
  requestedClockOut: Date | null
  requestedBreakMinutes: number | null
  reason: string
  status: CorrectionStatus
  reviewedBy: string | null
  reviewedAt: Date | null
  rejectReason: string | null
  createdAt: Date
  createdBy: string | null
  cancelledAt: Date | null
}

export function parseCorrection(id: string, d: DocumentData): AttendanceCorrection | null {
  const kinds: CorrectionKind[] = ['missingClockIn', 'missingClockOut', 'wrongTime', 'noBreak']
  const statuses: CorrectionStatus[] = ['pending', 'approved', 'rejected', 'cancelled']
  if (typeof d.userId !== 'string' || typeof d.workDate !== 'string' || !kinds.includes(d.kind)) return null
  return {
    id,
    userId: d.userId,
    workDate: d.workDate,
    month: str(d.month, d.workDate.slice(0, 7)),
    targetPunchIds: strArray(d.targetPunchIds),
    kind: d.kind,
    requestedClockIn: toDate(d.requestedClockIn),
    requestedClockOut: toDate(d.requestedClockOut),
    requestedBreakMinutes: optNum(d.requestedBreakMinutes),
    reason: str(d.reason),
    status: statuses.includes(d.status) ? d.status : 'pending',
    reviewedBy: optStr(d.reviewedBy),
    reviewedAt: toDate(d.reviewedAt),
    rejectReason: optStr(d.rejectReason),
    createdAt: toDate(d.createdAt) ?? new Date(0),
    createdBy: optStr(d.createdBy),
    cancelledAt: toDate(d.cancelledAt),
  }
}

// MARK: - 日報（dailyReports/{id}）

export type ReportStatus = 'draft' | 'submitted' | 'approved'

export const reportStatusLabel: Record<ReportStatus, string> = {
  draft: '下書き',
  submitted: '提出済み',
  approved: '承認済み',
}

/** 日報の項目キー（初期の項目） */
export const ReportKey = { weather: 'weather', workTime: 'workTime', site: 'site', content: 'content' } as const

export interface DailyReport {
  id: string
  userId: string
  date: string
  month: string
  status: ReportStatus
  /** 項目キー → 値（訪問先・現場名は site、作業内容は content） */
  values: Record<string, string>
  siteIds: string[]
  photoPaths: string[]
  createdAt: Date
  updatedAt: Date
  submittedAt: Date | null
  approvedBy: string | null
  approvedAt: Date | null
  returnReason: string | null
  returnedBy: string | null
  returnedAt: Date | null
}

/** values の1つの値（従業員アプリの StoredReportValue と同じ読み方） */
function reportValueText(v: unknown): string {
  if (typeof v === 'string') return v
  if (v && typeof v === 'object' && !Array.isArray(v) && 'start' in v && 'end' in v) {
    const r = v as { start: unknown; end: unknown }
    if (typeof r.start === 'string' && typeof r.end === 'string') return `${r.start}-${r.end}`
  }
  if (Array.isArray(v) && v.every((x) => typeof x === 'string')) return v.join('、')
  if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(v)
  if (typeof v === 'boolean') return v ? 'はい' : 'いいえ'
  return ''
}

export function decodeValues(v: unknown): Record<string, string> {
  if (!v || typeof v !== 'object') return {}
  return Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([k, x]) => [k, reportValueText(x)]))
}

export function parseReport(id: string, d: DocumentData): DailyReport | null {
  if (typeof d.userId !== 'string' || typeof d.date !== 'string') return null
  const updated = toDate(d.updatedAt)
  const created = toDate(d.createdAt) ?? updated ?? new Date()
  return {
    id,
    userId: d.userId,
    date: d.date,
    month: str(d.month, d.date.slice(0, 7)),
    status: (['draft', 'submitted', 'approved'] as const).includes(d.status) ? d.status : 'draft',
    values: decodeValues(d.values),
    siteIds: strArray(d.siteIds),
    photoPaths: strArray(d.photoPaths),
    createdAt: created,
    updatedAt: updated ?? created,
    submittedAt: toDate(d.submittedAt),
    approvedBy: optStr(d.approvedBy),
    approvedAt: toDate(d.approvedAt),
    returnReason: optStr(d.returnReason),
    returnedBy: optStr(d.returnedBy),
    returnedAt: toDate(d.returnedAt),
  }
}

/** 一覧・勤怠の備考に出す1行（「訪問先・現場名 ／ 作業内容の1行目」） */
export function reportSummaryLine(r: DailyReport): string {
  const site = (r.values[ReportKey.site] ?? '').trim()
  const content = (r.values[ReportKey.content] ?? '').split(/\r?\n/)[0]?.trim() ?? ''
  return [site, content].filter((s) => s.length > 0).join(' ／ ')
}

export interface ReportRevision {
  id: string
  /** 修正前の内容 */
  values: Record<string, string>
  photoPaths: string[]
  editedAt: Date
  editedBy: string
}

export function parseRevision(id: string, d: DocumentData): ReportRevision {
  return {
    id,
    values: decodeValues(d.values),
    photoPaths: strArray(d.photoPaths),
    editedAt: toDate(d.editedAt) ?? new Date(),
    editedBy: str(d.editedBy),
  }
}

// MARK: - 経費（expenses/{id}）

export type ExpenseStatus = 'draft' | 'submitted' | 'approved' | 'returned'

export const expenseStatusLabel: Record<ExpenseStatus, string> = {
  draft: '下書き',
  submitted: '申請済み',
  approved: '承認済み',
  returned: '差し戻し',
}

export interface Expense {
  id: string
  userId: string
  usedOn: string
  month: string
  amount: number
  vendor: string
  categoryId: string
  invoiceNumber: string
  memo: string
  receiptPath: string | null
  ocrText: string
  status: ExpenseStatus
  createdAt: Date
  updatedAt: Date | null
  submittedAt: Date | null
  returnReason: string | null
  reviewedBy: string | null
  reviewedAt: Date | null
}

export function parseExpense(id: string, d: DocumentData): Expense | null {
  if (typeof d.userId !== 'string' || typeof d.usedOn !== 'string') return null
  return {
    id,
    userId: d.userId,
    usedOn: d.usedOn,
    month: str(d.month, d.usedOn.slice(0, 7)),
    amount: Math.trunc(num(d.amount)),
    vendor: str(d.vendor),
    categoryId: str(d.categoryId, 'other'),
    invoiceNumber: str(d.invoiceNumber),
    memo: str(d.memo),
    receiptPath: optStr(d.receiptPath),
    ocrText: str(d.ocrText),
    status: (['draft', 'submitted', 'approved', 'returned'] as const).includes(d.status) ? d.status : 'draft',
    createdAt: toDate(d.createdAt) ?? new Date(0),
    updatedAt: toDate(d.updatedAt),
    submittedAt: toDate(d.submittedAt),
    returnReason: optStr(d.returnReason),
    reviewedBy: optStr(d.reviewedBy),
    reviewedAt: toDate(d.reviewedAt),
  }
}

// MARK: - 勤務先（sites/{id}）

export interface Site {
  id: string
  name: string
  address: string
  active: boolean
  order: number
}

export function parseSite(id: string, d: DocumentData): Site {
  return { id, name: str(d.name), address: str(d.address), active: d.active !== false, order: num(d.order) }
}

// MARK: - 設定（settings/*）

/** settings/company */
export interface CompanySettings {
  closingDay: number
  correctionDeadlineBusinessDays: number
  breakRules: BreakRule[]
  /** 画像を Cloud Storage に送るか（Blaze プランにしたら true にする） */
  imageUploadEnabled: boolean
}

export const defaultCompanySettings: CompanySettings = {
  closingDay: 0,
  correctionDeadlineBusinessDays: 3,
  breakRules: defaultBreakRules,
  imageUploadEnabled: false,
}

export function parseCompany(d: DocumentData | undefined): CompanySettings {
  if (!d) return defaultCompanySettings
  const rules = Array.isArray(d.breakRules)
    ? d.breakRules
        .filter((r: unknown) => r && typeof r === 'object')
        .map((r: { overMinutes?: unknown; breakMinutes?: unknown }) => ({ overMinutes: num(r.overMinutes), breakMinutes: num(r.breakMinutes) }))
    : defaultBreakRules
  return {
    closingDay: num(d.closingDay, 0),
    correctionDeadlineBusinessDays: num(d.correctionDeadlineBusinessDays, 3),
    breakRules: rules,
    imageUploadEnabled: d.imageUploadEnabled === true,
  }
}

export type ReportFieldType = 'date' | 'weather' | 'timeRange' | 'sites' | 'longText' | 'text' | 'photos'

export const reportFieldTypeLabel: Record<ReportFieldType, string> = {
  date: '日付',
  weather: '天気',
  timeRange: '時刻の範囲',
  sites: '勤務先',
  longText: '長文テキスト',
  text: '1行テキスト',
  photos: '写真',
}

/** settings/reportTemplate.fields[] */
export interface ReportField {
  key: string
  label: string
  type: ReportFieldType
  required: boolean
  order: number
}

export const defaultReportFields: ReportField[] = [
  { key: 'date', label: '日付', type: 'date', required: true, order: 1 },
  { key: 'weather', label: '天気', type: 'weather', required: false, order: 2 },
  { key: 'workTime', label: '作業時間', type: 'timeRange', required: true, order: 3 },
  { key: 'site', label: '訪問先・現場名', type: 'sites', required: true, order: 4 },
  { key: 'content', label: '作業内容', type: 'longText', required: true, order: 5 },
  { key: 'impressions', label: '所感・報告事項', type: 'longText', required: false, order: 6 },
  { key: 'tomorrow', label: '明日の予定', type: 'longText', required: false, order: 7 },
  { key: 'photos', label: '写真', type: 'photos', required: false, order: 8 },
]

/** 従業員アプリが特別に扱う項目（削除・種類の変更をさせない） */
export const protectedReportKeys = ['date', 'workTime', 'site', 'content']

export function parseReportFields(d: DocumentData | undefined): ReportField[] {
  const types = Object.keys(reportFieldTypeLabel)
  const list: ReportField[] = Array.isArray(d?.fields)
    ? d.fields
        .filter((f: { key?: unknown }) => typeof f?.key === 'string')
        .map((f: DocumentData) => ({
          key: f.key,
          label: str(f.label, f.key),
          // 知らない種類は1行テキストとして扱う（従業員アプリと同じ）
          type: types.includes(f.type) ? f.type : 'text',
          required: f.required === true,
          order: num(f.order),
        }))
    : []
  return (list.length ? list : defaultReportFields).sort((a, b) => a.order - b.order)
}

export interface ExpenseCategory {
  id: string
  name: string
  keywords: string[]
  order: number
}

export const otherCategoryId = 'other'

export const defaultCategories: ExpenseCategory[] = [
  { id: 'travel', name: '旅費交通費', keywords: ['JR', '鉄道', 'バス', 'タクシー', '交通', 'NEXCO', '高速', 'ETC'], order: 1 },
  { id: 'parking', name: '駐車場代', keywords: ['駐車場', 'パーキング', 'コインパーキング', 'タイムズ'], order: 2 },
  { id: 'fuel', name: '燃料費', keywords: ['ガソリン', 'レギュラー', '軽油', 'ENEOS', '出光', 'コスモ石油'], order: 3 },
  { id: 'supplies', name: '材料・消耗品費', keywords: ['ホームセンター', '資材', '工具', '文具', 'コーナン', 'カインズ'], order: 4 },
  { id: 'meeting', name: '会議費', keywords: ['カフェ', '喫茶', 'コーヒー', '珈琲'], order: 5 },
  { id: 'entertainment', name: '接待交際費', keywords: ['居酒屋', 'レストラン', '料亭', '贈答'], order: 6 },
  { id: 'communication', name: '通信費', keywords: ['切手', '郵便', 'レターパック', '宅急便'], order: 7 },
  { id: otherCategoryId, name: 'その他', keywords: [], order: 99 },
]

export function parseCategories(d: DocumentData | undefined): ExpenseCategory[] {
  const list: ExpenseCategory[] = Array.isArray(d?.categories)
    ? d.categories
        .filter((c: { id?: unknown }) => typeof c?.id === 'string')
        .map((c: DocumentData) => ({ id: c.id, name: str(c.name, c.id), keywords: strArray(c.keywords), order: num(c.order) }))
    : []
  return (list.length ? list : defaultCategories).sort((a, b) => a.order - b.order)
}

export type HolidayKind = 'national' | 'company'

export const holidayKindLabel: Record<HolidayKind, string> = { national: '国民の祝日', company: '会社の休業日' }

export interface Holiday {
  date: string
  name: string
  kind: HolidayKind
}

export function parseHolidays(d: DocumentData | undefined): Holiday[] {
  if (!Array.isArray(d?.holidays)) return []
  return d.holidays
    .filter((h: { date?: unknown }) => typeof h?.date === 'string')
    .map((h: DocumentData) => ({ date: h.date, name: str(h.name), kind: h.kind === 'company' ? 'company' : 'national' }))
}

export const yen = (n: number) => `¥${n.toLocaleString('ja-JP')}`

// MARK: - 休暇（leaveRequests/{id}）。1日1件。まとめて申請した日は groupId が同じ（docs/従業員アプリ指示書_休暇.md）

export type LeaveKind = 'paid' | 'paidAm' | 'paidPm' | 'special' | 'absence'
export type LeaveStatus = 'pending' | 'approved' | 'rejected' | 'cancelled'

export const leaveKindLabel: Record<LeaveKind, string> = {
  paid: '有給（全日）',
  paidAm: '有給（午前半休）',
  paidPm: '有給（午後半休）',
  special: '特別休暇',
  absence: '欠勤',
}

/** 勤怠の表などに出す短い名前 */
export const leaveKindShort: Record<LeaveKind, string> = {
  paid: '有給',
  paidAm: '午前半休',
  paidPm: '午後半休',
  special: '特別休暇',
  absence: '欠勤',
}

export const leaveStatusLabel: Record<LeaveStatus, string> = {
  pending: '申請中',
  approved: '承認',
  rejected: '却下',
  cancelled: '取り消し',
}

/** 1日に対する日数（集計用） */
export const leaveDays = (kind: LeaveKind) => (kind === 'paidAm' || kind === 'paidPm' ? 0.5 : 1)

/** 半休か（その日に打刻があってよい） */
export const isHalfDayLeave = (kind: LeaveKind) => kind === 'paidAm' || kind === 'paidPm'

export interface LeaveRequest {
  id: string
  userId: string
  date: string
  month: string
  kind: LeaveKind
  reason: string
  groupId: string
  status: LeaveStatus
  createdAt: Date
  cancelledAt: Date | null
  reviewedBy: string | null
  reviewedAt: Date | null
  rejectReason: string | null
  createdBy: string | null
  /** 管理者が承認済みの休暇を取り消したとき */
  cancelledBy: string | null
  cancelReason: string | null
}

export const leaveKinds: LeaveKind[] = ['paid', 'paidAm', 'paidPm', 'special', 'absence']
const leaveStatuses: LeaveStatus[] = ['pending', 'approved', 'rejected', 'cancelled']

export function parseLeave(id: string, d: DocumentData): LeaveRequest | null {
  if (typeof d.userId !== 'string' || typeof d.date !== 'string' || !leaveKinds.includes(d.kind)) return null
  return {
    id,
    userId: d.userId,
    date: d.date,
    month: str(d.month, d.date.slice(0, 7)),
    kind: d.kind,
    reason: str(d.reason),
    groupId: str(d.groupId, id),
    status: leaveStatuses.includes(d.status) ? d.status : 'pending',
    createdAt: toDate(d.createdAt) ?? new Date(),
    cancelledAt: toDate(d.cancelledAt),
    reviewedBy: optStr(d.reviewedBy),
    reviewedAt: toDate(d.reviewedAt),
    rejectReason: optStr(d.rejectReason),
    createdBy: optStr(d.createdBy),
    cancelledBy: optStr(d.cancelledBy),
    cancelReason: optStr(d.cancelReason),
  }
}
