import Foundation
import Observation

/// ログイン中のユーザーのデータ。ログアウトでまとめて止める。
@Observable @MainActor
final class AppSession {
    let uid: String
    let settings: SettingsStore
    let location: LocationService
    let attendance: AttendanceStore
    let reports: ReportStore
    let expenses: ExpenseStore

    init(uid: String) {
        self.uid = uid
        settings = SettingsStore()
        location = LocationService()
        attendance = AttendanceStore(uid: uid, settings: settings, location: location)
        reports = ReportStore(uid: uid, settings: settings)
        expenses = ExpenseStore(uid: uid, settings: settings)
    }

    func start() {
        settings.start()
        attendance.start()
        reports.start()
        expenses.start()
        UploadQueue.shared.run()
    }

    func stop() {
        attendance.stop()
        reports.stop()
        expenses.stop()
        settings.stop()
    }
}
