import SwiftUI
import WorkNoteCore

/// 打刻の修正申請：対象の日と勤務を選び、正しい内容と理由を入力する
struct CorrectionRequestView: View {
    let date: Date
    let punches: [AttendancePunch]
    let summary: DaySummary

    @Environment(AttendanceStore.self) private var store
    @Environment(SettingsStore.self) private var settings
    @Environment(\.dismiss) private var dismiss

    @State private var kind: CorrectionKind = .missingClockOut
    @State private var sessionIndex = 0
    @State private var clockIn: Date
    @State private var clockOut: Date
    @State private var breakMinutes = 0
    @State private var reason = ""
    @State private var errorMessage: String?

    init(date: Date, punches: [AttendancePunch], summary: DaySummary) {
        self.date = date
        self.punches = punches
        self.summary = summary
        let last = summary.sessions.last
        _clockIn = State(initialValue: last?.clockIn?.time ?? WorkCalendar.calendar.date(bySettingHour: 9, minute: 0, second: 0, of: date)!)
        _clockOut = State(initialValue: last?.clockOut?.time ?? WorkCalendar.calendar.date(bySettingHour: 18, minute: 0, second: 0, of: date)!)
        _sessionIndex = State(initialValue: max(0, summary.sessions.count - 1))
        if summary.sessions.contains(where: { $0.clockIn == nil }) {
            _kind = State(initialValue: .missingClockIn)
        } else if summary.sessions.contains(where: { $0.clockOut == nil }) {
            _kind = State(initialValue: .missingClockOut)
        } else if !summary.sessions.isEmpty {
            _kind = State(initialValue: .wrongTime)
        } else {
            _kind = State(initialValue: .missingClockIn)
        }
    }

    /// 選べる時刻の範囲（日付をまたぐ勤務のため翌日まで）
    private var timeRange: ClosedRange<Date> {
        let start = WorkCalendar.startOfDay(date)
        return start...WorkCalendar.addDays(2, to: start).addingTimeInterval(-60)
    }

    private var needsSession: Bool {
        kind != .noBreak && !summary.sessions.isEmpty
    }

    private var selectedSession: WorkSession? {
        summary.sessions.indices.contains(sessionIndex) ? summary.sessions[sessionIndex] : nil
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    LabeledContent("対象の日", value: WorkCalendar.shortDayLabel(date))
                    Picker("申請の種類", selection: $kind) {
                        ForEach(CorrectionKind.allCases) { Text($0.label).tag($0) }
                    }
                }

                if needsSession {
                    Section("対象の勤務") {
                        Picker("勤務", selection: $sessionIndex) {
                            ForEach(summary.sessions.indices, id: \.self) { i in
                                Text("\(i + 1)回目（\(label(summary.sessions[i]))）").tag(i)
                            }
                            if kind == .missingClockIn {
                                Text("新しい勤務（中抜け後の再出勤など）").tag(summary.sessions.count)
                            }
                        }
                        .pickerStyle(.inline)
                        .labelsHidden()
                    }
                }

                Section("正しい内容") {
                    switch kind {
                    case .missingClockIn:
                        DatePicker("出勤時刻", selection: $clockIn, in: timeRange)
                        if selectedSession == nil || selectedSession?.clockOut == nil {
                            DatePicker("退勤時刻", selection: $clockOut, in: timeRange)
                        }
                    case .missingClockOut:
                        DatePicker("退勤時刻", selection: $clockOut, in: timeRange)
                    case .wrongTime:
                        DatePicker("出勤時刻", selection: $clockIn, in: timeRange)
                        DatePicker("退勤時刻", selection: $clockOut, in: timeRange)
                    case .noBreak:
                        Stepper(value: $breakMinutes, in: 0...180, step: 5) {
                            LabeledContent("実際に取った休憩", value: "\(breakMinutes)分")
                        }
                    }
                }

