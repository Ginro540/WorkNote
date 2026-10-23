import Foundation
import Testing
@testable import WorkNoteCore

private func jst(_ y: Int, _ mo: Int, _ d: Int, _ h: Int = 0, _ mi: Int = 0) -> Date {
    WorkCalendar.date(year: y, month: mo, day: d, hour: h, minute: mi)!
}

private func punch(_ kind: PunchKind, _ h: Int, _ m: Int, day: Int = 14) -> PunchPoint {
    PunchPoint(id: UUID().uuidString, kind: kind, time: jst(2026, 10, day, h, m))
}

@Suite struct ClosingPeriodTests {
    @Test func monthEnd() {
        let p = ClosingPeriod(closingDay: 0)
        #expect(p.monthKey(for: jst(2026, 10, 31, 23, 59)) == "2026-10")
        #expect(p.monthKey(for: jst(2026, 11, 1)) == "2026-11")
        let r = p.dateRange(monthKey: "2026-10")!
        #expect(WorkCalendar.dayKey(r.start) == "2026-10-01")
        #expect(WorkCalendar.dayKey(r.end) == "2026-10-31")
        #expect(p.days(monthKey: "2026-02").count == 28)
    }

    @Test func day20() {
        let p = ClosingPeriod(closingDay: 20)
        #expect(p.monthKey(for: jst(2026, 10, 20)) == "2026-10")
        #expect(p.monthKey(for: jst(2026, 10, 21)) == "2026-11")
        #expect(p.monthKey(for: jst(2026, 12, 25)) == "2027-01")
        let r = p.dateRange(monthKey: "2026-10")!
        #expect(WorkCalendar.dayKey(r.start) == "2026-09-21")
        #expect(WorkCalendar.dayKey(r.end) == "2026-10-20")
    }
}

@Suite struct BusinessDayTests {
    @Test func specExample() {
        // 10月分は 11/2（月）・4（水）・5（木）を数えて 11/5 まで（11/3 は文化の日）
        let b = BusinessDays(holidays: ["2026-11-03"])
        let d = b.correctionDeadline(monthKey: "2026-10", period: ClosingPeriod(), businessDays: 3)!
        #expect(WorkCalendar.dayKey(d) == "2026-11-05")
        #expect(b.canRequestCorrection(monthKey: "2026-10", period: ClosingPeriod(), businessDays: 3, today: jst(2026, 11, 5, 23, 0)))
        #expect(!b.canRequestCorrection(monthKey: "2026-10", period: ClosingPeriod(), businessDays: 3, today: jst(2026, 11, 6)))
    }
}

@Suite struct AttendanceTests {
    @Test func twoSessionsWithGap() {
        // 10/14：08:30〜12:00 と 14:00〜19:00（中抜け2時間）→ 拘束 10:30、休憩 0、実働 8:30
        let s = AttendanceCalculator.summarize(punches: [
            punch(.clockIn, 8, 30), punch(.clockOut, 12, 0), punch(.clockIn, 14, 0), punch(.clockOut, 19, 0),
        ])
        #expect(s.status == .finished)
        #expect(s.sessionCount == 2)
        #expect(s.spanMinutes == 630)
        #expect(s.gapMinutes == 120)
        #expect(s.deductedBreakMinutes == 0)
        #expect(s.workMinutes == 510)
        #expect(s.overtimeMinutes == 30)
    }

    @Test func specRows() {
        // 10/15：09:00〜14:30 → 5:30（休憩なし）
        let a = AttendanceCalculator.summarize(punches: [punch(.clockIn, 9, 0), punch(.clockOut, 14, 30)])
        #expect(a.workMinutes == 330 && a.deductedBreakMinutes == 0)
        // 10/16：08:52〜18:05 → 拘束 9:13、休憩 1:00、実働 8:13
        let b = AttendanceCalculator.summarize(punches: [punch(.clockIn, 8, 52), punch(.clockOut, 18, 5)])
        #expect(b.spanMinutes == 553 && b.deductedBreakMinutes == 60 && b.workMinutes == 493)
    }

    @Test func boundaries() {
        func work(_ minutes: Int) -> Int? {
            let start = jst(2026, 10, 14, 9, 0)
            return AttendanceCalculator.summarize(punches: [
                PunchPoint(id: "a", kind: .clockIn, time: start),
                PunchPoint(id: "b", kind: .clockOut, time: start.addingTimeInterval(Double(minutes) * 60)),
            ]).workMinutes
        }
        #expect(work(360) == 360)        // 6:00 以下 → 0分
        #expect(work(361) == 316)        // 6:00 超 → 45分
        #expect(work(525) == 480)        // 8:45 以下 → 45分
        #expect(work(526) == 466)        // 8:45 超 → 60分
    }

