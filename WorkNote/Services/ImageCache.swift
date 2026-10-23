import Foundation
import FirebaseStorage

/// Cloud Storage の画像を端末に置いておく場所。送信待ちの画像もここに保存する。
enum ImageCache {
    static let directory: URL = {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
        return base.appendingPathComponent("ImageCache", isDirectory: true)
    }()

    static func fileURL(for storagePath: String) -> URL {
        directory.appendingPathComponent(storagePath)
    }

    static func store(_ data: Data, for storagePath: String) throws {
        let url = fileURL(for: storagePath)
        try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
        try data.write(to: url, options: .atomic)
    }

    static func localData(for storagePath: String) -> Data? {
        try? Data(contentsOf: fileURL(for: storagePath))
    }

    /// 端末になければ Cloud Storage から取ってくる
    static func data(for storagePath: String) async throws -> Data {
        if let data = localData(for: storagePath) { return data }
        let data = try await Storage.storage().reference(withPath: storagePath).data(maxSize: 30 * 1024 * 1024)
        try? store(data, for: storagePath)
        return data
    }
}
