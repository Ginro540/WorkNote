import SwiftUI
import Observation
import FirebaseFirestore
import WorkNoteCore

/// 1か月分（または1日分）の打刻を読む
@Observable @MainActor
final class PunchListener {
    private(set) var punches: [AttendancePunch] = []
    private(set) var isLoaded = false
    @ObservationIgnored private var listener: ListenerRegistration?

    func load(uid: String, field: String = "month", value: String) {
        listener?.remove()
        isLoaded = false
        punches = []
        listener = Firestore.db.collection("attendancePunches")
            .whereField("userId", isEqualTo: uid)
            .whereField(field, isEqualTo: value)
            .listen(AttendancePunch.self) { [weak self] items, _ in
                self?.punches = items.sorted { $0.punchedAt < $1.punchedAt }
                self?.isLoaded = true
            }
    }

    func stop() {
        listener?.remove()
        listener = nil
    }
}

/// 月の勤怠：1日を2行で表示（1行目に時刻と実働時間、2行目に日報の内容）
struct MonthlyAttendanceView: View {
    @Environment(AttendanceStore.self) private var store
    @Environment(SettingsStore.self) private var settings
    @Environment(ReportStore.self) private var reports

    @State private var month: String = ""
    @State private var data = PunchListener()
    @State private var editingReport: EditingReport?

    var body: some View {
        let days = settings.period.days(monthKey: month)
        let summaries = Dictionary(uniqueKeysWithValues: days.map { day -> (String, DaySummary) in
            let key = WorkCalendar.dayKey(day)
            return (key, store.summary(for: key, punches: data.punches.filter { $0.workDate == key }))
        })
        let workedDays = summaries.values.filter { !$0.sessions.isEmpty }.count
        let totalWork = summaries.values.compactMap(\.workMinutes).reduce(0, +)
        let totalOvertime = summaries.values.compactMap(\.overtimeMinutes).reduce(0, +)

        ScrollView {
            VStack(spacing: 16) {
                Card {
                    HStack {
                        stat("出勤日数", "\(workedDays)日")
                        Divider()
                        stat("合計実働", WorkCalendar.durationLabel(minutes: totalWork))
                        Divider()
                        stat("時間外", WorkCalendar.durationLabel(minutes: totalOvertime))
                    }
                    .frame(height: 54)
                    if let deadline = settings.correctionDeadline(monthKey: month) {
                        Text("修正申請の期限：\(WorkCalendar.shortDayLabel(deadline))まで")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }

                LazyVStack(spacing: 0) {
                    ForEach(days, id: \.self) { day in
                        let key = WorkCalendar.dayKey(day)
                        DayRow(
                            date: day,
                            summary: summaries[key]!,
                            report: reports.report(on: key),
                            corrections: store.corrections(on: key),
                            holiday: settings.holiday(on: key),
                            onOpenReport: { openReport(for: day) }
                        )
                        Divider().padding(.leading, 16)
                    }
                }
                .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: Theme.cardRadius, style: .continuous))
            }
            .padding(16)
        }
        .background(Color(.systemGroupedBackground))
        .navigationTitle(monthTitle)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            ToolbarItemGroup(placement: .topBarTrailing) {
                Button { month = WorkCalendar.shiftMonthKey(month, by: -1) } label: {
                    Image(systemName: "chevron.left")
                }
                .accessibilityLabel("前月")
                Button { month = WorkCalendar.shiftMonthKey(month, by: 1) } label: {
                    Image(systemName: "chevron.right")
                }
                .accessibilityLabel("翌月")
                .disabled(month >= settings.period.monthKey(for: Date()))
            }
            ToolbarItem(placement: .bottomBar) {
                NavigationLink("修正申請の一覧") { CorrectionListView() }
            }
        }
        .onAppear {
            if month.isEmpty { month = settings.period.monthKey(for: Date()) }
        }
        .onChange(of: month, initial: true) { _, newMonth in
            guard !newMonth.isEmpty else { return }
            data.load(uid: store.uid, value: newMonth)
        }
        .onDisappear { data.stop() }
        .sheet(item: $editingReport) { editing in
            ReportEditorView(reportId: editing.reportId, existing: editing.report, initialDate: editing.date)
        }
    }

    private var monthTitle: String {
        guard let (y, m) = WorkCalendar.yearMonth(fromMonthKey: month) else { return "月の勤怠" }
        return "\(y)年\(m)月"
    }

    private func stat(_ title: String, _ value: String) -> some View {
        VStack(spacing: 4) {
            Text(title).font(.caption).foregroundStyle(.secondary)
            Text(value).font(.title3.weight(.bold)).monospacedDigit()
        }
        .frame(maxWidth: .infinity)
    }

    /// 備考をタップするとその日の日報を開く（なければ書く）
    private func openReport(for day: Date) {
        let key = WorkCalendar.dayKey(day)
        if let report = reports.report(on: key), let id = report.id {
            editingReport = EditingReport(reportId: id, report: report, date: day)
        } else {
            editingReport = EditingReport(reportId: reports.reportId(for: day), report: nil, date: day)
        }
    }
}

