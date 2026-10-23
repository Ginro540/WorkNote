import SwiftUI
import PhotosUI
import WorkNoteCore

/// 経費の確認・編集画面を開くための情報
struct ExpenseEditing: Identifiable {
    let expenseId: String
    let existing: Expense?
    let draft: ExpenseDraft
    var id: String { expenseId }
}

/// 経費一覧：月ごとに表示し、月の合計金額と区分別の合計を表示
struct ExpenseListView: View {
    @Environment(ExpenseStore.self) private var store
    @Environment(SettingsStore.self) private var settings

    @State private var month = ""
    @State private var showsScanner = false
    @State private var photoItem: PhotosPickerItem?
    @State private var isReading = false
    @State private var editing: ExpenseEditing?

    var body: some View {
        let expenses = store.expenses(in: month)
        ScrollView {
            VStack(spacing: 16) {
                OfflineBanner()
                captureButtons
                MonthTotalCard(month: $month, expenses: expenses)
                if expenses.isEmpty {
                    Text("この月の経費はありません")
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                        .padding(.vertical, 24)
                } else {
                    VStack(spacing: 0) {
                        ForEach(expenses) { expense in
                            NavigationLink {
                                ExpenseDetailView(expenseId: expense.id ?? "")
                            } label: {
                                ExpenseRow(expense: expense, isUnsent: store.unsentIds.contains(expense.id ?? ""))
                            }
                            .buttonStyle(.plain)
                            if expense.id != expenses.last?.id { Divider().padding(.leading, 76) }
                        }
                    }
                    .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: Theme.cardRadius, style: .continuous))
                }
            }
            .padding(16)
        }
        .background(Color(.systemGroupedBackground))
        .navigationTitle("経費")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    editing = ExpenseEditing(expenseId: store.newExpenseId(), existing: nil, draft: ExpenseDraft())
                } label: {
                    Image(systemName: "square.and.pencil")
                }
                .accessibilityLabel("手入力で経費を作る")
            }
        }
        .overlay {
            if isReading {
                VStack(spacing: 12) {
                    ProgressView().controlSize(.large)
                    Text("領収書を読み取っています…").font(.subheadline)
                }
                .padding(28)
                .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 20))
            }
        }
        .onAppear {
            if month.isEmpty { month = settings.period.monthKey(for: Date()) }
        }
        .fullScreenCover(isPresented: $showsScanner) {
            DocumentScannerView { image in
                showsScanner = false
                read(image)
            } onCancel: {
                showsScanner = false
            }
            .ignoresSafeArea()
        }
        .onChange(of: photoItem) { _, item in
            guard let item else { return }
            Task {
                if let data = try? await item.loadTransferable(type: Data.self), let image = UIImage(data: data) {
                    read(image)
                }
                photoItem = nil
            }
        }
        .sheet(item: $editing) { e in
            ExpenseEditView(expenseId: e.expenseId, existing: e.existing, initialDraft: e.draft)
        }
    }

    private var captureButtons: some View {
        HStack(spacing: 12) {
            Button {
                showsScanner = true
            } label: {
                HStack(spacing: 14) {
                    Image(systemName: "doc.viewfinder")
                        .font(.title2.weight(.semibold))
                        .frame(width: 48, height: 48)
                        .background(.white.opacity(0.22), in: RoundedRectangle(cornerRadius: 14))
                    VStack(alignment: .leading, spacing: 2) {
                        Text("領収書を撮影").font(.headline)
                        Text("自動で読み取ります").font(.caption).opacity(0.9)
                    }
                    Spacer(minLength: 0)
                }
                .foregroundStyle(.white)
                .padding(16)
                .frame(maxWidth: .infinity)
                .background(Theme.expense, in: RoundedRectangle(cornerRadius: 24, style: .continuous))
                .shadow(color: Color(hex: 0xEC4899).opacity(0.3), radius: 14, y: 6)
            }
            .buttonStyle(.plain)
            .disabled(!DocumentScannerView.isAvailable)

            PhotosPicker(selection: $photoItem, matching: .images) {
                VStack(spacing: 6) {
                    Image(systemName: "photo.on.rectangle.angled").font(.title2)
                    Text("写真から").font(.caption.weight(.semibold))
                }
                .foregroundStyle(Theme.expenseColor)
                .frame(width: 104, height: 80)
                .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 24, style: .continuous))
            }
        }
    }

    private func read(_ image: UIImage) {
        isReading = true
        Task {
            let draft = await store.draft(fromReceipt: image)
            isReading = false
            editing = ExpenseEditing(expenseId: store.newExpenseId(), existing: nil, draft: draft)
        }
    }
}

