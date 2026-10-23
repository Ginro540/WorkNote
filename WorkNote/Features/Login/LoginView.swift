import SwiftUI

/// ログイン：会社から発行されたメールアドレスとパスワード。アプリからの新規登録はできない。
struct LoginView: View {
    @Environment(AuthService.self) private var auth

    @State private var email = ""
    @State private var password = ""
    @State private var showsPassword = false
    @State private var isSigningIn = false
    @State private var errorMessage: String?
    @State private var showsReset = false
    @FocusState private var focus: Field?

    private enum Field { case email, password }

    private var canSignIn: Bool {
        !email.trimmingCharacters(in: .whitespaces).isEmpty && !password.isEmpty && !isSigningIn
    }

    var body: some View {
        ZStack {
            Theme.login.ignoresSafeArea()

            ScrollView {
                VStack(spacing: 28) {
                    VStack(spacing: 14) {
                        ZStack {
                            RoundedRectangle(cornerRadius: 26, style: .continuous)
                                .fill(.white.opacity(0.22))
                                .overlay(RoundedRectangle(cornerRadius: 26, style: .continuous).stroke(.white.opacity(0.4)))
                                .frame(width: 92, height: 92)
                            Image(systemName: "clock.badge.checkmark.fill")
                                .font(.system(size: 44))
                                .symbolRenderingMode(.palette)
                                .foregroundStyle(.white, .white.opacity(0.8))
                        }
                        Text("ワークノート")
                            .font(.system(size: 36, weight: .heavy))
                            .foregroundStyle(.white)
                        Text("勤怠・日報・経費を、これひとつで")
                            .font(.subheadline)
                            .foregroundStyle(.white.opacity(0.9))
                    }
                    .padding(.top, 70)

                    VStack(spacing: 16) {
                        inputRow(icon: "envelope.fill") {
                            TextField("メールアドレス", text: $email)
                                .textContentType(.username)
                                .keyboardType(.emailAddress)
                                .textInputAutocapitalization(.never)
                                .autocorrectionDisabled()
                                .focused($focus, equals: .email)
                                .submitLabel(.next)
                                .onSubmit { focus = .password }
                        }
                        inputRow(icon: "lock.fill") {
                            Group {
                                if showsPassword {
                                    TextField("パスワード", text: $password)
                                        .textInputAutocapitalization(.never)
                                        .autocorrectionDisabled()
                                } else {
                                    SecureField("パスワード", text: $password)
                                }
                            }
                            .textContentType(.password)
                            .focused($focus, equals: .password)
                            .submitLabel(.go)
                            .onSubmit(signIn)
                            Button {
                                showsPassword.toggle()
                            } label: {
                                Image(systemName: showsPassword ? "eye.slash" : "eye")
                                    .foregroundStyle(Theme.accent.opacity(0.7))
                            }
                            .accessibilityLabel(showsPassword ? "パスワードを隠す" : "パスワードを表示")
                        }

                        Button(action: signIn) {
                            ZStack {
                                if isSigningIn {
                                    ProgressView().tint(.white)
                                } else {
                                    Text("ログイン").font(.headline)
                                }
                            }
                            .frame(maxWidth: .infinity, minHeight: 56)
                            .foregroundStyle(.white)
                            .background(Theme.clockIn.opacity(canSignIn ? 1 : 0.35), in: Capsule())
                        }
                        .disabled(!canSignIn)

                        Button("パスワードを忘れた場合") { showsReset = true }
                            .font(.subheadline.weight(.semibold))
                            .foregroundStyle(Color(hex: 0x5B45C9))
                    }
                    .padding(24)
                    .background(.white, in: RoundedRectangle(cornerRadius: 32, style: .continuous))
                    .shadow(color: .black.opacity(0.12), radius: 20, y: 10)
                    .padding(.horizontal, 24)

                    Text("アカウントは会社から発行されます")
                        .font(.footnote)
                        .foregroundStyle(.white.opacity(0.85))
                }
                .padding(.bottom, 40)
            }
            .scrollDismissesKeyboard(.interactively)
        }
        .errorAlert($errorMessage)
        .sheet(isPresented: $showsReset) {
            PasswordResetView(email: email)
                .presentationDetents([.medium])
        }
    }

    private func inputRow<Content: View>(icon: String, @ViewBuilder content: () -> Content) -> some View {
        HStack(spacing: 12) {
            Image(systemName: icon)
                .foregroundStyle(Theme.accent)
                .frame(width: 24)
            content()
        }
        .padding(.horizontal, 18)
        .frame(height: 58)
        .background(Color(.systemGray6), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .colorScheme(.light)
    }

    private func signIn() {
        guard canSignIn else { return }
        isSigningIn = true
        focus = nil
        Task {
            defer { isSigningIn = false }
            do {
                try await auth.signIn(email: email.trimmingCharacters(in: .whitespaces), password: password)
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }
}

/// パスワードの再設定メールを送る
private struct PasswordResetView: View {
    @Environment(AuthService.self) private var auth
    @Environment(\.dismiss) private var dismiss
    @State var email: String
    @State private var isSending = false
    @State private var sent = false
    @State private var errorMessage: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("メールアドレス", text: $email)
                        .keyboardType(.emailAddress)
                        .textContentType(.username)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                } footer: {
                    Text(sent
                         ? "再設定のメールを送りました。メールに書かれた手順でパスワードを設定し直してください。"
                         : "入力したメールアドレスに、パスワードを設定し直すためのメールを送ります。")
                }
                Section {
                    Button {
                        isSending = true
                        Task {
                            defer { isSending = false }
                            do {
                                try await auth.sendPasswordReset(email: email.trimmingCharacters(in: .whitespaces))
                                sent = true
                            } catch {
                                errorMessage = error.localizedDescription
                            }
                        }
                    } label: {
                        HStack {
                            Text(sent ? "もう一度送る" : "再設定メールを送る")
                            if isSending { Spacer(); ProgressView() }
                        }
                    }
                    .disabled(email.trimmingCharacters(in: .whitespaces).isEmpty || isSending)
                }
            }
            .navigationTitle("パスワードの再設定")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("閉じる") { dismiss() }
                }
            }
            .errorAlert($errorMessage)
        }
    }
}
