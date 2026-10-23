import SwiftUI
import PhotosUI
import WorkNoteCore

/// 経費の確認・編集：領収書の画像を見ながら、読み取った内容と自動判定した区分を確認して申請する
struct ExpenseEditView: View {
    let expenseId: String
    let existing: Expense?

    @Environment(ExpenseStore.self) private var store
    @Environment(SettingsStore.self) private var settings
    @Environment(\.dismiss) private var dismiss

    @State private var draft: ExpenseDraft
    @State private var amountText: String
    @State private var errorMessage: String?
    @State private var zoomItem: IdentifiedImage?
    @State private var zoomPath: String?
    @State private var showsScanner = false
    @State private var photoItem: PhotosPickerItem?
    @State private var isReading = false
    @FocusState private var focusedField: String?

    init(expenseId: String, existing: Expense?, initialDraft: ExpenseDraft) {
        self.expenseId = expenseId
        self.existing = existing
        _draft = State(initialValue: initialDraft)
        _amountText = State(initialValue: initialDraft.amount.map(String.init) ?? "")
    }

    private var isEditingSubmitted: Bool { existing?.status == .submitted }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 14) {
                    if let reason = existing?.returnReason, existing?.status == .returned {
                        Label("差し戻し：\(reason)", systemImage: "arrow.uturn.backward.circle.fill")
                            .font(.subheadline)
                            .foregroundStyle(Theme.warning)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    receiptPreview
                    fieldsCard
                    categoryCard
                    Card {
                        Text("メモ").font(.headline)
                        TextField("用途・同行者など", text: $draft.memo, axis: .vertical)
                            .lineLimit(2...6)
                            .padding(12)
                            .background(Color(.systemGray6), in: RoundedRectangle(cornerRadius: 14))
                    }
                    Text("紙の領収書は会社に提出してください。")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                .padding(16)
            }
            .scrollDismissesKeyboard(.interactively)
            .background(Color(.systemGroupedBackground))
            .navigationTitle(existing == nil ? "経費を確認" : "経費を修正")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("閉じる") { dismiss() }
                }
                ToolbarItem(placement: .keyboard) {
                    HStack {
                        Spacer()
                        Button("完了") { focusedField = nil }
                    }
                }
            }
            .safeAreaInset(edge: .bottom) { bottomBar }
            .errorAlert($errorMessage)
            .fullScreenCover(item: $zoomItem) { item in
                ZoomableImageView(image: item.image)
            }
            .fullScreenCover(item: $zoomPath) { path in
                StorageZoomView(path: path)
            }
            .fullScreenCover(isPresented: $showsScanner) {
                DocumentScannerView { image in
                    showsScanner = false
                    replaceReceipt(image)
                } onCancel: {
                    showsScanner = false
                }
                .ignoresSafeArea()
            }
            .onChange(of: photoItem) { _, item in
                guard let item else { return }
                Task {
                    if let data = try? await item.loadTransferable(type: Data.self), let image = UIImage(data: data) {
                        replaceReceipt(image)
                    }
                    photoItem = nil
                }
            }
        }
        .interactiveDismissDisabled()
    }

    // MARK: - 領収書

    @ViewBuilder private var receiptPreview: some View {
        VStack(spacing: 10) {
            ZStack(alignment: .bottomTrailing) {
                Group {
                    if let image = draft.newReceipt {
                        Image(uiImage: image).resizable().scaledToFill()
                    } else if let path = draft.receiptPath {
                        StorageImage(path: path)
                    } else {
                        VStack(spacing: 8) {
                            Image(systemName: "doc.text.image").font(.largeTitle)
                            Text("領収書の画像がありません").font(.subheadline)
                        }
                        .foregroundStyle(.secondary)
                    }
                }
                .frame(maxWidth: .infinity)
                .frame(height: 240, alignment: .top)
                .clipped()
                .background(Color(.systemGray6))

                if draft.hasReceipt {
                    Button {
                        if let image = draft.newReceipt { zoomItem = IdentifiedImage(image: image) } else { zoomPath = draft.receiptPath }
                    } label: {
                        Label("拡大", systemImage: "arrow.up.left.and.arrow.down.right")
                            .font(.caption.weight(.semibold))
                            .padding(.horizontal, 12)
                            .padding(.vertical, 8)
                            .background(.regularMaterial, in: Capsule())
                    }
                    .padding(12)
                    .buttonStyle(.plain)
                }
                if isReading {
                    ProgressView("読み取り中…")
                        .padding()
                        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 12))
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            }
            .clipShape(RoundedRectangle(cornerRadius: Theme.cardRadius, style: .continuous))

            HStack(spacing: 10) {
                Button {
                    showsScanner = true
                } label: {
                    Label(draft.hasReceipt ? "撮り直す" : "撮影する", systemImage: "doc.viewfinder")
                        .frame(maxWidth: .infinity, minHeight: 40)
                }
                .buttonStyle(.bordered)
                .disabled(!DocumentScannerView.isAvailable)
                PhotosPicker(selection: $photoItem, matching: .images) {
                    Label("写真から", systemImage: "photo")
                        .frame(maxWidth: .infinity, minHeight: 40)
                }
                .buttonStyle(.bordered)
            }
            .tint(Theme.expenseColor)
        }
    }

    /// 領収書を差し替えて読み取り直す（空欄だけ埋める）
    private func replaceReceipt(_ image: UIImage) {
        draft.newReceipt = image
        isReading = true
        Task {
            let read = await store.draft(fromReceipt: image)
            isReading = false
            draft.ocrText = read.ocrText
            if amountText.isEmpty, let amount = read.amount { amountText = String(amount) }
            if draft.vendor.isEmpty { draft.vendor = read.vendor }
            if draft.invoiceNumber.isEmpty { draft.invoiceNumber = read.invoiceNumber }
            if existing == nil && !read.ocrText.isEmpty {
                draft.usedOn = read.usedOn
                if draft.categoryId == ExpenseCategory.otherID { draft.categoryId = read.categoryId }
            }
        }
    }

    // MARK: - 入力欄

    private var fieldsCard: some View {
        VStack(spacing: 0) {
            row(label: "利用日", required: true) {
                DatePicker("利用日", selection: $draft.usedOn, in: ...Date(), displayedComponents: .date)
                    .labelsHidden()
                    .environment(\.locale, Locale(identifier: "ja_JP"))
            }
            Divider()
            row(label: "金額（税込）", required: true) {
                HStack {
                    Text("¥").foregroundStyle(.secondary)
                    TextField("0", text: $amountText)
                        .keyboardType(.numberPad)
                        .multilineTextAlignment(.trailing)
                        .font(.title3.weight(.bold))
                        .monospacedDigit()
                        .focused($focusedField, equals: "amount")
                        .onChange(of: amountText) { _, text in
                            let digits = text.filter(\.isNumber)
                            if digits != text { amountText = digits }
                            draft.amount = Int(digits)
                        }
                }
            }
            Divider()
            row(label: "お店・会社名", required: true) {
                TextField("支払先", text: $draft.vendor)
                    .multilineTextAlignment(.trailing)
                    .focused($focusedField, equals: "vendor")
            }
            Divider()
            row(label: "インボイス番号", note: "領収書の「T」で始まる番号。\nなければ空欄") {
                TextField("T0000000000000", text: $draft.invoiceNumber)
                    .multilineTextAlignment(.trailing)
                    .textInputAutocapitalization(.characters)
                    .autocorrectionDisabled()
                    .keyboardType(.asciiCapable)
                    .monospacedDigit()
                    .focused($focusedField, equals: "invoice")
                    .foregroundStyle(ReceiptParser.isValidInvoiceNumber(draft.invoiceNumber) ? Color.primary : Color.red)
            }
        }
        .padding(.horizontal, 20)
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: Theme.cardRadius, style: .continuous))
    }

    private func row<Content: View>(label: String, required: Bool = false, note: String? = nil, @ViewBuilder content: () -> Content) -> some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 2) {
                HStack(spacing: 4) {
                    Text(label).font(.subheadline.weight(.semibold))
                    if required { Circle().fill(.red).frame(width: 6, height: 6) }
                }
                if let note {
                    Text(note).font(.caption2).foregroundStyle(.secondary)
                }
            }
            .fixedSize()
            Spacer()
            content()
        }
        .padding(.vertical, 14)
    }

    private var categoryCard: some View {
        Card {
            HStack(spacing: 4) {
                Text("区分").font(.headline)
                Circle().fill(.red).frame(width: 6, height: 6)
            }
            LazyVGrid(columns: [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)], spacing: 10) {
                ForEach(settings.categories) { category in
                    let selected = draft.categoryId == category.id
                    Button {
                        draft.categoryId = category.id
                    } label: {
                        HStack(spacing: 8) {
                            Image(systemName: CategoryStyle.icon(category.id))
                            Text(category.name).lineLimit(1).minimumScaleFactor(0.8)
                            Spacer(minLength: 0)
                        }
                        .font(.subheadline.weight(.semibold))
                        .padding(.horizontal, 14)
                        .frame(minHeight: 46)
                        .foregroundStyle(selected ? .white : .primary)
                        .background(selected ? AnyShapeStyle(CategoryStyle.color(category.id).gradient) : AnyShapeStyle(Color(.systemGray5)),
                                    in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    // MARK: - 保存・申請

    private var bottomBar: some View {
        HStack(spacing: 12) {
            if isEditingSubmitted {
                Button { save(submit: nil) } label: {
                    Label("修正を保存", systemImage: "paperplane.fill")
                        .font(.headline)
                        .frame(maxWidth: .infinity, minHeight: 56)
                        .foregroundStyle(.white)
                        .background(Theme.expense, in: Capsule())
                }
            } else {
                Button { save(submit: false) } label: {
                    Text("下書き保存")
                        .font(.headline)
                        .frame(maxWidth: .infinity, minHeight: 56)
                        .background(Color(.systemGray5), in: Capsule())
                }
                Button { save(submit: true) } label: {
                    Label("申請する", systemImage: "paperplane.fill")
                        .font(.headline)
                        .frame(maxWidth: .infinity, minHeight: 56)
                        .foregroundStyle(.white)
                        .background(Theme.expense, in: Capsule())
                }
            }
        }
        .buttonStyle(.plain)
        .padding(.horizontal, 16)
        .padding(.top, 10)
        .padding(.bottom, 4)
        .background(.bar)
        .disabled(isReading)
    }

    private func save(submit: Bool?) {
        draft.amount = Int(amountText)
        do {
            try store.save(draft, expenseId: expenseId, existing: existing, submit: submit)
            dismiss()
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

private struct IdentifiedImage: Identifiable {
    let id = UUID()
    let image: UIImage
}