                Section {
                    TextField("理由（必須）", text: $reason, axis: .vertical)
                        .lineLimit(3...6)
                } header: {
                    Text("理由")
                } footer: {
                    if let deadline = settings.correctionDeadline(monthKey: settings.period.monthKey(for: date)) {
                        Text("管理者が承認すると勤怠に反映されます。承認されるまでは元の記録のままです。申請の期限は \(WorkCalendar.shortDayLabel(deadline)) までです。")
                    }
                }
            }
            .navigationTitle("修正申請")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("キャンセル") { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button("申請", action: submit)
                        .disabled(reason.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
            .errorAlert($errorMessage)
            .onChange(of: sessionIndex) { _, i in
                guard summary.sessions.indices.contains(i) else { return }
                if let t = summary.sessions[i].clockIn?.time { clockIn = t }
                if let t = summary.sessions[i].clockOut?.time { clockOut = t }
            }
        }
    }

    private func label(_ session: WorkSession) -> String {
        let i = session.clockIn.map { WorkCalendar.timeLabel($0.time) } ?? "--:--"
        let o = session.clockOut.map { WorkCalendar.timeLabel($0.time) } ?? "--:--"
        return "\(i)〜\(o)"
    }

    private func submit() {
        let monthKey = settings.period.monthKey(for: date)
        guard settings.canRequestCorrection(monthKey: monthKey) else {
            errorMessage = "この月の修正申請の期限を過ぎています。管理者に連絡してください。"
            return
        }
        var requestedIn: Date?
        var requestedOut: Date?
        var requestedBreak: Int?
        switch kind {
        case .missingClockIn:
            requestedIn = clockIn
            if selectedSession == nil || selectedSession?.clockOut == nil { requestedOut = clockOut }
        case .missingClockOut:
            requestedOut = clockOut
        case .wrongTime:
            requestedIn = clockIn
            requestedOut = clockOut
        case .noBreak:
            requestedBreak = breakMinutes
        }
        if let i = requestedIn, let o = requestedOut, o <= i {
            errorMessage = "退勤時刻は出勤時刻より後にしてください。"
            return
        }
        let targets: [String] = needsSession
            ? [selectedSession?.clockIn?.id, selectedSession?.clockOut?.id].compactMap { $0 }
            : []
        let correction = AttendanceCorrection(
            userId: store.uid,
            workDate: WorkCalendar.dayKey(date),
            month: monthKey,
            targetPunchIds: targets,
            kind: kind,
            requestedClockIn: requestedIn,
            requestedClockOut: requestedOut,
            requestedBreakMinutes: requestedBreak,
            reason: reason.trimmingCharacters(in: .whitespacesAndNewlines),
            status: .pending,
            createdAt: Date()
        )
        do {
            try store.submitCorrection(correction)
            dismiss()
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

/// 修正申請1件
struct CorrectionCard: View {
    let correction: AttendanceCorrection
    var showsDate = false

    @Environment(AttendanceStore.self) private var store
    @State private var confirmsCancel = false

    var body: some View {
        Card {
            HStack {
                if showsDate, let date = WorkCalendar.date(fromDayKey: correction.workDate) {
                    Text(WorkCalendar.shortDayLabel(date)).font(.subheadline.weight(.bold))
                }
                Text(correction.kind.label).font(.subheadline.weight(.semibold))
                Spacer()
                StatusBadge(text: correction.status.label, color: correction.status.color)
            }
            VStack(alignment: .leading, spacing: 4) {
                if let t = correction.requestedClockIn {
                    Text("出勤 \(t.formatted(.dateTime.month().day().hour().minute()))")
                }
                if let t = correction.requestedClockOut {
                    Text("退勤 \(t.formatted(.dateTime.month().day().hour().minute()))")
                }
                if let m = correction.requestedBreakMinutes {
                    Text("休憩 \(m)分")
                }
                Text("理由：\(correction.reason)").foregroundStyle(.secondary)
                Text("申請 \(correction.createdAt.formatted(.dateTime.month().day().hour().minute()))")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            .font(.subheadline)
            if correction.status == .pending {
                Button("申請を取り消す", role: .destructive) { confirmsCancel = true }
                    .font(.subheadline)
            }
        }
        .confirmationDialog("この修正申請を取り消しますか？", isPresented: $confirmsCancel, titleVisibility: .visible) {
            Button("申請を取り消す", role: .destructive) { store.cancelCorrection(correction) }
        }
    }
}

/// 修正申請の一覧（申請中の取り消し）
struct CorrectionListView: View {
    @Environment(AttendanceStore.self) private var store

    var body: some View {
        ScrollView {
            VStack(spacing: 12) {
                if store.corrections.isEmpty {
                    ContentUnavailableView("修正申請はありません", systemImage: "checkmark.circle",
                                           description: Text("月の勤怠で日付を選ぶと修正を申請できます。"))
                        .padding(.top, 60)
                }
                ForEach(store.corrections) { correction in
                    CorrectionCard(correction: correction, showsDate: true)
                }
            }
            .padding(16)
        }
        .background(Color(.systemGroupedBackground))
        .navigationTitle("修正申請")
        .navigationBarTitleDisplayMode(.inline)
    }
}
