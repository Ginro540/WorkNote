import SwiftUI

/// 設定：名前・メールアドレス・権限、ログアウト、アプリのバージョン
struct SettingsView: View {
    @Environment(AuthService.self) private var auth
    @Environment(AppSession.self) private var session
    @Environment(UploadQueue.self) private var uploads
    @State private var confirmsLogout = false

    private var version: String {
        Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "-"
    }

    var body: some View {
        List {
            Section("アカウント") {
                LabeledContent("名前", value: auth.displayName)
                LabeledContent("メールアドレス", value: auth.profile?.email ?? auth.email ?? "")
                LabeledContent("権限", value: auth.profile?.roleLabel ?? "従業員")
            }

            Section {
                Button("ログアウト", role: .destructive) { confirmsLogout = true }
            } footer: {
                if !uploads.pendingPaths.isEmpty && !uploads.isEnabled {
                    Text("写真・領収書の画像\(uploads.pendingPaths.count)枚はこの iPhone にだけ保存されています。ログアウトしても消えませんが、アプリを削除すると消えます。")
                } else if !uploads.pendingPaths.isEmpty {
                    Text("送信待ちの画像が\(uploads.pendingPaths.count)枚あります。電波のあるところで送信が終わってからログアウトしてください。")
                }
            }

            Section {
                LabeledContent("バージョン", value: version)
            }
        }
        .navigationTitle("設定")
        .confirmationDialog("ログアウトしますか？", isPresented: $confirmsLogout, titleVisibility: .visible) {
            Button("ログアウト", role: .destructive) {
                session.stop()
                auth.signOut()
            }
        }
    }
}
