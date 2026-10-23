import SwiftUI
import WorkNoteCore

/// 打刻（ホーム）：現在時刻と大きな出勤・退勤ボタン、今日の勤務
struct PunchHomeView: View {
    @Environment(AttendanceStore.self) private var store
    @Environment(LocationService.self) private var location
    @Environment(\.openURL) private var openURL

    var body: some View {
        ScrollView {
            VStack(spacing: 20) {
                OfflineBanner()

                TimelineView(.periodic(from: .now, by: 1)) { context in
                    header(now: context.date)
                }

                ForEach(store.missingPunchDays, id: \.self) { day in
                    missingPunchBanner(day)
                }

                if location.isDenied {
                    locationDeniedBanner
                }

                punchButton
                    .padding(.vertical, 8)

                TodayWorkCard(workDate: store.timelineWorkDate)
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 24)
        }
        .background(
            LinearGradient(colors: [Color(hex: 0xE3ECFF), Color(.systemGroupedBackground)], startPoint: .top, endPoint: .center)
                .ignoresSafeArea()
        )
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                NavigationLink {
                    MonthlyAttendanceView()
                } label: {
                    Label("月の勤怠", systemImage: "calendar")
                        .labelStyle(.titleAndIcon)
                }
            }
        }
        .overlay(alignment: .bottom) {
            if let pending = store.pendingPunch {
                undoToast(pending)
                    .padding(.horizontal, 20)
                    .padding(.bottom, 12)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .animation(.spring(duration: 0.3), value: store.pendingPunch?.id)
    }

    private func header(now: Date) -> some View {
        VStack(spacing: 6) {
            HStack {
                VStack(alignment: .leading, spacing: 6) {
                    Text(now, format: .dateTime.year().month().day().weekday(.wide).locale(Locale(identifier: "ja_JP")))
                        .font(.headline)
                        .foregroundStyle(.secondary)
                    StatusBadge(text: store.homeStatus.label, color: statusColor)
                }
                Spacer()
            }
            HStack(alignment: .lastTextBaseline, spacing: 4) {
                Text(WorkCalendar.timeLabel(now))
                    .font(.system(size: 76, weight: .bold, design: .rounded))
                    .monospacedDigit()
                Text(String(format: "%02d", WorkCalendar.calendar.component(.second, from: now)))
                    .font(.system(size: 28, weight: .semibold, design: .rounded))
                    .monospacedDigit()
                    .foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity)
        }
    }

    private var statusColor: Color {
        switch store.homeStatus {
        case .notStarted: .gray
        case .working: Theme.clockInColor
        case .finished: .green
        }
    }

    private var punchButton: some View {
        let isClockOut = store.nextKind == .clockOut
        return Button {
            UIImpactFeedbackGenerator(style: .medium).impactOccurred()
            store.tapPunch()
        } label: {
            ZStack {
                Circle()
                    .fill((isClockOut ? Theme.clockOutColor : Theme.clockInColor).opacity(0.15))
                    .frame(width: 290, height: 290)
                Circle()
                    .fill(isClockOut ? Theme.clockOut : Theme.clockIn)
                    .frame(width: 250, height: 250)
                    .shadow(color: (isClockOut ? Theme.clockOutColor : Theme.clockInColor).opacity(0.45), radius: 24, y: 12)
                Circle()
                    .stroke(.white.opacity(0.35), lineWidth: 1.5)
                    .frame(width: 228, height: 228)
                VStack(spacing: 10) {
                    Image(systemName: isClockOut ? "sunset.fill" : "sunrise.fill")
                        .font(.system(size: 38))
                    Text(store.buttonLabel)
                        .font(.system(size: 40, weight: .bold))
                    Text("タップで打刻")
                        .font(.footnote)
                        .opacity(0.85)
                }
                .foregroundStyle(.white)
            }
        }
        .buttonStyle(.plain)
        .accessibilityLabel("\(store.buttonLabel)を打刻")
    }

    private func undoToast(_ pending: AttendanceStore.PendingPunch) -> some View {
        HStack {
            Image(systemName: "checkmark.circle.fill")
                .foregroundStyle(pending.kind == .clockIn ? Theme.clockInColor : Theme.clockOutColor)
            Text("\(WorkCalendar.timeLabel(pending.time)) に\(pending.kind.label)しました")
                .font(.subheadline.weight(.semibold))
            Spacer()
            Button("取り消す") { store.undoPunch() }
                .font(.subheadline.weight(.bold))
        }
        .padding(16)
        .background(.regularMaterial, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .shadow(color: .black.opacity(0.12), radius: 12, y: 4)
    }

    private func missingPunchBanner(_ day: String) -> some View {
        NavigationLink {
            if let date = WorkCalendar.date(fromDayKey: day) {
                DayDetailView(date: date)
            }
        } label: {
            HStack(spacing: 12) {
                Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(Theme.warning)
                VStack(alignment: .leading, spacing: 2) {
                    Text("\(WorkCalendar.date(fromDayKey: day).map(WorkCalendar.shortDayLabel) ?? day) 退勤漏れ")
                        .font(.subheadline.weight(.bold))
                    Text("修正申請で正しい時刻を入れてください")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Image(systemName: "chevron.right").foregroundStyle(.tertiary)
            }
            .padding(14)
            .background(Theme.warning.opacity(0.12), in: RoundedRectangle(cornerRadius: 16))
        }
        .buttonStyle(.plain)
    }

    private var locationDeniedBanner: some View {
        Button {
            if let url = URL(string: UIApplication.openSettingsURLString) { openURL(url) }
        } label: {
            HStack(spacing: 12) {
                Image(systemName: "location.slash.fill").foregroundStyle(.secondary)
                VStack(alignment: .leading, spacing: 2) {
                    Text("位置情報がオフです").font(.subheadline.weight(.bold))
                    Text("打刻場所を記録するため、設定で「このAppの使用中のみ許可」にしてください")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.leading)
                }
                Spacer()
                Image(systemName: "chevron.right").foregroundStyle(.tertiary)
            }
            .padding(14)
            .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: 16))
        }
        .buttonStyle(.plain)
    }
}

