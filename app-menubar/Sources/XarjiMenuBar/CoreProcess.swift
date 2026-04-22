import Foundation
import os

/// Launches and supervises the `xarji-core` child process — the
/// compiled Bun service that parses SMS and serves the dashboard.
///
/// Invariants:
///  * The binary is co-located in `Xarji.app/Contents/MacOS/xarji-core`,
///    next to the menu-bar executable. We resolve its path from
///    `Bundle.main.bundleURL` so it works both when the .app is double-
///    clicked and when a developer runs the built binary directly out
///    of `.build/release/` with the binary stubbed in that directory.
///  * Stdout and stderr are captured and forwarded to `os.Logger` so
///    Console.app users can see parser logs without leaving.
///  * Restart-on-crash uses exponential backoff capped at 30s so a
///    permanently-broken binary doesn't peg the CPU.
///
/// `@unchecked Sendable` — all mutable state (`process`, `stopped`,
/// `restartCount`) is touched only on the internal `supervisionQueue`,
/// so cross-thread access is serialised manually. The compiler can't
/// see that, hence the unchecked override.
final class CoreProcess: @unchecked Sendable {
    private let logger = Logger(subsystem: "app.xarji.menubar", category: "CoreProcess")
    private let baseURL: URL
    private var process: Process?
    private var stopped = false
    private var restartCount = 0
    private let maxBackoff: TimeInterval = 30
    private let supervisionQueue = DispatchQueue(label: "app.xarji.menubar.core", qos: .utility)

    init(baseURL: URL) {
        self.baseURL = baseURL
    }

    func start() {
        supervisionQueue.async { [weak self] in
            self?.launchOnce()
        }
    }

    func stop() {
        supervisionQueue.sync {
            self.stopped = true
            if let proc = self.process, proc.isRunning {
                proc.terminate()
                proc.waitUntilExit()
            }
            self.process = nil
        }
    }

    // MARK: - Internals

    private func launchOnce() {
        if stopped { return }

        guard let binaryURL = resolveCoreBinary() else {
            logger.error("xarji-core binary not found alongside Xarji.app's MacOS folder")
            return
        }

        let proc = Process()
        proc.executableURL = binaryURL

        // Expose the port we expect the dashboard on as XARJI_PORT so
        // the service honours the same URL the menu-bar app is polling.
        var env = ProcessInfo.processInfo.environment
        if let port = baseURL.port {
            env["XARJI_PORT"] = String(port)
        }
        proc.environment = env

        let outPipe = Pipe()
        let errPipe = Pipe()
        proc.standardOutput = outPipe
        proc.standardError = errPipe
        forward(pipe: outPipe, prefix: "[core]")
        forward(pipe: errPipe, prefix: "[core!]")

        let supervisionQueue = self.supervisionQueue
        let logger = self.logger

        proc.terminationHandler = { [weak self] done in
            let status = done.terminationStatus
            let reason = String(describing: done.terminationReason)
            logger.info("xarji-core exited status=\(status, privacy: .public) reason=\(reason, privacy: .public)")
            guard let self else { return }
            supervisionQueue.async { [weak self] in
                guard let self, !self.stopped else { return }
                // Exponential backoff: 0.5s, 1s, 2s, … capped at maxBackoff.
                self.restartCount += 1
                let delay = min(self.maxBackoff, 0.5 * pow(2.0, Double(self.restartCount - 1)))
                supervisionQueue.asyncAfter(deadline: .now() + delay) { [weak self] in
                    self?.launchOnce()
                }
            }
        }

        do {
            try proc.run()
            process = proc
            logger.info("xarji-core started pid=\(proc.processIdentifier, privacy: .public) at \(binaryURL.path, privacy: .public)")
            // Reset backoff after a successful run for at least 10s.
            supervisionQueue.asyncAfter(deadline: .now() + 10) { [weak self] in
                guard let self, let p = self.process, p.isRunning else { return }
                self.restartCount = 0
            }
        } catch {
            logger.error("failed to launch xarji-core: \(String(describing: error), privacy: .public)")
        }
    }

    /// Search order:
    ///   1. `XARJI_CORE_BINARY` env override (useful for `swift run`
    ///      when the binary lives somewhere else during dev).
    ///   2. Next to the menu-bar executable (the .app bundle case).
    private func resolveCoreBinary() -> URL? {
        if let env = ProcessInfo.processInfo.environment["XARJI_CORE_BINARY"] {
            let url = URL(fileURLWithPath: env)
            if FileManager.default.fileExists(atPath: url.path) { return url }
        }
        // Bundle.main.bundleURL inside an .app returns the .app itself.
        let bundle = Bundle.main.bundleURL
        let macOS = bundle.appendingPathComponent("Contents/MacOS")
        let coreInsideApp = macOS.appendingPathComponent("xarji-core")
        if FileManager.default.fileExists(atPath: coreInsideApp.path) { return coreInsideApp }
        // When running from `swift run`, Bundle.main is the build dir.
        let coreAlongside = bundle.deletingLastPathComponent().appendingPathComponent("xarji-core")
        if FileManager.default.fileExists(atPath: coreAlongside.path) { return coreAlongside }
        return nil
    }

    private func forward(pipe: Pipe, prefix: String) {
        let handle = pipe.fileHandleForReading
        let logger = self.logger
        handle.readabilityHandler = { fh in
            let data = fh.availableData
            if data.isEmpty {
                // EOF — the child closed its end of the pipe. If we
                // leave the readabilityHandler in place the fd stays
                // registered forever and the closure keeps firing
                // every time the kernel reports "readable" on the
                // closed descriptor. That accumulates across every
                // respawn, so clear the handler and close our end.
                fh.readabilityHandler = nil
                try? fh.close()
                return
            }
            guard let text = String(data: data, encoding: .utf8) else { return }
            for line in text.split(separator: "\n", omittingEmptySubsequences: true) {
                logger.info("\(prefix, privacy: .public) \(String(line), privacy: .public)")
            }
        }
    }
}
