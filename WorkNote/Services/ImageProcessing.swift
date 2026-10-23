import UIKit

enum ImageProcessing {
    /// 長辺を maxLength 以下に縮小して JPEG にする
    static func jpegData(_ image: UIImage, maxLength: CGFloat, quality: CGFloat = 0.8) -> Data? {
        let size = image.size
        let scale = min(1, maxLength / max(size.width, size.height))
        let target = CGSize(width: (size.width * scale).rounded(), height: (size.height * scale).rounded())
        let format = UIGraphicsImageRendererFormat()
        format.scale = 1
        let resized = UIGraphicsImageRenderer(size: target, format: format).image { _ in
            image.draw(in: CGRect(origin: .zero, size: target))
        }
        return resized.jpegData(compressionQuality: quality)
    }

    /// 日報の写真（長辺 2000px 程度）
    static func reportPhoto(_ image: UIImage) -> Data? {
        jpegData(image, maxLength: 2000, quality: 0.8)
    }

    /// 領収書（文字が読める解像度を保つ）
    static func receipt(_ image: UIImage) -> Data? {
        jpegData(image, maxLength: 3000, quality: 0.85)
    }
}
