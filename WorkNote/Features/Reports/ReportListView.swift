import SwiftUI
import WorkNoteCore

/// 日報一覧：日付の新しい順、月ごと。今日の日報がなければ「今日の日報を書く」
struct ReportListView: View {
    @Environment(ReportStore.self) private var store
    @State private var editing: EditingReport?
    @State private var showsDatePicker = false
    @State private var pickedDate = Date()

    private var groupedByMonth: [(month: String, reports: [DailyReport])] {
        let groups = Dictionary(grouping: store.reports) { $0.month }
        return groups.keys.sorted(by: >).map { ($0, groups[$0]!) }
    }

    var body: some View {
        let todayKey = WorkCalendar.dayKey(Date())
        let todayReport = store.report(on: todayKey)

        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                OfflineBanner()

                if todayReport == nil || todayReport?.status == .draft {
                    todayButton(isDraft: todayReport != nil) {
                        open(todayReport, date: Date())
                    }
                }

                if store.reports.isEmpty {
                    ContentUnavailableView("日報はまだありません", systemImage: "doc.text",
                                           description: Text("「今日の日報を書く」から作成できます。"))
                }

                ForEach(groupedByMonth, id: \.month) { group in
                    VStack(alignment: .leading, spacing: 10) {
                        Text(monthLabel(group.month))
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(.secondary)
                            .padding(.leading, 6)
                        ForEach(group.reports) { report in
                            NavigationLink {
                                ReportDetailView(reportId: report.id ?? "")
                            } label: {
                                ReportRow(report: report, isUnsent: store.unsentIds.contains(report.id ?? ""))
                            }
                            .buttonStyle(.plain)
                        }
                    }
                }
            }
            .padding(16)
        }
        .background(Color(.systemGroupedBackground))
        .navigationTitle("日報")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Button {
                    pickedDate = Date()
                    showsDatePicker = true
                } label: {
                    Image(systemName: "square.and.pencil")
                }
                .accessibilityLabel("日付を選んで日報を書く")
            }
        }
        .sheet(item: $editing) { e in
            ReportEditorView(reportId: e.reportId, existing: e.report, initialDate: e.date)
        }
        .sheet(isPresented: $showsDatePicker) {
            NavigationStack {
                DatePicker("日付", selection: $pickedDate, in: ...Date(), displayedComponents: .date)
                    .datePickerStyle(.graphical)
                    .environment(\.locale, Locale(identifier: "ja_JP"))
                    .padding()
                    .navigationTitle("日報の日付")
                    .navigationBarTitleDisplayMode(.inline)
                    .toolbar {
                        ToolbarItem(placement: .cancellationAction) {
                            Button("キャンセル") { showsDatePicker = false }
                        }
                        ToolbarItem(placement: .confirmationAction) {
                            Button("書く") {
                                showsDatePicker = false
                                let report = store.report(on: WorkCalendar.dayKey(pickedDate))
                                open(report, date: pickedDate)
                            }
                        }
                    }
            }
            .presentationDetents([.medium, .large])
        }
    }

    private func open(_ report: DailyReport?, date: Date) {
        if let report, let id = report.id {
            if report.status == .approved { return }
            editing = EditingReport(reportId: id, report: report, date: date)
        } else {
            editing = EditingReport(reportId: store.reportId(for: date), report: nil, date: date)
        }
    }

    private func monthLabel(_ month: String) -> String {
        guard let (y, m) = WorkCalendar.yearMonth(fromMonthKey: month) else { return month }
        return "\(y)年\(m)月"
    }

    private func todayButton(isDraft: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 16) {
                Image(systemName: "square.and.pencil")
                    .font(.title2.weight(.semibold))
                    .frame(width: 56, height: 56)
                    .background(.white.opacity(0.22), in: Circle())
                VStack(alignment: .leading, spacing: 4) {
                    Text(isDraft ? "今日の日報を続ける" : "今日の日報を書く")
                        .font(.title3.weight(.bold))
                    Text(WorkCalendar.shortDayLabel(Date()) + (isDraft ? "　下書き" : ""))
                        .font(.subheadline)
                        .opacity(0.9)
                }
                Spacer()
                Image(systemName: "chevron.right").font(.headline)
            }
            .foregroundStyle(.white)
            .padding(20)
            .background(Theme.report, in: RoundedRectangle(cornerRadius: 26, style: .continuous))
            .shadow(color: Color(hex: 0x1E8FC4).opacity(0.3), radius: 16, y: 8)
        }
        .buttonStyle(.plain)
    }
}

private struct ReportRow: View {
    let report: DailyReport
    let isUnsent: Bool

    var body: some View {
        HStack {
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 8) {
                    Text(report.dateValue.map(WorkCalendar.shortDayLabel) ?? report.date)
                        .font(.headline)
                    StatusBadge(text: report.status.label, color: report.status.color)
                    if isUnsent { UnsentMark() }
                }
                Text(report.summaryLine.isEmpty ? "内容なし" : report.summaryLine)
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
            }
            Spacer()
            Image(systemName: "chevron.right").foregroundStyle(.tertiary)
        }
        .padding(16)
        .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 20, style: .continuous))
    }
}
