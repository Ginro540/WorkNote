import SwiftUI
import WorkNoteCore

/// 経費の詳細：金額・お店・区分・インボイス番号・メモと領収書の画像。
/// 承認前なら修正と申請の取り消し（下書きに戻す）ができる
struct ExpenseDetailView: View {
    let expenseId: String

    @Environment(ExpenseStore.self) private var store
    @Environment(SettingsStore.self) private var settings
    @Environment(\.dismiss) private var dismiss

    @State private var editing: ExpenseEditing?
    @State private var zoomPath: String?
    @State private var confirmsCancel = false
    @State private var confirmsDelete = false
    @State private var errorMessage: String?

    var body: some View {
        Group {
            if let expense = store.expense(id: expenseId) {
                content(expense)
            } else {
                ContentUnavailableView("経費が見つかりません", systemImage: "yensign.circle")
            }
        }
        .background(Color(.systemGroupedBackground))
        .navigationTitle("経費")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if let expense = store.expense(id: expenseId), expense.status.isEditable {
                ToolbarItem(placement: .topBarTrailing) {
                    Button("修正する") {
                        editing = ExpenseEditing(expenseId: expenseId, existing: expense, draft: store.draft(from: expense))
                    }
                }
            }
        }
        .sheet(item: $editing) { e in
            ExpenseEditView(expenseId: e.expenseId, existing: e.existing, initialDraft: e.draft)
        }
        .fullScreenCover(item: $zoomPath) { path in
            StorageZoomView(path: path)
        }
        .errorAlert($errorMessage)
    }

    private func content(_ expense: Expense) -> some View {
        ScrollView {
            VStack(spacing: 18) {
                VStack(spacing: 10) {
                    CategoryIcon(categoryId: expense.categoryId, size: 64)
                    Text(expense.amount.yen)
                        .font(.system(size: 44, weight: .bold, design: .rounded))
                        .monospacedDigit()
                    Text(expense.vendor).font(.title3.weight(.semibold))
                    HStack {
                        StatusBadge(text: expense.status.label, color: expense.status.color)
                        if store.unsentIds.contains(expenseId) { UnsentMark() }
                    }
                }
                .padding(.top, 8)

                if expense.status == .returned, let reason = expense.returnReason {
                    Label("差し戻し：\(reason)", systemImage: "arrow.uturn.backward.circle.fill")
                        .font(.subheadline)
                        .foregroundStyle(Theme.warning)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }

                VStack(spacing: 0) {
                    detailRow("利用日", expense.usedOnDate.map(WorkCalendar.shortDayLabel) ?? expense.usedOn)
                    Divider()
                    detailRow("区分", settings.category(id: expense.categoryId).name)
                    Divider()
                    detailRow("インボイス番号", expense.invoiceNumber.isEmpty ? "—" : expense.invoiceNumber)
                    Divider()
                    detailRow("メモ", expense.memo.isEmpty ? "—" : expense.memo)
                    if let submittedAt = expense.submittedAt {
                        Divider()
                        detailRow("申請日時", dateTime(submittedAt))
                    }
                    if let updatedAt = expense.updatedAt {
                        Divider()
                        detailRow("更新日時", dateTime(updatedAt))
                    }
                }
                .padding(.horizontal, 20)
                .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: Theme.cardRadius, style: .continuous))

                if let path = expense.receiptPath {
                    Button { zoomPath = path } label: {
                        StorageImage(path: path, contentMode: .fit)
                            .frame(maxWidth: .infinity, minHeight: 200)
                            .clipShape(RoundedRectangle(cornerRadius: 16))
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("領収書の画像を拡大")
                }

                actions(expense)
            }
            .padding(16)
        }
    }

    @ViewBuilder
    private func actions(_ expense: Expense) -> some View {
        VStack(spacing: 10) {
            switch expense.status {
            case .draft, .returned:
                Button {
                    do { try store.submit(expense) } catch { errorMessage = error.localizedDescription }
                } label: {
                    Label("申請する", systemImage: "paperplane.fill")
                        .font(.headline)
                        .frame(maxWidth: .infinity, minHeight: 52)
                        .foregroundStyle(.white)
                        .background(Theme.expense, in: Capsule())
                }
                .buttonStyle(.plain)
                Button("下書きを削除", role: .destructive) { confirmsDelete = true }
                    .font(.subheadline)
            case .submitted:
                Button("申請を取り消す（下書きに戻す）", role: .destructive) { confirmsCancel = true }
                    .font(.subheadline)
            case .approved:
                Text("承認済みのため修正できません。直す必要があるときは管理者に連絡してください。")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
        .confirmationDialog("申請を取り消して下書きに戻しますか？", isPresented: $confirmsCancel, titleVisibility: .visible) {
            Button("申請を取り消す", role: .destructive) { store.cancelSubmission(expense) }
        }
        .confirmationDialog("この下書きを削除しますか？", isPresented: $confirmsDelete, titleVisibility: .visible) {
            Button("削除", role: .destructive) {
                store.deleteDraft(expense)
                dismiss()
            }
        }
    }

    private func detailRow(_ title: String, _ value: String) -> some View {
        HStack(alignment: .top) {
            Text(title).foregroundStyle(.secondary)
            Spacer()
            Text(value).fontWeight(.semibold).multilineTextAlignment(.trailing)
        }
        .padding(.vertical, 14)
    }

    private func dateTime(_ date: Date) -> String {
        "\(WorkCalendar.shortDayLabel(date)) \(WorkCalendar.timeLabel(date))"
    }
}
