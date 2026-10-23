import Foundation

/// 経費の区分（settings/expenseCategories.categories）
public struct ExpenseCategory: Codable, Equatable, Hashable, Identifiable, Sendable {
    public var id: String
    public var name: String
    public var keywords: [String]
    public var order: Int

    public init(id: String, name: String, keywords: [String], order: Int) {
        self.id = id
        self.name = name
        self.keywords = keywords
        self.order = order
    }

    public static let otherID = "other"

    /// クラウドの設定が読めないときに使う初期値（仕様書の区分表）
    public static let defaults: [ExpenseCategory] = [
        .init(id: "travel", name: "旅費交通費", keywords: ["JR", "鉄道", "バス", "タクシー", "交通", "NEXCO", "高速", "ETC"], order: 1),
        .init(id: "parking", name: "駐車場代", keywords: ["駐車場", "パーキング", "コインパーキング", "タイムズ"], order: 2),
        .init(id: "fuel", name: "燃料費", keywords: ["ガソリン", "レギュラー", "軽油", "ENEOS", "出光", "コスモ石油"], order: 3),
        .init(id: "supplies", name: "材料・消耗品費", keywords: ["ホームセンター", "資材", "工具", "文具", "コーナン", "カインズ"], order: 4),
        .init(id: "meeting", name: "会議費", keywords: ["カフェ", "喫茶", "コーヒー", "珈琲"], order: 5),
        .init(id: "entertainment", name: "接待交際費", keywords: ["居酒屋", "レストラン", "料亭", "贈答"], order: 6),
        .init(id: "communication", name: "通信費", keywords: ["切手", "郵便", "レターパック", "宅急便"], order: 7),
        .init(id: otherID, name: "その他", keywords: [], order: 99),
    ]
}

/// 支払先・キーワードから区分を推定する。支払先で当たればそれを優先し、次に領収書の全文で探す。
public enum CategoryClassifier {
    public static func classify(vendor: String?, text: String, categories: [ExpenseCategory]) -> String {
        let sorted = categories.sorted { $0.order < $1.order }
        for source in [vendor ?? "", text] {
            let haystack = fold(source)
            guard !haystack.isEmpty else { continue }
            for category in sorted where category.id != ExpenseCategory.otherID {
                if category.keywords.contains(where: { !$0.isEmpty && haystack.contains(fold($0)) }) {
                    return category.id
                }
            }
        }
        return sorted.first(where: { $0.id == ExpenseCategory.otherID })?.id ?? ExpenseCategory.otherID
    }

    /// 全角・半角と大文字・小文字の違いを無視して比べる
    static func fold(_ s: String) -> String {
        ReceiptParser.normalize(s).uppercased()
    }
}
