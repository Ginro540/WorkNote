import UIKit
import Observation
import FirebaseFirestore
import WorkNoteCore

/// 経費の確認・編集画面で入力中の内容
struct ExpenseDraft {
    var usedOn = Date()
    var amount: Int?
    var vendor = ""
    var categoryId = ExpenseCategory.otherID
    var invoiceNumber = ""
    var memo = ""
    var ocrText = ""
    var receiptPath: String?
    /// 撮影・選択した領収書（まだ保存していない）
    var newReceipt: UIImage?

    var hasReceipt: Bool { newReceipt != nil || receiptPath != nil }
}

enum ExpenseError: LocalizedError {
    case missing([String])
    case invalidInvoice
    case approved

    var errorDescription: String? {
        switch self {
        case .missing(let labels): "必須の項目が入力されていません：\(labels.joined(separator: "、"))"
        case .invalidInvoice: "インボイス番号は「T」と13桁の数字です。書かれていなければ空欄にしてください。"
        case .approved: "承認済みの経費は修正できません。"
        }
    }
}

@Observable @MainActor
final class ExpenseStore {
    let uid: String
    let settings: SettingsStore

    /// 利用日の新しい順
    private(set) var expenses: [Expense] = []
    private(set) var unsentIds: Set<String> = []
    @ObservationIgnored private var listener: ListenerRegistration?

    init(uid: String, settings: SettingsStore) {
        self.uid = uid
        self.settings = settings
    }

    private var collection: CollectionReference { Firestore.db.collection("expenses") }

    func start() {
        listener = collection.whereField("userId", isEqualTo: uid).listen(Expense.self) { [weak self] items, pending in
            self?.expenses = items.sorted { ($0.usedOn, $0.createdAt) > ($1.usedOn, $1.createdAt) }
            self?.unsentIds = pending
        }
    }

    func stop() {
        listener?.remove()
        listener = nil
    }

    func expenses(in month: String) -> [Expense] {
        expenses.filter { $0.month == month }
    }

    func expense(id: String) -> Expense? {
        expenses.first { $0.id == id }
    }

    func newExpenseId() -> String {
        collection.document().documentID
    }

    func draft(from expense: Expense) -> ExpenseDraft {
        ExpenseDraft(
            usedOn: expense.usedOnDate ?? Date(),
            amount: expense.amount,
            vendor: expense.vendor,
            categoryId: expense.categoryId,
            invoiceNumber: expense.invoiceNumber,
            memo: expense.memo,
            ocrText: expense.ocrText,
            receiptPath: expense.receiptPath
        )
    }

    /// 撮影した領収書を読み取って入力欄を埋める
    func draft(fromReceipt image: UIImage) async -> ExpenseDraft {
        var draft = ExpenseDraft(newReceipt: image)
        guard let result = try? await OCRService.recognize(image) else { return draft }
        draft.ocrText = result.text
        draft.usedOn = result.fields.usedOn ?? Date()
        draft.amount = result.fields.amount
        draft.vendor = result.fields.vendor ?? ""
        draft.invoiceNumber = result.fields.invoiceNumber ?? ""
        draft.categoryId = CategoryClassifier.classify(vendor: result.fields.vendor, text: result.text, categories: settings.categories)
        return draft
    }

    func validate(_ draft: ExpenseDraft) throws {
        var missing: [String] = []
        if (draft.amount ?? 0) <= 0 { missing.append("金額") }
        if draft.vendor.trimmingCharacters(in: .whitespaces).isEmpty { missing.append("お店・会社名") }
        if !draft.hasReceipt { missing.append("領収書の画像") }
        if !missing.isEmpty { throw ExpenseError.missing(missing) }
        if !ReceiptParser.isValidInvoiceNumber(draft.invoiceNumber) { throw ExpenseError.invalidInvoice }
    }

    /// 保存する。submit: true = 申請、false = 下書き、nil = 状態を変えない（申請済みの修正）
    func save(_ draft: ExpenseDraft, expenseId: String, existing: Expense?, submit: Bool?) throws {
        if existing?.status == .approved { throw ExpenseError.approved }
        let status: ExpenseStatus = switch submit {
        case true?: .submitted
        case false?: .draft
        case nil: existing?.status == .submitted ? .submitted : .draft
        }
        if status == .submitted {
            try validate(draft)
        } else if !ReceiptParser.isValidInvoiceNumber(draft.invoiceNumber) {
            throw ExpenseError.invalidInvoice
        }

        var receiptPath = draft.receiptPath
        if let image = draft.newReceipt, let data = ImageProcessing.receipt(image) {
            let path = "receipts/\(uid)/\(expenseId).jpg"
            try UploadQueue.shared.enqueue(data, path: path)
            receiptPath = path
        }

        let now = Date()
        let expense = Expense(
            userId: uid,
            usedOn: WorkCalendar.dayKey(draft.usedOn),
            month: settings.period.monthKey(for: draft.usedOn),
            amount: draft.amount ?? 0,
            vendor: draft.vendor.trimmingCharacters(in: .whitespaces),
            categoryId: draft.categoryId,
            invoiceNumber: draft.invoiceNumber,
            memo: draft.memo,
            receiptPath: receiptPath,
            ocrText: draft.ocrText,
            status: status,
            createdAt: existing?.createdAt ?? now,
            updatedAt: existing == nil ? nil : now,
            submittedAt: status == .submitted ? (existing?.submittedAt ?? now) : nil
        )
        try collection.document(expenseId).setData(from: expense)
    }

    /// 申請する（下書き・差し戻しから）
    func submit(_ expense: Expense) throws {
        guard let id = expense.id else { return }
        try save(draft(from: expense), expenseId: id, existing: expense, submit: true)
    }

    /// 申請を取り消す（下書きに戻す）
    func cancelSubmission(_ expense: Expense) {
        guard let id = expense.id, expense.status == .submitted else { return }
        collection.document(id).updateData([
            "status": ExpenseStatus.draft.rawValue,
            "submittedAt": FieldValue.delete(),
            "updatedAt": Timestamp(date: Date()),
        ])
    }

    func deleteDraft(_ expense: Expense) {
        guard let id = expense.id, expense.status == .draft || expense.status == .returned else { return }
        collection.document(id).delete()
    }
}
