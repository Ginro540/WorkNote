import SwiftUI

struct RootView: View {
    @State private var auth = AuthService()
    @State private var session: AppSession?
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        Group {
            if !auth.isReady {
                ProgressView()
            } else if let session {
                MainTabView()
                    .environment(session)
                    .environment(session.settings)
                    .environment(session.attendance)
                    .environment(session.reports)
                    .environment(session.expenses)
                    .environment(session.location)
                    .id(session.uid)
            } else {
                LoginView()
            }
        }
        .environment(auth)
        .environment(NetworkMonitor.shared)
        .environment(UploadQueue.shared)
        .tint(Theme.accent)
        .onChange(of: auth.uid, initial: true) { _, uid in
            session?.stop()
            session = nil
            if let uid {
                let newSession = AppSession(uid: uid)
                newSession.start()
                session = newSession
            }
        }
        .onChange(of: scenePhase) { _, phase in
            switch phase {
            case .background:
                // 取り消し待ちの打刻はアプリが裏に回る前に保存する
                session?.attendance.commitPendingNow()
            case .active:
                UploadQueue.shared.run()
            default:
                break
            }
        }
    }
}

struct MainTabView: View {
    enum TabID: Hashable { case attendance, reports, expenses, settings }

    @State private var selection: TabID = .attendance

    var body: some View {
        // ログイン後は「勤怠」タブが最初に開く
        TabView(selection: $selection) {
            Tab("勤怠", systemImage: "clock.fill", value: .attendance) {
                NavigationStack { PunchHomeView() }
            }
            Tab("日報", systemImage: "doc.text.fill", value: .reports) {
                NavigationStack { ReportListView() }
            }
            Tab("経費", systemImage: "yensign.circle.fill", value: .expenses) {
                NavigationStack { ExpenseListView() }
            }
            Tab("設定", systemImage: "gearshape.fill", value: .settings) {
                NavigationStack { SettingsView() }
            }
        }
    }
}
