import Foundation
import CoreLocation
import Observation

/// 打刻した瞬間の場所を取るための位置情報。勤務中に位置を追い続けることはしない。
@Observable @MainActor
final class LocationService: NSObject, CLLocationManagerDelegate {
    private(set) var authorizationStatus: CLAuthorizationStatus

    /// 新しい位置が届いたとき
    @ObservationIgnored var onLocation: ((CLLocation) -> Void)?
    /// 許可の状態が変わったとき
    @ObservationIgnored var onAuthorizationChange: (() -> Void)?

    @ObservationIgnored private let manager: CLLocationManager
    @ObservationIgnored private var isUpdating = false

    override init() {
        let manager = CLLocationManager()
        self.manager = manager
        authorizationStatus = manager.authorizationStatus
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyBest
    }

    var isDenied: Bool {
        authorizationStatus == .denied || authorizationStatus == .restricted
    }

    var isAuthorized: Bool {
        authorizationStatus == .authorizedWhenInUse || authorizationStatus == .authorizedAlways
    }

    /// 初めて打刻するときに「アプリの使用中のみ許可」を求める
    func requestAuthorizationIfNeeded() {
        if authorizationStatus == .notDetermined {
            manager.requestWhenInUseAuthorization()
        }
    }

    func start() {
        guard isAuthorized, !isUpdating else { return }
        isUpdating = true
        manager.startUpdatingLocation()
    }

    func stop() {
        guard isUpdating else { return }
        isUpdating = false
        manager.stopUpdatingLocation()
    }

    /// 緯度・経度から住所にする（電波がないと失敗する）
    static func address(for location: CLLocation) async -> String? {
        let placemarks = try? await CLGeocoder().reverseGeocodeLocation(location, preferredLocale: Locale(identifier: "ja_JP"))
        guard let p = placemarks?.first else { return nil }
        var parts: [String] = []
        for part in [p.administrativeArea, p.locality] {
            if let part, !part.isEmpty { parts.append(part) }
        }
        if let thoroughfare = p.thoroughfare, !thoroughfare.isEmpty {
            parts.append(thoroughfare)
        } else if let sub = p.subLocality, !sub.isEmpty {
            parts.append(sub)
        }
        if let sub = p.subThoroughfare, !sub.isEmpty { parts.append(sub) }
        let address = parts.joined()
        return address.isEmpty ? p.name : address
    }

    // MARK: - CLLocationManagerDelegate

    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        let status = manager.authorizationStatus
        Task { @MainActor in
            self.authorizationStatus = status
            self.onAuthorizationChange?()
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        Task { @MainActor in
            for location in locations { self.onLocation?(location) }
        }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        // 取れなかったときは次の更新を待つ（打刻から10分で「位置なし」にする）
        print("Location error: \(error)")
    }
}
