import SwiftUI
import MapKit
import WorkNoteCore

/// 日ごとの詳細：勤務ごとの出勤・退勤の時刻と場所、地図。集計と、その日の日報へのリンク
struct DayDetailView: View {
    let date: Date

    @Environment(AttendanceStore.self) private var store
    @Environment(SettingsStore.self) private var settings
    @Environment(ReportStore.self) private var reports

    @State private var data = PunchListener()
    @State private var showsCorrection = false
    @State private var editingReport: EditingReport?

    private var dayKey: String { WorkCalendar.dayKey(date) }

    var body: some View {
        let summary = store.summary(for: dayKey, punches: data.punches)
        let corrections = store.corrections(on: dayKey)
        let monthKey = settings.period.monthKey(for: date)
        let canRequest = settings.canRequestCorrection(monthKey: monthKey) && date <= Date()

        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                if let holiday = settings.holiday(on: dayKey) {
                    Label(holiday.name, systemImage: "flag.fill")
                        .font(.subheadline)
                        .foregroundStyle(Theme.holiday)
                }

                if data.isLoaded && summary.sessions.isEmpty {
                    Card {
                        Text("この日の打刻はありません").foregroundStyle(.secondary)
                    }
                }

                ForEach(Array(summary.sessions.enumerated()), id: \.offset) { index, session in
                    VStack(alignment: .leading, spacing: 8) {
                        Text("\(index + 1)回目の勤務")
                            .font(.headline)
                            .foregroundStyle(.secondary)
                            .padding(.leading, 4)
                        sessionCard(session, isWorking: summary.status == .working && index == summary.sessions.count - 1)
                    }
                }

                if !summary.sessions.isEmpty {
                    summaryCard(summary)
                }

                reportLink

                correctionSection(corrections: corrections, canRequest: canRequest, monthKey: monthKey)
            }
            .padding(16)
        }
        .background(Color(.systemGroupedBackground))
        .navigationTitle(WorkCalendar.shortDayLabel(date))
        .navigationBarTitleDisplayMode(.inline)
        .onAppear { data.load(uid: store.uid, field: "workDate", value: dayKey) }
        .onDisappear { data.stop() }
        .sheet(isPresented: $showsCorrection) {
            CorrectionRequestView(date: date, punches: data.punches, summary: summary)
        }
        .sheet(item: $editingReport) { editing in
            ReportEditorView(reportId: editing.reportId, existing: editing.report, initialDate: editing.date)
        }
    }

    private func punches(of session: WorkSession) -> [AttendancePunch] {
        let ids = [session.clockIn?.id, session.clockOut?.id].compactMap { $0 }
        return data.punches.filter { ids.contains($0.id ?? "") }
    }

    private func sessionCard(_ session: WorkSession, isWorking: Bool) -> some View {
        let list = punches(of: session)
        return VStack(alignment: .leading, spacing: 0) {
            VStack(alignment: .leading, spacing: 14) {
                if session.clockIn == nil {
                    Label("出勤の打刻がありません", systemImage: "exclamationmark.triangle.fill")
                        .font(.subheadline).foregroundStyle(.red)
                }
                ForEach(list) { punch in
                    PunchRow(punch: punch)
                    if punch.id != list.last?.id { Divider() }
                }
                if session.clockOut == nil {
                    if isWorking {
                        Label("勤務中", systemImage: "clock").font(.subheadline).foregroundStyle(Theme.clockInColor)
                    } else {
                        Label("退勤の打刻がありません（退勤漏れ）", systemImage: "exclamationmark.triangle.fill")
                            .font(.subheadline).foregroundStyle(Theme.warning)
                    }
                }
            }
            .padding(16)

            let markers = list.compactMap(PunchMarker.init)
            if !markers.isEmpty {
                Map(initialPosition: .region(region(for: markers))) {
                    ForEach(markers) { marker in
                        Marker(marker.title, systemImage: marker.icon, coordinate: marker.coordinate)
                            .tint(marker.color)
                    }
                }
                .frame(height: 220)
            }
        }
        .background(Color(.secondarySystemGroupedBackground))
        .clipShape(RoundedRectangle(cornerRadius: Theme.cardRadius, style: .continuous))
    }

    private func region(for markers: [PunchMarker]) -> MKCoordinateRegion {
        let lats = markers.map(\.coordinate.latitude), lngs = markers.map(\.coordinate.longitude)
        let center = CLLocationCoordinate2D(latitude: (lats.min()! + lats.max()!) / 2, longitude: (lngs.min()! + lngs.max()!) / 2)
        let span = MKCoordinateSpan(latitudeDelta: max(0.004, (lats.max()! - lats.min()!) * 1.6),
                                    longitudeDelta: max(0.004, (lngs.max()! - lngs.min()!) * 1.6))
        return MKCoordinateRegion(center: center, span: span)
    }

    private func summaryCard(_ summary: DaySummary) -> some View {
        Card {
            Text("集計").font(.headline)
            if summary.workMinutes == nil {
                Text(summary.status == .working ? "勤務が終わると集計します" : "打刻漏れがあるため集計できません。修正申請をしてください。")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            } else {
                row("拘束時間", summary.spanMinutes)
                row("中抜け", summary.gapMinutes)
                row(store.approvedBreakOverride(on: dayKey) != nil ? "休憩（修正済み）" : "休憩（自動）", summary.deductedBreakMinutes)
                Divider()
                HStack {
                    Text("実働").font(.headline)
                    Spacer()
                    Text(WorkCalendar.durationLabel(minutes: summary.workMinutes ?? 0))
                        .font(.title2.weight(.bold)).monospacedDigit()
                }
                if let overtime = summary.overtimeMinutes, overtime > 0 {
                    row("時間外", overtime, color: Theme.warning)
                }
            }
        }
    }

    private func row(_ title: String, _ minutes: Int?, color: Color = .primary) -> some View {
        HStack {
            Text(title).foregroundStyle(.secondary)
            Spacer()
            Text(minutes.map(WorkCalendar.durationLabel) ?? "—").monospacedDigit().foregroundStyle(color)
        }
        .font(.subheadline)
    }

    private var reportLink: some View {
        let report = reports.report(on: dayKey)
        return Button {
            if let report, let id = report.id {
                editingReport = EditingReport(reportId: id, report: report, date: date)
            } else {
                editingReport = EditingReport(reportId: reports.reportId(for: date), report: nil, date: date)
            }
        } label: {
            HStack(spacing: 12) {
                Image(systemName: "doc.text.fill")
                    .foregroundStyle(.white)
                    .frame(width: 36, height: 36)
                    .background(Theme.report, in: RoundedRectangle(cornerRadius: 10))
                VStack(alignment: .leading, spacing: 2) {
                    HStack {
                        Text("この日の日報").font(.subheadline.weight(.bold))
                        if let report { StatusBadge(text: report.status.label, color: report.status.color) }
                    }
                    Text(report.map { $0.summaryLine.isEmpty ? "内容なし" : $0.summaryLine } ?? "日報未提出")
                        .font(.caption)
                        .foregroundStyle(report == nil ? Theme.warning : .secondary)
                        .lineLimit(1)
                }
                Spacer()
                Image(systemName: "chevron.right").foregroundStyle(.tertiary)
            }
            .padding(14)
            .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: Theme.cardRadius, style: .continuous))
        }
        .buttonStyle(.plain)
    }

    @ViewBuilder
    private func correctionSection(corrections: [AttendanceCorrection], canRequest: Bool, monthKey: String) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("修正申請").font(.headline).foregroundStyle(.secondary).padding(.leading, 4)
            ForEach(corrections) { correction in
                CorrectionCard(correction: correction)
            }
            if canRequest {
                Button {
                    showsCorrection = true
                } label: {
                    Label("修正を申請する", systemImage: "square.and.pencil")
                        .frame(maxWidth: .infinity, minHeight: 48)
                }
                .buttonStyle(.bordered)
                .buttonBorderShape(.capsule)
            } else if date <= Date() {
                Text("この月の修正申請の期限を過ぎています。修正が必要なときは管理者に連絡してください。")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
        }
    }
}

/// 地図に出す打刻場所
private struct PunchMarker: Identifiable {
    let id: String
    let title: String
    let icon: String
    let color: Color
    let coordinate: CLLocationCoordinate2D

    init?(_ punch: AttendancePunch) {
        guard let loc = punch.location else { return nil }
        id = punch.id ?? UUID().uuidString
        title = "\(punch.kind.label) \(WorkCalendar.timeLabel(punch.punchedAt))"
        icon = punch.kind == .clockIn ? "sunrise.fill" : "sunset.fill"
        color = punch.kind == .clockIn ? Theme.clockInColor : Theme.clockOutColor
        coordinate = CLLocationCoordinate2D(latitude: loc.lat, longitude: loc.lng)
    }
}
