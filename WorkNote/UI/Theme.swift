import SwiftUI

enum Theme {
    static let accent = Color(hex: 0x3D7BF6)

    /// 出勤ボタン・ログイン画面（青〜紫）
    static let clockIn = LinearGradient(colors: [Color(hex: 0x4A8BFF), Color(hex: 0x5B5CE6)], startPoint: .topLeading, endPoint: .bottomTrailing)
    /// 退勤ボタン（オレンジ）
    static let clockOut = LinearGradient(colors: [Color(hex: 0xFFB04A), Color(hex: 0xFF7A3D)], startPoint: .topLeading, endPoint: .bottomTrailing)
    static let clockInColor = Color(hex: 0x4F7BF7)
    static let clockOutColor = Color(hex: 0xFF9A3C)

    static let login = LinearGradient(colors: [Color(hex: 0x5B9BFF), Color(hex: 0x5662F0), Color(hex: 0x8A5BE0)], startPoint: .top, endPoint: .bottom)
    /// 日報（緑〜青）
    static let report = LinearGradient(colors: [Color(hex: 0x22B07D), Color(hex: 0x1E8FC4)], startPoint: .leading, endPoint: .trailing)
    /// 経費（紫〜ピンク）
    static let expense = LinearGradient(colors: [Color(hex: 0x8B5CF6), Color(hex: 0xEC4899)], startPoint: .leading, endPoint: .trailing)
    static let expenseColor = Color(hex: 0x8B5CF6)

    static let saturday = Color(hex: 0x1E88E5)
    static let holiday = Color(hex: 0xE53935)
    static let warning = Color(hex: 0xF08C00)

    static let cardRadius: CGFloat = 22
}

extension Color {
    init(hex: UInt32, opacity: Double = 1) {
        self.init(
            .sRGB,
            red: Double((hex >> 16) & 0xFF) / 255,
            green: Double((hex >> 8) & 0xFF) / 255,
            blue: Double(hex & 0xFF) / 255,
            opacity: opacity
        )
    }
}

/// 経費の区分ごとの色とアイコン
enum CategoryStyle {
    static func color(_ id: String) -> Color {
        switch id {
        case "travel": Color(hex: 0x3B82F6)
        case "parking": Color(hex: 0x6366F1)
        case "fuel": Color(hex: 0xFB8C1E)
        case "supplies": Color(hex: 0xA97B5C)
        case "meeting": Color(hex: 0x14B8C4)
        case "entertainment": Color(hex: 0xE5487A)
        case "communication": Color(hex: 0x22A06B)
        default: Color(hex: 0x8E8E93)
        }
    }

    static func icon(_ id: String) -> String {
        switch id {
        case "travel": "tram.fill"
        case "parking": "parkingsign"
        case "fuel": "fuelpump.fill"
        case "supplies": "hammer.fill"
        case "meeting": "cup.and.saucer.fill"
        case "entertainment": "fork.knife"
        case "communication": "envelope.fill"
        default: "ellipsis"
        }
    }
}
