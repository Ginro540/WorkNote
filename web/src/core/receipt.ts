// WorkNoteCore/ReceiptParser.swift と CategoryClassifier.swift の移植。
// OCR で読んだ行から利用日・金額・支払先・インボイス番号を取り出し、区分を推定する。

import { makeDate } from './workCalendar'

/** 領収書の文字（OCR の結果）から読み取った値 */
export interface ReceiptFields {
  usedOn: Date | null
  amount: number | null
  vendor: string | null
  invoiceNumber: string | null
}

export function parseReceiptLines(rawLines: string[]): ReceiptFields {
  const lines = rawLines.map(normalize).filter((l) => l.trim().length > 0)
  return {
    usedOn: findDate(lines),
    amount: findAmount(lines),
    vendor: findVendor(lines),
    invoiceNumber: findInvoiceNumber(lines),
  }
}

export function parseReceiptText(text: string): ReceiptFields {
  return parseReceiptLines(text.split(/\r?\n/))
}

/** 全角英数字→半角、半角カナ→全角、円記号のゆれをそろえる */
export function normalize(s: string): string {
  return s.normalize('NFKC').replaceAll('￥', '¥').replaceAll('\\', '¥').replaceAll('，', ',')
}

// MARK: - 日付

const datePatterns: [RegExp, (y: number) => number][] = [
  [/(20\d{2})\s*[年/.-]\s*(\d{1,2})\s*[月/.-]\s*(\d{1,2})/g, (y) => y],
  [/(?:R|令和|令)\s*(\d{1,2}|元)\s*[年/.-]\s*(\d{1,2})\s*[月/.-]\s*(\d{1,2})/g, (y) => 2018 + y],
  [/(?<![\d-])(\d{2})\s*[/.]\s*(\d{1,2})\s*[/.]\s*(\d{1,2})(?!\d)/g, (y) => 2000 + y],
]

export function findDate(lines: string[]): Date | null {
  for (const [pattern, toYear] of datePatterns) {
    for (const line of lines) {
      for (const m of line.matchAll(pattern)) {
        const y = m[1] === '元' ? 1 : Number(m[1])
        const date = makeDate(toYear(y), Number(m[2]), Number(m[3]))
        if (date) return date
      }
    }
  }
  return null
}

// MARK: - 金額

/** 優先度の高いキーワード順 */
const totalKeywords = [
  ['合計', '総合計', 'お支払', 'お支払い', 'ご請求', '領収金額', 'お買上', 'お買い上げ', '税込合計'],
  ['金額', '計', 'TOTAL', 'Total'],
]
const excludeKeywords = ['小計', '預', '釣', '消費税', '税額', '対象', '点数', '内税', '外税', '値引', '割引', 'ポイント']

const amountRegex = /(¥)?\s*(\d{1,3}(?:,\d{3})+|\d+)\s*(円|-)?(?![\d%.]|\s*(?:L|点|個|%))/g

const hasExcluded = (line: string) => excludeKeywords.some((k) => line.includes(k))

/** 行の中の金額。markedOnly なら ¥ か 円 が付いたものだけ */
export function amountsIn(line: string, markedOnly: boolean): number[] {
  const result: number[] = []
  for (const m of line.matchAll(amountRegex)) {
    const marked = m[1] !== undefined || m[3] !== undefined
    const digits = m[2]
    if (markedOnly && !marked) continue
    if (!marked && !digits.includes(',') && digits.length > 7) continue
    const n = Number(digits.replaceAll(',', ''))
    if (n > 0 && n < 100_000_000) result.push(n)
  }
  return result
}

export function findAmount(lines: string[]): number | null {
  for (const keywords of totalKeywords) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]
      if (!keywords.some((k) => line.includes(k)) || hasExcluded(line)) continue
      const inLine = amountsIn(line, false)
      if (inLine.length) return inLine[inLine.length - 1]
      // 金額が次の行に分かれて読まれた場合
      if (i + 1 < lines.length && !hasExcluded(lines[i + 1])) {
        const next = amountsIn(lines[i + 1], false)
        if (next.length) return next[0]
      }
    }
  }
  // キーワードがなければ、¥・円の付いた最大の金額
  const marked = lines.filter((l) => !hasExcluded(l)).flatMap((l) => amountsIn(l, true))
  return marked.length ? Math.max(...marked) : null
}

// MARK: - 支払先

const skipVendorPatterns = [
  /領\s*収\s*[書証]/, /レシート/, /receipt/i, /御?見積/, /納品書/, /請求書/,
  /様$/, /^上様/, /TEL|Tel|tel|電話|FAX|Fax/, /\d{2,4}-\d{2,4}-\d{3,4}/, /〒|^\d{3}-\d{4}/,
  /登録番号|T\d{13}/, /\d{1,4}\s*[年/]\s*\d{1,2}\s*[月/]\s*\d{1,2}/, /\d{1,2}:\d{2}/,
  /(都|道|府|県).*(市|区|町|村)|(市|区|町|村).*\d+-\d+/, /¥|円/, /^[\d\s\-,./:()#*]+$/,
  /いらっしゃいませ|ありがとうございま|毎度/,
]

export function findVendor(lines: string[]): string | null {
  const candidates = lines
    .slice(0, 8)
    .map((l) => l.trim())
    .filter((l) => [...l].length >= 2 && !skipVendorPatterns.some((p) => p.test(l)))
  return candidates[0] ?? null
}

// MARK: - インボイス番号

export function findInvoiceNumber(lines: string[]): string | null {
  const regex = /T\s*[-:]?\s*((?:\d[\s-]?){12}\d)(?!\d)/
  for (const line of lines) {
    const m = regex.exec(line)
    if (m) {
      const digits = m[1].replace(/\D/g, '')
      if (digits.length === 13) return 'T' + digits
    }
  }
  return null
}

/** T＋13桁か（空欄は可） */
export const isValidInvoiceNumber = (s: string) => s === '' || /^T\d{13}$/.test(s)

// MARK: - 区分の推定

export interface CategoryLike {
  id: string
  keywords: string[]
  order: number
}

export const otherCategoryId = 'other'

/** 全角・半角と大文字・小文字の違いを無視して比べる */
const fold = (s: string) => normalize(s).toUpperCase()

/** 支払先・キーワードから区分を推定する。支払先で当たればそれを優先し、次に領収書の全文で探す。 */
export function classifyCategory(vendor: string | null, text: string, categories: CategoryLike[]): string {
  const sorted = [...categories].sort((a, b) => a.order - b.order)
  for (const source of [vendor ?? '', text]) {
    const haystack = fold(source)
    if (!haystack) continue
    for (const c of sorted) {
      if (c.id === otherCategoryId) continue
      if (c.keywords.some((k) => k !== '' && haystack.includes(fold(k)))) return c.id
    }
  }
  return sorted.find((c) => c.id === otherCategoryId)?.id ?? otherCategoryId
}
