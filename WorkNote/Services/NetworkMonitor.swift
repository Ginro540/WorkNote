import Foundation
import Network
import Observation

/// 電波の状態。つながったら画像の送信を再開する。
@Observable @MainActor
final class NetworkMonitor {
    static let shared = NetworkMonitor()

    private(set) var isOnline = true
    @ObservationIgnored private let monitor = NWPathMonitor()

    private init() {
        monitor.pathUpdateHandler = { [weak self] path in
            let online = path.status == .satisfied
            Task { @MainActor in
                guard let self else { return }
                let cameOnline = online && !self.isOnline
                self.isOnline = online
                if cameOnline { UploadQueue.shared.run() }
            }
        }
        monitor.start(queue: DispatchQueue(label: "NetworkMonitor"))
    }
}