    @Test func gapCountsAsBreak() {
        // 拘束 9:00、中抜け 0:30 → 自動で差し引くのは 30分
        let s = AttendanceCalculator.summarize(punches: [
            punch(.clockIn, 9, 0), punch(.clockOut, 12, 0), punch(.clockIn, 12, 30), punch(.clockOut, 18, 0),
        ])
        #expect(s.spanMinutes == 540 && s.gapMinutes == 30 && s.deductedBreakMinutes == 30 && s.workMinutes == 480)
    }

    @Test func noBreakOverride() {
        let s = AttendanceCalculator.summarize(punches: [punch(.clockIn, 9, 0), punch(.clockOut, 18, 0)], breakOverride: 0)
        #expect(s.workMinutes == 540)
    }

    @Test func statuses() {
        #expect(AttendanceCalculator.summarize(punches: []).status == .off)
        #expect(AttendanceCalculator.summarize(punches: [punch(.clockIn, 9, 0)]).status == .working)
        #expect(AttendanceCalculator.summarize(punches: [punch(.clockIn, 9, 0)], isPastDay: true).status == .missingPunch)
        #expect(AttendanceCalculator.summarize(punches: [punch(.clockOut, 9, 0)]).status == .missingPunch)
    }

    @Test func overnight() {
        let s = AttendanceCalculator.summarize(punches: [
            PunchPoint(id: "a", kind: .clockIn, time: jst(2026, 10, 14, 22, 0)),
            PunchPoint(id: "b", kind: .clockOut, time: jst(2026, 10, 15, 5, 0)),
        ])
        #expect(s.spanMinutes == 420 && s.workMinutes == 375)
    }
}

@Suite struct ReceiptTests {
    let eneos = """
    ENEOS
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
    お釣り ¥4,540
    """

    @Test func eneosReceipt() {
        let f = ReceiptParser.parse(text: eneos)
        #expect(f.vendor == "ENEOS")
        #expect(f.amount == 5460)
        #expect(f.invoiceNumber == "T1234567890123")
        #expect(f.usedOn.map(WorkCalendar.dayKey) == "2026-10-19")
        #expect(CategoryClassifier.classify(vendor: f.vendor, text: eneos, categories: ExpenseCategory.defaults) == "fuel")
    }

    @Test func dateFormats() {
        #expect(ReceiptParser.findDate(in: ["2026/10/19 10:00"]).map(WorkCalendar.dayKey) == "2026-10-19")
        #expect(ReceiptParser.findDate(in: ["R8.10.19"]).map(WorkCalendar.dayKey) == "2026-10-19")
        #expect(ReceiptParser.findDate(in: ["令和8年10月19日"]).map(WorkCalendar.dayKey) == "2026-10-19")
        #expect(ReceiptParser.findDate(in: [ReceiptParser.normalize("２０２６年１０月１９日")]).map(WorkCalendar.dayKey) == "2026-10-19")
        #expect(ReceiptParser.findDate(in: ["TEL 092-123-4567"]) == nil)
        #expect(ReceiptParser.findDate(in: ["2026/02/30"]) == nil)
    }

    @Test func amountsAndInvoice() {
        #expect(ReceiptParser.parse(lines: ["タイムズ天神第5", "駐車料金", "お支払い金額", "800円"]).amount == 800)
        #expect(ReceiptParser.parse(lines: ["コーナン 福岡店", "合計 ￥３，２８０"].map(ReceiptParser.normalize)).amount == 3280)
        #expect(ReceiptParser.parse(lines: ["領収書", "¥1,540-", "但し 飲食代として"]).amount == 1540)
        #expect(ReceiptParser.findInvoiceNumber(in: ["登録番号 T 1234-5678-90123"]) == "T1234567890123")
        #expect(ReceiptParser.findInvoiceNumber(in: ["T12345"]) == nil)
        #expect(ReceiptParser.isValidInvoiceNumber("T1234567890123"))
        #expect(!ReceiptParser.isValidInvoiceNumber("T123"))
    }

    @Test func vendorSkipsHeaders() {
        let f = ReceiptParser.parse(lines: ["領収書", "上様", "2026/10/09", "コメダ珈琲店 博多店", "合計 ¥1,540"])
        #expect(f.vendor == "コメダ珈琲店 博多店")
        #expect(CategoryClassifier.classify(vendor: f.vendor, text: "", categories: ExpenseCategory.defaults) == "meeting")
    }

    @Test func normalizeKeepsKana() {
        #expect(ReceiptParser.normalize("ＥＮＥＯＳ　ガソリン") == "ENEOS ガソリン")
        #expect(CategoryClassifier.classify(vendor: "ｺｲﾝﾊﾟｰｷﾝｸﾞ", text: "", categories: ExpenseCategory.defaults) == "parking")
        #expect(CategoryClassifier.classify(vendor: "不明", text: "", categories: ExpenseCategory.defaults) == "other")
    }
}