/// 今日の勤務：打刻を点と線でつないで表示し、打刻場所の住所も出す
struct TodayWorkCard: View {
    @Environment(AttendanceStore.self) private var store
    let workDate: String

    var body: some View {
        let punches = store.punches(on: workDate)
        let summary = store.summary(for: workDate)
        Card(padding: 20) {
            HStack {
                Text(workDate == WorkCalendar.dayKey(Date()) ? "今日の勤務" : "勤務中（\(WorkCalendar.date(fromDayKey: workDate).map(WorkCalendar.shortDayLabel) ?? workDate)から）")
                    .font(.headline)
                Spacer()
            }
            if punches.isEmpty {
                Text("まだ打刻していません")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            } else {
                PunchTimeline(punches: punches, unsentIds: store.unsentPunchIds)
                if let work = summary.workMinutes {
                    Divider()
                    HStack(alignment: .lastTextBaseline) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text("実働").font(.caption).foregroundStyle(.secondary)
                            Text("休憩 \(WorkCalendar.durationLabel(minutes: summary.deductedBreakMinutes ?? 0)) を差し引き")
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                        }
                        Spacer()
                        Text(WorkCalendar.durationLabel(minutes: work))
                            .font(.system(size: 34, weight: .bold, design: .rounded))
                            .monospacedDigit()
                    }
                }
            }
        }
    }
}

/// 打刻の点と線
struct PunchTimeline: View {
    let punches: [AttendancePunch]
    var unsentIds: Set<String> = []

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            ForEach(Array(punches.enumerated()), id: \.offset) { index, punch in
                HStack(alignment: .top, spacing: 14) {
                    VStack(spacing: 0) {
                        Circle()
                            .fill(punch.kind == .clockIn ? Theme.clockInColor : Theme.clockOutColor)
                            .frame(width: 12, height: 12)
                            .padding(.top, 7)
                        if index < punches.count - 1 {
                            Rectangle().fill(Color(.systemGray4)).frame(width: 2).frame(maxHeight: .infinity)
                        }
                    }
                    .frame(width: 12)
                    PunchRow(punch: punch, isUnsent: punch.id.map { unsentIds.contains($0) } ?? false)
                        .padding(.bottom, 14)
                }
                .fixedSize(horizontal: false, vertical: true)
            }
        }
    }
}

/// 打刻1件（時刻・出勤/退勤・場所）
struct PunchRow: View {
    let punch: AttendancePunch
    var isUnsent = false

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(WorkCalendar.timeLabel(punch.punchedAt))
                    .font(.title2.weight(.bold))
                    .monospacedDigit()
                Text(punch.kind.label)
                    .foregroundStyle(.secondary)
                if punch.corrected {
                    StatusBadge(text: "修正済み", color: .purple)
                }
                if isUnsent { UnsentMark() }
            }
            Label(punch.locationLabel, systemImage: punch.location == nil ? "location.slash" : "location.fill")
                .font(.caption)
                .foregroundStyle(.secondary)
            if let delay = punch.locationDelayLabel {
                Text(delay).font(.caption2).foregroundStyle(.secondary)
            }
            if punch.corrected, let original = punch.originalPunchedAt {
                Text("元の打刻 \(WorkCalendar.timeLabel(original))")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
            }
            if punch.hasClockSkew, let received = punch.receivedAt {
                Text("サーバー受信 \(received.formatted(.dateTime.month().day().hour().minute()))")
                    .font(.caption2)
                    .foregroundStyle(Theme.warning)
            }
        }
    }
}
