import Foundation

/// 領収書の文字（OCR の結果）から読み取った値
public struct ReceiptFields: Equatable, Sendable {
    public var usedOn: Date?
    public var amount: Int?
    public var vendor: String?
    public var invoiceNumber: String?

    public init(usedOn: Date? = nil, amount: Int? = nil, vendor: String? = nil, invoiceNumber: String? = nil) {
        self.usedOn = usedOn
        self.amount = amount
        self.vendor = vendor
        self.invoiceNumber = invoiceNumber
    }
}

/// OCR で読んだ行から利用日・金額・支払先・インボイス番号を取り出す
public enum ReceiptParser {
    public static func parse(lines rawLines: [String]) -> ReceiptFields {
        let lines = rawLines.map(normalize).filter { !$0.trimmingCharacters(in: .whitespaces).isEmpty }
        return ReceiptFields(
            usedOn: findDate(in: lines),
            amount: findAmount(in: lines),
            vendor: findVendor(in: lines),
            invoiceNumber: findInvoiceNumber(in: lines)
        )
    }

    public static func parse(text: String) -> ReceiptFields {
        parse(lines: text.components(separatedBy: .newlines))
    }

    /// 全角→半角、円記号のゆれをそろえる
    public static func normalize(_ s: String) -> String {
        var t = s.applyingTransform(.fullwidthToHalfwidth, reverse: false) ?? s
        // 半角カナになったものは全角に戻す
        t = t.applyingTransform(.fullwidthToHalfwidth, reverse: true).map { restoreAscii($0) } ?? t
        t = t.replacingOccurrences(of: "￥", with: "¥")
            .replacingOccurrences(of: "\\", with: "¥")
            .replacingOccurrences(of: "，", with: ",")
        return t
    }

    /// reverse 変換で全角に戻った英数字・記号を半角にする（カナは全角のまま）
    private static func restoreAscii(_ s: String) -> String {
        var out = String.UnicodeScalarView()
        for u in s.unicodeScalars {
            if (0xFF01...0xFF5E).contains(u.value), let h = Unicode.Scalar(u.value - 0xFEE0) {
                out.append(h)
            } else if u.value == 0x3000 {
                out.append(" ")
            } else {
                out.append(u)
            }
        }
        return String(out)
    }

    // MARK: - 日付