/// 月の合計金額と区分別の合計（色の帯）
private struct MonthTotalCard: View {
    @Binding var month: String
    let expenses: [Expense]

    @Environment(SettingsStore.self) private var settings

    var body: some View {
        let total = expenses.map(\.amount).reduce(0, +)
        let byCategory = Dictionary(grouping: expenses, by: \.categoryId)
            .map { CategoryTotal(id: $0.key, amount: $0.value.map(\.amount).reduce(0, +)) }
            .sorted { $0.amount > $1.amount }

        Card(padding: 20) {
            HStack {
                Button { month = WorkCalendar.shiftMonthKey(month, by: -1) } label: {
                    Image(systemName: "chevron.left")
                }
                .accessibilityLabel("前月")
                Spacer()
                Text(monthLabel).font(.headline)
                Spacer()
                Button { month = WorkCalendar.shiftMonthKey(month, by: 1) } label: {
                    Image(systemName: "chevron.right")
                }
                .accessibilityLabel("翌月")
                .disabled(month >= settings.period.monthKey(for: Date()))
            }
            VStack(alignment: .leading, spacing: 2) {
                Text("合計").font(.caption).foregroundStyle(.secondary)
                Text(total.yen)
                    .font(.system(size: 40, weight: .bold, design: .rounded))
                    .monospacedDigit()
            }
            if total > 0 {
                GeometryReader { geo in
                    HStack(spacing: 2) {
                        ForEach(byCategory) { item in
                            Rectangle()
                                .fill(CategoryStyle.color(item.id))
                                .frame(width: max(4, (geo.size.width - CGFloat(byCategory.count - 1) * 2) * CGFloat(item.amount) / CGFloat(total)))
                        }
                    }
                }
                .frame(height: 12)
                .clipShape(Capsule())
                VStack(spacing: 8) {
                    ForEach(byCategory) { item in
                        HStack {
                            Circle().fill(CategoryStyle.color(item.id)).frame(width: 10, height: 10)
                            Text(settings.category(id: item.id).name).font(.subheadline)
                            Spacer()
                            Text(item.amount.yen).font(.subheadline.weight(.semibold)).monospacedDigit()
                        }
                    }
                }
            }
        }
    }

    private var monthLabel: String {
        guard let (y, m) = WorkCalendar.yearMonth(fromMonthKey: month) else { return "" }
        return "\(y)年\(m)月"
    }
}

private struct CategoryTotal: Identifiable {
    let id: String
    let amount: Int
}

/// 区分のアイコン
struct CategoryIcon: View {
    let categoryId: String
    var size: CGFloat = 44

    var body: some View {
        Image(systemName: CategoryStyle.icon(categoryId))
            .font(.system(size: size * 0.45, weight: .semibold))
            .foregroundStyle(.white)
            .frame(width: size, height: size)
            .background(CategoryStyle.color(categoryId).gradient, in: RoundedRectangle(cornerRadius: size * 0.27, style: .continuous))
    }
}

private struct ExpenseRow: View {
    let expense: Expense
    let isUnsent: Bool
    @Environment(SettingsStore.self) private var settings

    var body: some View {
        HStack(spacing: 14) {
            CategoryIcon(categoryId: expense.categoryId)
            VStack(alignment: .leading, spacing: 4) {
                Text(expense.vendor.isEmpty ? "（支払先なし）" : expense.vendor)
                    .font(.headline)
                    .lineLimit(1)
                HStack(spacing: 6) {
                    Text("\(expense.usedOnDate.map(WorkCalendar.shortDayLabel) ?? expense.usedOn) \(settings.category(id: expense.categoryId).name)")
                    if isUnsent { UnsentMark() }
                }
                .font(.caption)
                .foregroundStyle(.secondary)
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 4) {
                Text(expense.amount.yen).font(.headline).monospacedDigit()
                StatusBadge(text: expense.status.label, color: expense.status.color)
            }
        }
        .padding(16)
        .contentShape(Rectangle())
    }
}
