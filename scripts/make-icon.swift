// アプリアイコン（1024×1024）を描く。
// 青〜紫の背景に、日報を表す白いノートと、勤怠を表すオレンジの時計。
// 使い方: swift scripts/make-icon.swift web/icon/icon-1024.png のあと、web/README の手順で各サイズを作る
import AppKit
import CoreGraphics

let size = 1024
let output = CommandLine.arguments.dropFirst().first ?? "AppIcon.png"
let space = CGColorSpace(name: CGColorSpace.sRGB)!
let ctx = CGContext(data: nil, width: size, height: size, bitsPerComponent: 8, bytesPerRow: 0,
                    space: space, bitmapInfo: CGImageAlphaInfo.noneSkipLast.rawValue)!
// 左上を原点にする
ctx.translateBy(x: 0, y: CGFloat(size))
ctx.scaleBy(x: 1, y: -1)

func color(_ hex: UInt32, _ alpha: CGFloat = 1) -> CGColor {
    CGColor(srgbRed: CGFloat((hex >> 16) & 0xFF) / 255, green: CGFloat((hex >> 8) & 0xFF) / 255,
            blue: CGFloat(hex & 0xFF) / 255, alpha: alpha)
}

func gradient(_ colors: [UInt32], _ locations: [CGFloat]) -> CGGradient {
    CGGradient(colorsSpace: space, colors: colors.map { color($0) } as CFArray, locations: locations)!
}

// 背景
ctx.drawLinearGradient(gradient([0x6DB3FF, 0x5B6CF0, 0x9A62E0], [0, 0.55, 1]),
                       start: CGPoint(x: 0, y: 0), end: CGPoint(x: 1024, y: 1024), options: [])

func roundedRect(_ rect: CGRect, _ r: CGFloat) -> CGPath {
    CGPath(roundedRect: rect, cornerWidth: r, cornerHeight: r, transform: nil)
}

// ノート
ctx.saveGState()
ctx.setShadow(offset: CGSize(width: 0, height: 24), blur: 60, color: color(0x2A2F8F, 0.35))
ctx.addPath(roundedRect(CGRect(x: 205, y: 170, width: 470, height: 600), 72))
ctx.setFillColor(color(0xFFFFFF))
ctx.fillPath()
ctx.restoreGState()

// チェックの丸と見出しの線
ctx.setFillColor(color(0x5160E8))
ctx.fillEllipse(in: CGRect(x: 262, y: 245, width: 104, height: 104))
ctx.setStrokeColor(color(0xFFFFFF))
ctx.setLineWidth(17)
ctx.setLineCap(.round)
ctx.setLineJoin(.round)
ctx.move(to: CGPoint(x: 290, y: 299))
ctx.addLine(to: CGPoint(x: 308, y: 318))
ctx.addLine(to: CGPoint(x: 340, y: 278))
ctx.strokePath()
ctx.addPath(roundedRect(CGRect(x: 400, y: 280, width: 210, height: 36), 18))
ctx.setFillColor(color(0x6366F1))
ctx.fillPath()

// 本文の線
ctx.setFillColor(color(0xDCE0FB))
for (y, w) in [(410.0, 340.0), (500.0, 300.0), (590.0, 200.0)] {
    ctx.addPath(roundedRect(CGRect(x: 262, y: y, width: w, height: 38), 19))
    ctx.fillPath()
}

// 時計
let c = CGPoint(x: 700, y: 700)
ctx.saveGState()
ctx.setShadow(offset: CGSize(width: 0, height: 20), blur: 50, color: color(0x4A2A8F, 0.35))
ctx.setFillColor(color(0xFFFFFF))
ctx.fillEllipse(in: CGRect(x: c.x - 205, y: c.y - 205, width: 410, height: 410))
ctx.restoreGState()
ctx.saveGState()
ctx.addEllipse(in: CGRect(x: c.x - 180, y: c.y - 180, width: 360, height: 360))
ctx.clip()
ctx.drawLinearGradient(gradient([0xFFB866, 0xFF7E5F], [0, 1]),
                       start: CGPoint(x: c.x - 180, y: c.y - 180), end: CGPoint(x: c.x + 180, y: c.y + 180), options: [])
ctx.restoreGState()
// 目盛り
ctx.setFillColor(color(0xFFFFFF, 0.9))
for (dx, dy) in [(0.0, -140.0), (140.0, 0.0), (0.0, 140.0), (-140.0, 0.0)] {
    ctx.fillEllipse(in: CGRect(x: c.x + dx - 11, y: c.y + dy - 11, width: 22, height: 22))
}
// 針
ctx.setStrokeColor(color(0xFFFFFF))
ctx.setLineWidth(26)
ctx.move(to: c)
ctx.addLine(to: CGPoint(x: c.x, y: c.y - 105))
ctx.strokePath()
ctx.move(to: c)
ctx.addLine(to: CGPoint(x: c.x + 75, y: c.y + 55))
ctx.strokePath()
ctx.setFillColor(color(0xFFFFFF))
ctx.fillEllipse(in: CGRect(x: c.x - 22, y: c.y - 22, width: 44, height: 44))

let image = ctx.makeImage()!
let rep = NSBitmapImageRep(cgImage: image)
try! rep.representation(using: .png, properties: [:])!.write(to: URL(fileURLWithPath: output))
print("wrote \(output)")
