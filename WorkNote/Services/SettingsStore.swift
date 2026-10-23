import Foundation
import Observation
import FirebaseFirestore
import WorkNoteCore

/// クラウドの設定（settings/*）と勤務先の一覧（sites）。アプリを更新しなくても変えられる。
@Observable @MainActor
final class SettingsStore {
    private(set) var company = CompanySettings()
    private(set) var template: [ReportField] = ReportField.defaults
    private(set) var categories: [ExpenseCategory] = ExpenseCategory.defaults
    private(set) var sites: [Site] = []
    private var holidaysByYear: [Int: [Holiday]] = [:]

    @ObservationIgnored private var listeners: [ListenerRegistration] = []

    func start() {
        let settings = Firestore.db.collection("settings")
        listeners.append(settings.document("company").listen(CompanySettings.self) { [weak self] value in
            self?.company = value ?? CompanySettings()
            UploadQueue.shared.isEnabled = value?.imageUploadEnabled ?? false
        })
        listeners.append(settings.document("reportTemplate").listen(ReportTemplate.self) { [weak self] value in
            let fields = value?.fields ?? []
            self?.template = (fields.isEmpty ? ReportField.defaults : fields).sorted { $0.order < $1.order }
        })
        listeners.append(settings.document("expenseCategories").listen(ExpenseCategoryList.self) { [weak self] value in
            let list = value?.categories ?? []
            self?.categories = (list.isEmpty ? ExpenseCategory.defaults : list).sorted { $0.order < $1.order }
        })
        let year = WorkCalendar.calendar.component(.year, from: Date())
        for y in (year - 1)...(year + 1) {
            listeners.append(settings.document("calendar_\(y)").listen(HolidayCalendar.self) { [weak self] value in
                self?.holidaysByYear[y] = value?.holidays ?? []
            })
        }
        listeners.append(Firestore.db.collection("sites").whereField("active", isEqualTo: true).listen(Site.self) { [weak self] items, _ in
            self?.sites = items.sorted { ($0.order, $0.name) < ($1.order, $1.name) }
        })
    }

    func stop() {
        listeners.forEach { $0.remove() }
        listeners.removeAll()
    }

    var period: ClosingPeriod { ClosingPeriod(closingDay: company.closingDay) }

    var businessDays: BusinessDays { BusinessDays(holidays: Set(holidaysByYear.values.joined().map(\.date))) }

    func holiday(on dayKey: String) -> Holiday? {
        holidaysByYear.values.joined().first { $0.date == dayKey }
    }

    func category(id: String) -> ExpenseCategory {
        categories.first { $0.id == id }
            ?? ExpenseCategory.defaults.first { $0.id == id }
            ?? ExpenseCategory(id: id, name: "その他", keywords: [], order: 99)
    }

    func site(id: String) -> Site? {
        sites.first { $0.id == id }
    }

    /// 修正申請の期限
    func correctionDeadline(monthKey: String) -> Date? {
        businessDays.correctionDeadline(monthKey: monthKey, period: period, businessDays: company.correctionDeadlineBusinessDays)
    }

    func canRequestCorrection(monthKey: String, today: Date = Date()) -> Bool {
        businessDays.canRequestCorrection(monthKey: monthKey, period: period, businessDays: company.correctionDeadlineBusinessDays, today: today)
    }
}