    public static func findDate(in lines: [String]) -> Date? {
        let patterns: [(String, (Int) -> Int)] = [
            (#"(20\d{2})\s*[年/.\-]\s*(\d{1,2})\s*[月/.\-]\s*(\d{1,2})"#, { $0 }),
            (#"(?:R|令和|令)\s*(\d{1,2}|元)\s*[年/.\-]\s*(\d{1,2})\s*[月/.\-]\s*(\d{1,2})"#, { 2018 + $0 }),
            (#"(?<![\d\-])(\d{2})\s*[/.]\s*(\d{1,2})\s*[/.]\s*(\d{1,2})(?![\d])"#, { 2000 + $0 }),
        ]
        for (pattern, toYear) in patterns {
            let regex = try! NSRegularExpression(pattern: pattern)
            for line in lines {
                let ns = line as NSString
                for m in regex.matches(in: line, range: NSRange(location: 0, length: ns.length)) {
                    let ys = ns.substring(with: m.range(at: 1))
                    let y = ys == "元" ? 1 : Int(ys) ?? 0
                    let mo = Int(ns.substring(with: m.range(at: 2))) ?? 0
                    let d = Int(ns.substring(with: m.range(at: 3))) ?? 0
                    if let date = WorkCalendar.date(year: toYear(y), month: mo, day: d) {
                        return date
                    }
                }
            }
        }
        return nil
    }

    // MARK: - 金額

    /// 優先度の高いキーワード順
    private static let totalKeywords: [[String]] = [
        ["合計", "総合計", "お支払", "お支払い", "ご請求", "領収金額", "お買上", "お買い上げ", "税込合計"],
        ["金額", "計", "TOTAL", "Total"],
    ]
    private static let excludeKeywords = ["小計", "預", "釣", "消費税", "税額", "対象", "点数", "内税", "外税", "値引", "割引", "ポイント"]

    private static let amountRegex = try! NSRegularExpression(
        pattern: #"(¥)?\s*(\d{1,3}(?:,\d{3})+|\d+)\s*(円|-)?(?![\d%.]|\s*(?:L|点|個|%))"#
    )

    /// 行の中の金額。markedOnly なら ¥ か 円 が付いたものだけ
    static func amounts(in line: String, markedOnly: Bool) -> [Int] {
        let ns = line as NSString
        return amountRegex.matches(in: line, range: NSRange(location: 0, length: ns.length)).compactMap { m in
            let marked = m.range(at: 1).location != NSNotFound || m.range(at: 3).location != NSNotFound
            let digits = ns.substring(with: m.range(at: 2))
            if markedOnly && !marked { return nil }
            if !marked && !digits.contains(",") && digits.count > 7 { return nil }
            return Int(digits.replacingOccurrences(of: ",", with: ""))
        }.filter { $0 > 0 && $0 < 100_000_000 }
    }

    public static func findAmount(in lines: [String]) -> Int? {
        for keywords in totalKeywords {
            for (i, line) in lines.enumerated() {
                guard keywords.contains(where: { line.contains($0) }),
                      !excludeKeywords.contains(where: { line.contains($0) }) else { continue }
                if let a = amounts(in: line, markedOnly: false).last { return a }
                // 金額が次の行に分かれて読まれた場合
                if i + 1 < lines.count, !excludeKeywords.contains(where: { lines[i + 1].contains($0) }),
                   let a = amounts(in: lines[i + 1], markedOnly: false).first {
                    return a
                }
            }
        }
        // キーワードがなければ、¥・円の付いた最大の金額
        return lines
            .filter { line in !excludeKeywords.contains(where: { line.contains($0) }) }
            .flatMap { amounts(in: $0, markedOnly: true) }
            .max()
    }

    // MARK: - 支払先

    private static let skipVendorPatterns = [
        #"領\s*収\s*[書証]"#, #"レシート"#, #"(?i)receipt"#, #"御?見積"#, #"納品書"#, #"請求書"#,
        #"様$"#, #"^上様"#, #"TEL|Tel|tel|電話|FAX|Fax"#, #"\d{2,4}-\d{2,4}-\d{3,4}"#, #"〒|^\d{3}-\d{4}"#,
        #"登録番号|T\d{13}"#, #"\d{1,4}\s*[年/]\s*\d{1,2}\s*[月/]\s*\d{1,2}"#, #"\d{1,2}:\d{2}"#,
        #"(都|道|府|県).*(市|区|町|村)|(市|区|町|村).*\d+-\d+"#, #"¥|円"#, #"^[\d\s\-,./:()#*]+$"#,
        #"いらっしゃいませ|ありがとうございま|毎度"#,
    ]

    public static func findVendor(in lines: [String]) -> String? {
        let regexes = skipVendorPatterns.map { try! NSRegularExpression(pattern: $0) }
        let candidates = lines.prefix(8).map { $0.trimmingCharacters(in: .whitespaces) }.filter { line in
            let range = NSRange(location: 0, length: (line as NSString).length)
            return line.count >= 2 && !regexes.contains { $0.firstMatch(in: line, range: range) != nil }
        }
        return candidates.first
    }

    // MARK: - インボイス番号

    public static func findInvoiceNumber(in lines: [String]) -> String? {
        let regex = try! NSRegularExpression(pattern: #"T\s*[-:]?\s*((?:\d[\s\-]?){12}\d)(?!\d)"#)
        for line in lines {
            let ns = line as NSString
            if let m = regex.firstMatch(in: line, range: NSRange(location: 0, length: ns.length)) {
                let digits = ns.substring(with: m.range(at: 1)).filter(\.isNumber)
                if digits.count == 13 { return "T" + digits }
            }
        }
        return nil
    }

    /// T＋13桁か（空欄は可）
    public static func isValidInvoiceNumber(_ s: String) -> Bool {
        s.isEmpty || s.range(of: #"^T\d{13}$"#, options: .regularExpression) != nil
    }
}
