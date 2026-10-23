import SwiftUI
import WorkNoteCore

/// 白い角丸のカード
struct Card<Content: View>: View {
    var padding: CGFloat = 16
    @ViewBuilder var content: Content

    var body: some View {
        VStack(alignment: .leading, spacing: 12) { content }
            .padding(padding)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Color(.secondarySystemGroupedBackground), in: RoundedRectangle(cornerRadius: Theme.cardRadius, style: .continuous))
    }
}

/// 状態の札（下書き・提出済みなど）
struct StatusBadge: View {
    let text: String
    var color: Color = Theme.accent

    var body: some View {
        Text(text)
            .font(.caption.weight(.semibold))
            .foregroundStyle(color)
            .padding(.horizontal, 8)
            .padding(.vertical, 3)
            .background(color.opacity(0.14), in: Capsule())
    }
}

extension ReportStatus {
    var color: Color {
        switch self {
        case .draft: .gray
        case .submitted: Theme.accent
        case .approved: .green
        }
    }
}

extension ExpenseStatus {
    var color: Color {
        switch self {
        case .draft: .gray
        case .submitted: Theme.accent
        case .approved: .green
        case .returned: Theme.warning
        }
    }
}

extension CorrectionStatus {
    var color: Color {
        switch self {
        case .pending: Theme.warning
        case .approved: .green
        case .rejected: .red
        case .cancelled: .gray
        }
    }
}

/// 「必須」の札
struct RequiredBadge: View {
    var body: some View {
        Text("必須")
            .font(.caption2.weight(.bold))
            .foregroundStyle(.red)
            .padding(.horizontal, 6)
            .padding(.vertical, 2)
            .background(Color.red.opacity(0.1), in: RoundedRectangle(cornerRadius: 5))
    }
}

/// まだクラウドに送っていない印
struct UnsentMark: View {
    var body: some View {
        Label("未送信", systemImage: "icloud.slash")
            .font(.caption2)
            .foregroundStyle(.secondary)
    }
}

/// オフラインのお知らせ
struct OfflineBanner: View {
    @Environment(NetworkMonitor.self) private var network
    @Environment(UploadQueue.self) private var uploads

    var body: some View {
        if !network.isOnline {
            Label("オフラインです。入力した内容は端末に保存し、つながったら自動で送信します。", systemImage: "wifi.slash")
                .font(.footnote)
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(12)
                .background(Color.orange.opacity(0.12), in: RoundedRectangle(cornerRadius: 14))
        } else if !uploads.pendingPaths.isEmpty && !uploads.isEnabled {
            Label("写真・領収書の画像はこの iPhone に保存しています（クラウドへの保存は準備中）", systemImage: "iphone")
                .font(.footnote)
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, alignment: .leading)
        } else if !uploads.pendingPaths.isEmpty {
            Label("画像を送信中（残り\(uploads.pendingPaths.count)枚）", systemImage: "arrow.up.circle")
                .font(.footnote)
                .foregroundStyle(.secondary)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }
}

/// Cloud Storage の画像（端末にあればそれを使う）
struct StorageImage: View {
    let path: String
    var contentMode: ContentMode = .fill

    @State private var image: UIImage?
    @State private var failed = false

    var body: some View {
        ZStack {
            if let image {
                Image(uiImage: image).resizable().aspectRatio(contentMode: contentMode)
            } else if failed {
                Image(systemName: "photo").foregroundStyle(.secondary)
            } else {
                ProgressView()
            }
        }
        .task(id: path) {
            do {
                let data = try await ImageCache.data(for: path)
                image = UIImage(data: data)
            } catch {
                failed = true
            }
        }
    }
}

/// 画像を全画面で拡大して見る
struct ZoomableImageView: View {
    let image: UIImage
    @Environment(\.dismiss) private var dismiss
    @State private var scale: CGFloat = 1
    @State private var lastScale: CGFloat = 1
    @State private var offset: CGSize = .zero
    @State private var lastOffset: CGSize = .zero

    var body: some View {
        NavigationStack {
            Image(uiImage: image)
                .resizable()
                .scaledToFit()
                .scaleEffect(scale)
                .offset(offset)
                .gesture(
                    MagnifyGesture()
                        .onChanged { scale = max(1, lastScale * $0.magnification) }
                        .onEnded { _ in lastScale = scale }
                        .simultaneously(with: DragGesture()
                            .onChanged { offset = CGSize(width: lastOffset.width + $0.translation.width, height: lastOffset.height + $0.translation.height) }
                            .onEnded { _ in lastOffset = offset })
                )
                .onTapGesture(count: 2) {
                    withAnimation {
                        scale = 1; lastScale = 1; offset = .zero; lastOffset = .zero
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(Color.black)
                .toolbar {
                    ToolbarItem(placement: .topBarLeading) {
                        Button("閉じる") { dismiss() }
                    }
                }
                .toolbarBackground(.black, for: .navigationBar)
                .toolbarColorScheme(.dark, for: .navigationBar)
        }
    }
}

/// Cloud Storage の画像を拡大表示する
struct StorageZoomView: View {
    let path: String
    @State private var image: UIImage?

    var body: some View {
        Group {
            if let image {
                ZoomableImageView(image: image)
            } else {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity).background(Color.black)
            }
        }
        .task {
            if let data = try? await ImageCache.data(for: path) { image = UIImage(data: data) }
        }
    }
}

extension String: @retroactive Identifiable {
    public var id: String { self }
}

extension View {
    /// エラーをアラートで出す
    func errorAlert(_ message: Binding<String?>) -> some View {
        alert("確認してください", isPresented: Binding(get: { message.wrappedValue != nil }, set: { if !$0 { message.wrappedValue = nil } })) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(message.wrappedValue ?? "")
        }
    }
}

extension Int {
    /// ¥11,080
    var yen: String {
        "¥" + formatted(.number.grouping(.automatic).locale(Locale(identifier: "ja_JP")))
    }
}
