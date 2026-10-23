import Foundation
import Observation
import FirebaseAuth
import FirebaseFirestore

/// ログイン状態。一度ログインすれば Firebase が端末に保存し、次からは自動でログイン状態になる。
@Observable @MainActor
final class AuthService {
    private(set) var uid: String?
    private(set) var email: String?
    private(set) var profile: AppUser?
    private(set) var isReady = false

    @ObservationIgnored private var authHandle: AuthStateDidChangeListenerHandle?
    @ObservationIgnored private var profileListener: ListenerRegistration?

    init() {
        authHandle = Auth.auth().addStateDidChangeListener { [weak self] _, user in
            // Firebase はメインスレッドで呼ぶ
            MainActor.assumeIsolated { self?.apply(user) }
        }
    }

    private func apply(_ user: User?) {
        profileListener?.remove()
        profileListener = nil
        uid = user?.uid
        email = user?.email
        profile = nil
        isReady = true
        guard let user else { return }
        profileListener = Firestore.firestore().collection("users").document(user.uid)
            .listen(AppUser.self) { [weak self] profile in
                self?.profile = profile
            }
    }

    var displayName: String {
        profile?.displayName ?? Auth.auth().currentUser?.displayName ?? ""
    }

    func signIn(email: String, password: String) async throws {
        do {
            try await Auth.auth().signIn(withEmail: email, password: password)
        } catch {
            throw AuthMessageError(error)
        }
    }

    func sendPasswordReset(email: String) async throws {
        do {
            Auth.auth().languageCode = "ja"
            try await Auth.auth().sendPasswordReset(withEmail: email)
        } catch {
            throw AuthMessageError(error)
        }
    }

    func signOut() {
        profileListener?.remove()
        profileListener = nil
        try? Auth.auth().signOut()
    }
}

/// Firebase Authentication のエラーを日本語にする
struct AuthMessageError: LocalizedError {
    let message: String

    init(_ error: Error) {
        let code = AuthErrorCode(rawValue: (error as NSError).code)
        switch code {
        case .invalidEmail:
            message = "メールアドレスの形式が正しくありません。"
        case .wrongPassword, .invalidCredential, .userNotFound:
            message = "メールアドレスまたはパスワードが違います。"
        case .userDisabled:
            message = "このアカウントは利用できません。管理者に確認してください。"
        case .tooManyRequests:
            message = "試行回数が多すぎます。しばらくしてからもう一度お試しください。"
        case .networkError:
            message = "通信できません。電波の良いところでもう一度お試しください。"
        default:
            message = error.localizedDescription
        }
    }

    var errorDescription: String? { message }
}
