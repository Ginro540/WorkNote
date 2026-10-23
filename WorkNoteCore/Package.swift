// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "WorkNoteCore",
    defaultLocalization: "ja",
    platforms: [.iOS(.v18), .macOS(.v14)],
    products: [
        .library(name: "WorkNoteCore", targets: ["WorkNoteCore"]),
    ],
    targets: [
        .target(name: "WorkNoteCore"),
        .testTarget(name: "WorkNoteCoreTests", dependencies: ["WorkNoteCore"]),
    ]
)
