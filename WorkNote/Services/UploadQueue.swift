import Foundation
import Observation
import FirebaseAuth
import FirebaseStorage

/// 画像を裏で順番に Cloud Storage へ送る。電波がないときは端末に残し、つながったら再開する。
/// 送信待ちの一覧は UserDefaults に保存するので、アプリを終了しても消えない。
/// Cloud Storage を使えるようになるまで（settings/company.imageUploadEnabled が false の間）は送らずに端末に置いておく。
@Observable @MainActor
final class UploadQueue {
    static let shared = UploadQueue()

    private static let defaultsKey = "UploadQueue.pendingPaths"

    private(set) var pendingPaths: [String]
    private var isRunning = false

    /// Cloud Storage へ送るか。true になったら、たまっている画像を送り始める
    var isEnabled = false {
        didSet { if isEnabled && !oldValue { run() } }
    }

    private init() {
        pendingPaths = UserDefaults.standard.stringArray(forKey: Self.defaultsKey) ?? []
    }

    /// 画像を端末に保存して送信待ちに入れる
    func enqueue(_ data: Data, path: String) throws {
        try ImageCache.store(data, for: path)
        if !pendingPaths.contains(path) {
            pendingPaths.append(path)
            persist()
        }
        run()
    }

    func isPending(_ path: String) -> Bool {
        pendingPaths.contains(path)
    }

    func run() {
        guard isEnabled, !isRunning, let uid = Auth.auth().currentUser?.uid else { return }
        isRunning = true
        Task {
            defer { isRunning = false }
            var failed: [String] = []
            while let path = pendingPaths.first(where: { !failed.contains($0) }) {
                // 別のユーザーの送信待ちは、そのユーザーがログインしたときに送る
                guard path.split(separator: "/").dropFirst().first.map(String.init) == uid else {
                    failed.append(path)
                    continue
                }
                guard let data = ImageCache.localData(for: path) else {
                    remove(path)
                    continue
                }
                do {
                    let metadata = StorageMetadata()
                    metadata.contentType = "image/jpeg"
                    _ = try await Storage.storage().reference(withPath: path).putDataAsync(data, metadata: metadata)
                    remove(path)
                } catch {
                    let code = StorageErrorCode(rawValue: (error as NSError).code)
                    if code == .unauthorized || code == .unauthenticated {
                        print("Upload rejected \(path): \(error)")
                        failed.append(path)
                    } else {
                        // 電波がないなど。つながったときに再開する
                        print("Upload paused \(path): \(error)")
                        return
                    }
                }
            }
        }
    }

    private func remove(_ path: String) {
        pendingPaths.removeAll { $0 == path }
        persist()
    }

    private func persist() {
        UserDefaults.standard.set(pendingPaths, forKey: Self.defaultsKey)
    }
}
