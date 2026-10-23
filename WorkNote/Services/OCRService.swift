import UIKit
import Vision
import WorkNoteCore

/// 領収書の文字を iPhone の中で読み取る（Apple Vision）。画像は外部に送らない。
enum OCRService {
    struct Result {
        var text: String
        var fields: ReceiptFields
    }

    static func recognize(_ image: UIImage) async throws -> Result {
        guard let cgImage = image.cgImage else { return Result(text: "", fields: ReceiptFields()) }
        let orientation = CGImagePropertyOrientation(image.imageOrientation)
        let lines = try await Task.detached(priority: .userInitiated) {
            let request = VNRecognizeTextRequest()
            request.recognitionLevel = .accurate
            request.recognitionLanguages = ["ja-JP", "en-US"]
            request.usesLanguageCorrection = true
            try VNImageRequestHandler(cgImage: cgImage, orientation: orientation).perform([request])
            return orderedLines(request.results ?? [])
        }.value
        return Result(text: lines.joined(separator: "\n"), fields: ReceiptParser.parse(lines: lines))
    }

    /// 上から順に、同じ高さの文字は左から右へつなげて1行にする
    private static func orderedLines(_ observations: [VNRecognizedTextObservation]) -> [String] {
        let items = observations.compactMap { o -> (box: CGRect, text: String)? in
            guard let text = o.topCandidates(1).first?.string else { return nil }
            return (o.boundingBox, text)
        }
        // Vision の座標は左下が原点
        let sorted = items.sorted { $0.box.midY > $1.box.midY }
        var rows: [[(box: CGRect, text: String)]] = []
        for item in sorted {
            if let last = rows.last?.first, abs(last.box.midY - item.box.midY) < min(last.box.height, item.box.height) * 0.5 {
                rows[rows.count - 1].append(item)
            } else {
                rows.append([item])
            }
        }
        return rows.map { row in row.sorted { $0.box.minX < $1.box.minX }.map(\.text).joined(separator: " ") }
    }
}

extension CGImagePropertyOrientation {
    init(_ orientation: UIImage.Orientation) {
        switch orientation {
        case .up: self = .up
        case .upMirrored: self = .upMirrored
        case .down: self = .down
        case .downMirrored: self = .downMirrored
        case .left: self = .left
        case .leftMirrored: self = .leftMirrored
        case .right: self = .right
        case .rightMirrored: self = .rightMirrored
        @unknown default: self = .up
        }
    }
}
