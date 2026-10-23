import SwiftUI
import FirebaseFirestore
import WorkNoteCore

/// 日報の詳細：提出した内容を表示。承認前なら「修正する」で直せる。修正した日報には「修正履歴」が出る
struct ReportDetailView: View {
    let reportId: String

    @Environment(ReportStore.self) private var store
    @Environment(SettingsStore.self) private var settings

    @State private var revisions: [ReportRevision] = []
    @State private var listener: ListenerRegistration?
    @State private var editing = false
    @State private var zoomPath: String?

    var body: some View {
        Group {
            if let report = store.report(id: reportId) {
                content(report)
            } else {
                ContentUnavailableView("日報が見つかりません", systemImage: "doc.questionmark")
            }
        }
        .background(Color(.systemGroupedBackground))
        .navigationTitle(store.report(id: reportId)?.dateValue.map(WorkCalendar.shortDayLabel) ?? "日報")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if let report = store.report(id: reportId), report.status != .approved {
                ToolbarItem(placement: .topBarTrailing) {
                    Button(report.status == .draft ? "編集する" : "修正する") { editing = true }
                }
            }
        }
        .sheet(isPresented: $editing) {
            if let report = store.report(id: reportId) {
                ReportEditorView(reportId: reportId, existing: report, initialDate: report.dateValue ?? Date())
            }
        }
        .fullScreenCover(item: $zoomPath) { path in
            StorageZoomView(path: path)
        }
        .onAppear {
            listener = store.revisionsQuery(reportId: reportId).listen(ReportRevision.self) { items, _ in
                revisions = items.sorted { $0.editedAt < $1.editedAt }
            }
        }
        .onDisappear {
            listener?.remove()
            listener = nil
        }
    }

    private func content(_ report: DailyReport) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 14) {
                HStack {
                    StatusBadge(text: report.status.label, color: report.status.color)
                    if store.unsentIds.contains(reportId) { UnsentMark() }
                    Spacer()
                    if let submittedAt = report.submittedAt {
                        Text("提出 \(submittedAt.formatted(.dateTime.month().day().hour().minute()))")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }

                VStack(alignment: .leading, spacing: 0) {
                    let fields = settings.template.filter { $0.type != .date && $0.type != .photos }
                    ForEach(fields) { field in
                        VStack(alignment: .leading, spacing: 6) {
                            Text(field.label).font(.caption).foregroundStyle(.secondary)
                            Text(ReportFormatter.display(field: field, values: report.values))
                                .font(.body)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }
                        .padding(.vertical, 14)
                        if field.id != fields.last?.id { Divider() }
                    }
                }
                .padding(.horizontal, 20)
                .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: Theme.cardRadius, style: .continuous))

                if !report.photoPaths.isEmpty {
                    Card {
                        Text("写真（\(report.photoPaths.count)枚）").font(.caption).foregroundStyle(.secondary)
                        LazyVGrid(columns: [GridItem(.adaptive(minimum: 100), spacing: 8)], spacing: 8) {
                            ForEach(report.photoPaths, id: \.self) { path in
                                Button { zoomPath = path } label: {
                                    StorageImage(path: path)
                                        .frame(height: 100)
                                        .frame(maxWidth: .infinity)
                                        .clipShape(RoundedRectangle(cornerRadius: 12))
                                }
                            }
                        }
                    }
                }

                if !revisions.isEmpty {
                    NavigationLink {
                        RevisionHistoryView(report: report, revisions: revisions)
                    } label: {
                        HStack {
                            Label("修正履歴（\(revisions.count)件）", systemImage: "clock.arrow.circlepath")
                            Spacer()
                            Image(systemName: "chevron.right").foregroundStyle(.tertiary)
                        }
                        .padding(18)
                        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(16)
        }
    }
}

enum ReportFormatter {
    /// 項目の表示用の文字
    static func display(field: ReportField, values: [String: String]) -> String {
        let raw = values[field.key]?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard !raw.isEmpty else { return "—" }
        if field.type == .timeRange, let range = TimeRange(raw) { return range.label }
        return raw
    }
}

/// 修正履歴：いつ・どの項目が・どう変わったか。修正前の内容は取り消し線で表示
struct RevisionHistoryView: View {
    let report: DailyReport
    let revisions: [ReportRevision]

    @Environment(SettingsStore.self) private var settings

    private struct Change: Identifiable {
        let id: String
        let label: String
        let before: String
        let after: String
    }

    /// i 番目の修正で変わった項目（修正前 = revisions[i]、修正後 = 次の履歴か今の内容）
    private func changes(at index: Int) -> [Change] {
        let before = revisions[index]
        let afterValues = index + 1 < revisions.count ? revisions[index + 1].values : report.values
        let afterPhotos = index + 1 < revisions.count ? revisions[index + 1].photoPaths : report.photoPaths
        var result: [Change] = []
        if let oldDate = before.values["date"] {
            let newDate = afterValues["date"] ?? report.date
            result.append(Change(id: "date", label: "日付", before: dayLabel(oldDate), after: dayLabel(newDate)))
        }
        let keys = settings.template.map(\.key) + Set(before.values.keys).union(afterValues.keys)
            .subtracting(settings.template.map(\.key)).subtracting(["date"]).sorted()
        for key in keys {
            let field = settings.template.first { $0.key == key } ?? ReportField(key: key, label: key, type: .text, required: false, order: 0)
            if field.type == .date || field.type == .photos { continue }
            let old = ReportFormatter.display(field: field, values: before.values)
            let new = ReportFormatter.display(field: field, values: afterValues)
            if old != new { result.append(Change(id: key, label: field.label, before: old, after: new)) }
        }
        if before.photoPaths != afterPhotos {
            result.append(Change(id: "photos", label: "写真", before: "\(before.photoPaths.count)枚", after: "\(afterPhotos.count)枚"))
        }
        return result
    }

    private func dayLabel(_ key: String) -> String {
        WorkCalendar.date(fromDayKey: key).map(WorkCalendar.shortDayLabel) ?? key
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                ForEach(Array(revisions.indices.reversed()), id: \.self) { index in
                    VStack(alignment: .leading, spacing: 10) {
                        Text("\(WorkCalendar.shortDayLabel(revisions[index].editedAt)) \(WorkCalendar.timeLabel(revisions[index].editedAt)) に修正")
                            .font(.headline)
                            .foregroundStyle(.secondary)
                            .padding(.leading, 6)
                        let list = changes(at: index)
                        if list.isEmpty {
                            Card { Text("内容の変更はありません").foregroundStyle(.secondary) }
                        }
                        ForEach(list) { change in
                            Card {
                                Text(change.label).font(.caption).foregroundStyle(.secondary)
                                Text(change.before)
                                    .strikethrough()
                                    .foregroundStyle(.secondary)
                                HStack(alignment: .top, spacing: 12) {
                                    Image(systemName: "arrow.turn.down.right").foregroundStyle(Theme.accent)
                                    Text(change.after)
                                }
                            }
                        }
                    }
                }
                Text("修正履歴は本人も管理者も削除できません。")
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .padding(.leading, 6)
            }
            .padding(16)
        }
        .background(Color(.systemGroupedBackground))
        .navigationTitle("修正履歴")
        .navigationBarTitleDisplayMode(.inline)
    }
}
