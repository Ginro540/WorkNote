import SwiftUI
import FirebaseCore
import FirebaseFirestore

@main
struct WorkNoteApp: App {
    /// GoogleService-Info.plist がプロジェクトに入っているか
    private let isFirebaseConfigured: Bool

    init() {
        isFirebaseConfigured = Bundle.main.path(forResource: "GoogleService-Info", ofType: "plist") != nil
        guard isFirebaseConfigured else { return }
        FirebaseApp.configure()
        // 電波がなくても入力・保存でき、つながったら自動で送信する
        let settings = FirestoreSettings()
        settings.cacheSettings = PersistentCacheSettings(sizeBytes: NSNumber(value: 200 * 1024 * 1024))
        Firestore.firestore().settings = settings
    }

    var body: some Scene {
        WindowGroup {
            if isFirebaseConfigured {
                RootView()
            } else {
                SetupRequiredView()
            }
        }
    }
}

/// Firebase の設定ファイルがないとき
private struct SetupRequiredView: View {
    var body: some View {
        ContentUnavailableView {
            Label("Firebase の設定が必要です", systemImage: "gearshape.2")
        } description: {
            Text("Firebase コンソールからダウンロードした GoogleService-Info.plist を WorkNote フォルダに入れて、もう一度ビルドしてください。")
        }
    }
}