struct EditingReport: Identifiable {
    let reportId: String
    let report: DailyReport?
    let date: Date
    var id: String { reportId }
}

/// 月の勤怠の1日分
private struct DayRow: View {
    let date: Date
    let summary: DaySummary
    let report: DailyReport?
    let corrections: [AttendanceCorrection]
    let holiday: Holiday?
    let onOpenReport: () -> Void

    @Environment(ReportStore.self) private var reports

    private var dayColor: Color {
        let weekday = WorkCalendar.weekday(date)
        if weekday == 1 || holiday != nil { return Theme.holiday }
        if weekday == 7 { return Theme.saturday }
        return .primary
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            NavigationLink {
                DayDetailView(date: date)
            } label: {
                HStack(spacing: 10) {
                    Text(WorkCalendar.shortDayLabel(date))
                        .font(.subheadline.weight(.bold))
                        .foregroundStyle(dayColor)
                        .frame(width: 78, alignment: .leading)
                    timesText
                    Spacer()
                    statusBadges
                    if let work = summary.workMinutes {
                        Text(WorkCalendar.durationLabel(minutes: work))
                            .font(.subheadline.weight(.bold))
                            .monospacedDigit()
                    }
                    Image(systemName: "chevron.right")
                        .font(.caption)
                        .foregroundStyle(.tertiary)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            remark
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
    }

    @ViewBuilder private var timesText: some View {
        if let first = summary.firstIn ?? summary.sessions.first?.clockOut?.time {
            HStack(spacing: 4) {
                Text("\(WorkCalendar.timeLabel(first))〜\(summary.lastOut.map(WorkCalendar.timeLabel) ?? "")")
                    .font(.subheadline)
                    .monospacedDigit()
                if summary.sessionCount > 1 {
                    Text("\(summary.sessionCount)回").font(.caption2).foregroundStyle(.secondary)
                }
            }
        } else if let holiday {
            Text(holiday.name).font(.caption).foregroundStyle(Theme.holiday)
        }
    }

    @ViewBuilder private var statusBadges: some View {
        if corrections.contains(where: { $0.status == .pending }) {
            StatusBadge(text: "修正申請中", color: Theme.warning)
        } else if summary.status == .missingPunch {
            StatusBadge(text: "退勤漏れ", color: .red)
        } else if summary.status == .working {
            StatusBadge(text: "勤務中", color: Theme.clockInColor)
        }
    }

    /// 2行目：その日の日報（訪問先・現場名 ／ 作業内容の1行目）
    @ViewBuilder private var remark: some View {
        if let report {
            Button(action: onOpenReport) {
                Text((report.status == .draft ? "（下書き）" : "") + (report.summaryLine.isEmpty ? "内容なし" : report.summaryLine))
                    .font(.caption)
                    .foregroundStyle(.secondary)
                    .lineLimit(1)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .buttonStyle(.plain)
        } else if !summary.sessions.isEmpty {
            Button(action: onOpenReport) {
                Text("日報未提出")
                    .font(.caption.weight(.semibold))
                    .foregroundStyle(Theme.warning)
            }
            .buttonStyle(.plain)
        }
    }
}
