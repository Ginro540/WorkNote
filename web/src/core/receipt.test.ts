// WorkNoteCore の ReceiptTests（Swift）と同じ内容
import { describe, expect, test } from 'vitest'
import { defaultCategories } from '../data/models'
import { classifyCategory, findDate, findInvoiceNumber, isValidInvoiceNumber, normalize, parseReceiptLines, parseReceiptText } from './receipt'
import { dayKey } from './workCalendar'

const eneos = `ENEOS
Dr.Driveセルフ博多駅前店
福岡県福岡市博多区博多駅前2-1-1
TEL 092-123-4567
登録番号 T1234567890123
領 収 書
2026年10月19日(月) 14:32
レギュラー 32.50L
単価 ¥168
小計 ¥5,460
(内消費税等 10% ¥496)
合計 ¥5,460
お預り ¥10,000
お釣り ¥4,540`

const day = (d: Date | null) => (d ? dayKey(d) : null)

describe('領収書の読み取り', () => {
  test('ENEOS のレシート', () => {
    const f = parseReceiptText(eneos)
    expect(f.vendor).toBe('ENEOS')
    expect(f.amount).toBe(5460)
    expect(f.invoiceNumber).toBe('T1234567890123')
    expect(day(f.usedOn)).toBe('2026-10-19')
    expect(classifyCategory(f.vendor, eneos, defaultCategories)).toBe('fuel')
  })

  test('日付', () => {
    expect(day(findDate(['2026/10/19 10:00']))).toBe('2026-10-19')
    expect(day(findDate(['R8.10.19']))).toBe('2026-10-19')
    expect(day(findDate(['令和8年10月19日']))).toBe('2026-10-19')
    expect(day(findDate([normalize('２０２６年１０月１９日')]))).toBe('2026-10-19')
    expect(findDate(['TEL 092-123-4567'])).toBeNull()
    expect(findDate(['2026/02/30'])).toBeNull()
  })

  test('金額・インボイス番号', () => {
    expect(parseReceiptLines(['タイムズ天神第5', '駐車料金', 'お支払い金額', '800円']).amount).toBe(800)
    expect(parseReceiptLines(['コーナン 福岡店', '合計 ￥３，２８０']).amount).toBe(3280)
    expect(parseReceiptLines(['領収書', '¥1,540-', '但し 飲食代として']).amount).toBe(1540)
    expect(findInvoiceNumber(['登録番号 T 1234-5678-90123'])).toBe('T1234567890123')
    expect(findInvoiceNumber(['T12345'])).toBeNull()
    expect(isValidInvoiceNumber('T1234567890123')).toBe(true)
    expect(isValidInvoiceNumber('T123')).toBe(false)
  })

  test('支払先と区分', () => {
    const f = parseReceiptLines(['領収書', '上様', '2026/10/09', 'コメダ珈琲店 博多店', '合計 ¥1,540'])
    expect(f.vendor).toBe('コメダ珈琲店 博多店')
    expect(classifyCategory(f.vendor, '', defaultCategories)).toBe('meeting')
  })

  test('全角・半角', () => {
    expect(normalize('ＥＮＥＯＳ　ガソリン')).toBe('ENEOS ガソリン')
    expect(classifyCategory('ｺｲﾝﾊﾟｰｷﾝｸﾞ', '', defaultCategories)).toBe('parking')
    expect(classifyCategory('不明', '', defaultCategories)).toBe('other')
  })
})
