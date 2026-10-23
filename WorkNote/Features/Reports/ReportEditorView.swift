import SwiftUI
import PhotosUI
import WorkNoteCore

/// 日報の作成・編集：項目の入力、勤務先の選択、写真の追加、下書き保存、提出
struct ReportEditorView: View {
    let reportId: String
    let existing: DailyReport?
    let initialDate: Date

    @Environment(ReportStore.self) private var store
    @Environment(SettingsStore.self) private var settings
    @Environment(AttendanceStore.self) private var attendance
    @Environment(\.dismiss) private var dismiss

    @State private var draft: ReportDraft?
    /// 作業時間に出勤・退勤の時刻を入れたか
    @State private var workTimeFromAttendance = false
    @State private var showsSitePicker = false
    @State private var showsCamera = false
    @State private var photoItems: [PhotosPickerItem] = []
    @State private var errorMessage: String?
    @State private var confirmsDelete = false
    @State private var showsMissing = false

    private var isEditingSubmitted: Bool { existing?.status == .submitted }

    var body: some View {
        NavigationStack {
            Group {
                if let draft = Binding($draft) {
                    form(draft)
                } else {
                    ProgressView()
                }
            }
            .background(Color(.systemGroupedBackground))
            .navigationTitle(isEditingSubmitted ? "日報を修正" : "日報を書く")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("閉じる") { dismiss() }
                }
                if existing?.status == .draft {
                    ToolbarItem(placement: .primaryAction) {
                        Menu {
                            Button("下書きを削除", systemImage: "trash", role: .destructive) { confirmsDelete = true }
                        } label: {
                            Image(systemName: "ellipsis.circle")
                        }
                    }
                }
            }
            .safeAreaInset(edge: .bottom) { bottomBar }
            .errorAlert($errorMessage)
            .confirmationDialog("この下書きを削除しますか？", isPresented: $confirmsDelete, titleVisibility: .visible) {
                Button("削除", role: .destructive) {
                    if let existing { store.deleteDraft(existing) }
                    dismiss()
                }
            }
            .sheet(isPresented: $showsSitePicker) {
                if let draft = Binding($draft) {
                    SitePickerView(siteIds: draft.siteIds, manualSites: draft.manualSites)
                }
            }
            .fullScreenCover(isPresented: $showsCamera) {
                CameraPicker { draft?.newPhotos.append($0) }.ignoresSafeArea()
            }
            .onChange(of: photoItems) { _, items in
                guard !items.isEmpty else { return }
                Task {
                    for item in items {
                        if let data = try? await item.loadTransferable(type: Data.self), let image = UIImage(data: data) {
                            draft?.newPhotos.append(image)
                        }
                    }
                    photoItems = []
                }
            }
            .task {
                guard draft == nil else { return }
                var d = store.draft(from: existing, date: initialDate)
                if existing == nil {
                    await fillWorkTime(&d)
                }
                draft = d
            }
        }
        .interactiveDismissDisabled(draft?.newPhotos.isEmpty == false)
    }

    /// 作業時間の初期値：その日の最初の出勤と最後の退勤
    private func fillWorkTime(_ d: inout ReportDraft) async {
        let punches = await attendance.fetchPunches(on: WorkCalendar.dayKey(d.date))
        let summary = AttendanceCalculator.summarize(punches: punches.map(\.point))
        if let first = summary.firstIn, let last = summary.lastOut {
            d.values[ReportKey.workTime] = TimeRange(start: first, end: last).raw
            workTimeFromAttendance = true
        } else {
            d.values[ReportKey.workTime] = nil
            workTimeFromAttendance = false
        }
    }

    // MARK: - 入力欄

    private func form(_ draft: Binding<ReportDraft>) -> some View {
        ScrollView {
            VStack(spacing: 14) {
                if isEditingSubmitted {
                    Label("提出済みの日報を修正すると、修正前の内容が修正履歴に残ります。", systemImage: "clock.arrow.circlepath")
                        .font(.footnote)
                        .foregroundStyle(.secondary)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                ForEach(settings.template) { field in
                    fieldView(field, draft: draft)
                }
            }
            .padding(16)
            .padding(.bottom, 20)
        }
        .scrollDismissesKeyboard(.interactively)
    }

    @ViewBuilder
    private func fieldView(_ field: ReportField, draft: Binding<ReportDraft>) -> some View {
        switch field.type {
        case .date:
            Card {
                HStack {
                    Image(systemName: "calendar").foregroundStyle(Color(hex: 0x22B07D))
                    Text(field.label).font(.headline)
                    Spacer()
                    // 一度保存した日報は日付を変えない（ID が日付で決まるため）
                    DatePicker(field.label, selection: draft.date, in: ...Date(), displayedComponents: .date)
                        .labelsHidden()
                        .disabled(existing != nil)
                        .environment(\.locale, Locale(identifier: "ja_JP"))
                }
            }
            .onChange(of: draft.wrappedValue.date) { old, new in
                guard existing == nil, WorkCalendar.dayKey(old) != WorkCalendar.dayKey(new) else { return }
                Task {
                    var d = draft.wrappedValue
                    if workTimeFromAttendance || d.values[ReportKey.workTime] == nil {
                        await fillWorkTime(&d)
                        self.draft?.values[ReportKey.workTime] = d.values[ReportKey.workTime]
                    }
                }
            }

        case .weather:
            Card {
                header(field)
                HStack(spacing: 8) {
                    ForEach(WeatherOption.all) { option in
                        let name = option.name
                        let selected = draft.wrappedValue.values[field.key] == name
                        Button {
                            draft.wrappedValue.values[field.key] = selected ? nil : name
                        } label: {
                            Label(name, systemImage: option.icon)
                                .font(.subheadline.weight(.semibold))
                                .padding(.horizontal, 12)
                                .padding(.vertical, 9)
                                .foregroundStyle(selected ? .white : .primary)
                                .background(selected ? AnyShapeStyle(Theme.report) : AnyShapeStyle(Color(.systemGray5)), in: Capsule())
                        }
                        .buttonStyle(.plain)
                    }
                }
            }

        case .timeRange:
            Card {
                header(field)
                timeRangeEditor(field, draft: draft)
                if workTimeFromAttendance {
                    Label("出勤・退勤の時刻を入れています", systemImage: "clock.badge.checkmark")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }

        case .sites:
            Card {
                header(field)
                let names = draft.wrappedValue.siteIds.map { id in settings.site(id: id)?.name ?? "（削除された勤務先）" }
                FlowLayout(spacing: 8) {
                    ForEach(Array(draft.wrappedValue.siteIds.enumerated()), id: \.element) { index, id in
                        siteChip(names[index]) { draft.wrappedValue.siteIds.removeAll { $0 == id } }
                    }
                    ForEach(draft.wrappedValue.manualSites, id: \.self) { name in
                        siteChip(name) { draft.wrappedValue.manualSites.removeAll { $0 == name } }
                    }
                }
                Button {
                    showsSitePicker = true
                } label: {
                    Label("勤務先を追加・変更", systemImage: "building.2")
                        .font(.subheadline.weight(.semibold))
                        .frame(maxWidth: .infinity, minHeight: 48)
                        .background(Color(hex: 0x1E8FC4).opacity(0.1), in: RoundedRectangle(cornerRadius: 14))
                }
                .buttonStyle(.plain)
                .foregroundStyle(Color(hex: 0x1E8FC4))
            }

        case .longText, .text:
            Card {
                header(field)
                let binding = Binding(
                    get: { draft.wrappedValue.values[field.key] ?? "" },
                    set: { draft.wrappedValue.values[field.key] = $0 }
                )
                if field.type == .longText {
                    // キーボードのマイクで音声入力が使える
                    TextField(placeholder(field), text: binding, axis: .vertical)
                        .lineLimit(4...20)
                        .padding(12)
                        .background(Color(.systemGray6), in: RoundedRectangle(cornerRadius: 14))
                } else {
                    TextField(placeholder(field), text: binding)
                        .padding(12)
                        .background(Color(.systemGray6), in: RoundedRectangle(cornerRadius: 14))
                }
            }

        case .photos:
            Card {
                header(field)
                photosEditor(draft)
            }
        }
    }

    private func header(_ field: ReportField) -> some View {
        HStack(spacing: 8) {
            Text(field.label).font(.headline)
            if field.required { RequiredBadge() }
        }
    }

    private func placeholder(_ field: ReportField) -> String {
        switch field.key {
        case ReportKey.content: "今日行った作業を書いてください"
        case "impressions": "気づいたこと・報告事項"
        case "tomorrow": "明日の予定"
        default: field.label
        }
    }

    private func siteChip(_ name: String, onRemove: @escaping () -> Void) -> some View {
        HStack(spacing: 6) {
            Image(systemName: "mappin.circle.fill")
            Text(name).lineLimit(1)
            Button(action: onRemove) {
                Image(systemName: "xmark.circle.fill").opacity(0.85)
            }
            .accessibilityLabel("\(name)を外す")
        }
        .font(.subheadline.weight(.semibold))
        .foregroundStyle(.white)
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(Theme.report, in: Capsule())
    }

    private func timeRangeEditor(_ field: ReportField, draft: Binding<ReportDraft>) -> some View {
        let day = WorkCalendar.startOfDay(draft.wrappedValue.date)
        let current = TimeRange(draft.wrappedValue.values[field.key])
        func binding(_ isStart: Bool) -> Binding<Date> {
            Binding(
                get: {
                    let minutes = isStart ? (current?.start ?? 9 * 60) : ((current?.end ?? 18 * 60) % 1440)
                    return day.addingTimeInterval(Double(minutes) * 60)
                },
                set: { newValue in
                    let c = WorkCalendar.calendar.dateComponents([.hour, .minute], from: newValue)
                    let m = c.hour! * 60 + c.minute!
                    var range = current ?? TimeRange(start: 9 * 60, end: 18 * 60)
                    if isStart { range.start = m } else { range.end = m }
                    draft.wrappedValue.values[field.key] = range.raw
                    workTimeFromAttendance = false
                }
            )
        }
        return HStack(spacing: 10) {
            DatePicker("開始", selection: binding(true), displayedComponents: .hourAndMinute).labelsHidden()
            Text("〜").foregroundStyle(.secondary)
            DatePicker("終了", selection: binding(false), displayedComponents: .hourAndMinute).labelsHidden()
            Spacer()
            Text(current.map { WorkCalendar.durationLabel(minutes: $0.minutes) } ?? "--:--")
                .font(.title2.weight(.bold))
                .monospacedDigit()
        }
        .environment(\.locale, Locale(identifier: "ja_JP"))
    }

    private func photosEditor(_ draft: Binding<ReportDraft>) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            let columns = [GridItem(.adaptive(minimum: 92), spacing: 8)]
            LazyVGrid(columns: columns, spacing: 8) {
                ForEach(draft.wrappedValue.photoPaths, id: \.self) { path in
                    photoTile {
                        StorageImage(path: path)
                    } onRemove: {
                        draft.wrappedValue.photoPaths.removeAll { $0 == path }
                    }
                }
                ForEach(Array(draft.wrappedValue.newPhotos.enumerated()), id: \.offset) { index, image in
                    photoTile {
                        Image(uiImage: image).resizable().scaledToFill()
                    } onRemove: {
                        draft.wrappedValue.newPhotos.remove(at: index)
                    }
                }
            }
            HStack(spacing: 10) {
                if CameraPicker.isAvailable {
                    Button {
                        showsCamera = true
                    } label: {
                        Label("カメラ", systemImage: "camera.fill").frame(maxWidth: .infinity, minHeight: 44)
                    }
                    .buttonStyle(.bordered)
                }
                PhotosPicker(selection: $photoItems, matching: .images) {
                    Label("アルバム", systemImage: "photo.on.rectangle").frame(maxWidth: .infinity, minHeight: 44)
                }
                .buttonStyle(.bordered)
            }
            Text("写真は縮小してから、裏で順番に送信します。").font(.caption).foregroundStyle(.secondary)
        }
    }

    private func photoTile<Content: View>(@ViewBuilder content: () -> Content, onRemove: @escaping () -> Void) -> some View {
        content()
            .frame(width: 92, height: 92)
            .clipShape(RoundedRectangle(cornerRadius: 12))
            .overlay(alignment: .topTrailing) {
                Button(action: onRemove) {
                    Image(systemName: "xmark.circle.fill")
                        .symbolRenderingMode(.palette)
                        .foregroundStyle(.white, .black.opacity(0.6))
                        .font(.title3)
                }
                .padding(4)
            }
    }

    // MARK: - 保存・提出

    private var bottomBar: some View {
        HStack(spacing: 12) {
            if isEditingSubmitted {
                Button {
                    save(submit: false)
                } label: {
                    Label("修正を保存", systemImage: "checkmark")
                        .font(.headline)
                        .frame(maxWidth: .infinity, minHeight: 56)
                        .foregroundStyle(.white)
                        .background(Theme.report, in: Capsule())
                }
            } else {
                Button {
                    save(submit: false)
                } label: {
                    Text("下書き保存")
                        .font(.headline)
                        .frame(maxWidth: .infinity, minHeight: 56)
                        .background(Color(.systemGray5), in: Capsule())
                }
                Button {
                    save(submit: true)
                } label: {
                    Label("提出する", systemImage: "paperplane.fill")
                        .font(.headline)
                        .frame(maxWidth: .infinity, minHeight: 56)
                        .foregroundStyle(.white)
                        .background(Theme.report, in: Capsule())
                }
            }
        }
        .buttonStyle(.plain)
        .padding(.horizontal, 16)
        .padding(.top, 10)
        .padding(.bottom, 4)
        .background(.bar)
        .disabled(draft == nil)
    }

    private func save(submit: Bool) {
        guard let draft else { return }
        do {
            try store.save(draft, reportId: reportId, existing: existing, submit: submit)
            dismiss()
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

private struct WeatherOption: Identifiable {
    let name: String
    let icon: String
    var id: String { name }

    static let all = [
        WeatherOption(name: "晴れ", icon: "sun.max.fill"),
        WeatherOption(name: "曇り", icon: "cloud.fill"),
        WeatherOption(name: "雨", icon: "cloud.rain.fill"),
        WeatherOption(name: "雪", icon: "snowflake"),
    ]
}

/// 札を左から並べ、入りきらなければ折り返す
struct FlowLayout: Layout {
    var spacing: CGFloat = 8

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let rows = arrange(width: proposal.width ?? .infinity, subviews: subviews)
        let height = rows.map(\.height).reduce(0, +) + spacing * CGFloat(max(0, rows.count - 1))
        let width = rows.map(\.width).max() ?? 0
        return CGSize(width: proposal.width ?? width, height: height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        var y = bounds.minY
        for row in arrange(width: bounds.width, subviews: subviews) {
            var x = bounds.minX
            for index in row.indices {
                let size = subviews[index].sizeThatFits(.unspecified)
                subviews[index].place(at: CGPoint(x: x, y: y), proposal: ProposedViewSize(width: min(size.width, bounds.width), height: size.height))
                x += min(size.width, bounds.width) + spacing
            }
            y += row.height + spacing
        }
    }

    private struct Row {
        var indices: [Int] = []
        var width: CGFloat = 0
        var height: CGFloat = 0
    }

    private func arrange(width: CGFloat, subviews: Subviews) -> [Row] {
        var rows: [Row] = []
        var current = Row()
        for (index, subview) in subviews.enumerated() {
            let size = subview.sizeThatFits(.unspecified)
            let w = min(size.width, width)
            if !current.indices.isEmpty && current.width + spacing + w > width {
                rows.append(current)
                current = Row()
            }
            current.width += (current.indices.isEmpty ? 0 : spacing) + w
            current.height = max(current.height, size.height)
            current.indices.append(index)
        }
        if !current.indices.isEmpty { rows.append(current) }
        return rows
    }
}
