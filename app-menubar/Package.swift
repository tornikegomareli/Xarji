// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "XarjiMenuBar",
    platforms: [
        // Menu-bar styling + modern AppKit APIs we lean on (Task, async URLSession)
        // are comfortable on macOS 13 Ventura. Dropping lower would force a lot of
        // availability checks for not much reach.
        .macOS(.v13),
    ],
    targets: [
        .executableTarget(
            name: "XarjiMenuBar",
            path: "Sources/XarjiMenuBar",
            resources: [
                .process("Resources"),
            ]
        ),
    ]
)
