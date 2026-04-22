import Foundation
import os

/// Snapshot of what /api/health reports. Kept deliberately small —
/// the UI only needs the state + a few hints for the tooltip.
struct HealthSnapshot: Equatable, Sendable {
    enum State: String, Equatable, Sendable {
        case loading
        case unconfigured
        case running
        case paused
        case error
        case unreachable
    }

    var state: State
    var senders: [String]
    var transactionCount: Int
    var lastSync: Date?
    var message: String?

    static let loading = HealthSnapshot(state: .loading, senders: [], transactionCount: 0, lastSync: nil, message: nil)
    static let unreachable = HealthSnapshot(state: .unreachable, senders: [], transactionCount: 0, lastSync: nil, message: "Service not reachable")
}

/// Polls /api/health on an interval and publishes snapshots via
/// `onUpdate`. Runs entirely off the main actor; the callback is
/// responsible for hopping back to main if it touches AppKit.
///
/// `@unchecked Sendable` — the class mutates `timer` / `lastSnapshot`
/// only through its internal serial `queue`, so cross-thread access
/// is serialised manually. The compiler can't see that, hence the
/// unchecked override.
final class HealthPoller: @unchecked Sendable {
    private let logger = Logger(subsystem: "app.xarji.menubar", category: "HealthPoller")
    private let baseURL: URL
    private let session: URLSession
    private let interval: TimeInterval

    private var timer: DispatchSourceTimer?
    private var lastSnapshot: HealthSnapshot = .loading
    private let queue = DispatchQueue(label: "app.xarji.menubar.health", qos: .utility)

    /// Fires whenever the polled state transitions (not on identical
    /// snapshots). Called off the main actor — the consumer hops to
    /// main itself if it needs to mutate AppKit state.
    var onUpdate: (@Sendable (HealthSnapshot) -> Void)?

    init(baseURL: URL, interval: TimeInterval = 4) {
        self.baseURL = baseURL
        self.interval = interval
        let cfg = URLSessionConfiguration.ephemeral
        cfg.timeoutIntervalForRequest = 3
        cfg.timeoutIntervalForResource = 5
        cfg.waitsForConnectivity = false
        self.session = URLSession(configuration: cfg)
    }

    func start() {
        stop()
        // Emit the "loading" state immediately so the status bar has
        // something to render before the first poll completes.
        publish(.loading)

        let timer = DispatchSource.makeTimerSource(queue: queue)
        timer.schedule(deadline: .now(), repeating: interval)
        timer.setEventHandler { [weak self] in self?.tick() }
        timer.resume()
        self.timer = timer
    }

    func stop() {
        timer?.cancel()
        timer = nil
    }

    private func tick() {
        let url = baseURL.appendingPathComponent("api/health")
        var request = URLRequest(url: url)
        request.httpMethod = "GET"
        request.cachePolicy = .reloadIgnoringLocalCacheData

        let session = self.session
        let logger = self.logger
        let sink: @Sendable (HealthSnapshot) -> Void = { [weak self] snap in
            self?.publish(snap)
        }

        Task.detached {
            do {
                let (data, response) = try await session.data(for: request)
                guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
                    sink(.unreachable)
                    return
                }
                guard let snapshot = Self.parse(data) else {
                    sink(HealthSnapshot(state: .error, senders: [], transactionCount: 0, lastSync: nil, message: "Unparseable /api/health response"))
                    return
                }
                sink(snapshot)
            } catch {
                logger.debug("poll failed: \(String(describing: error), privacy: .public)")
                sink(.unreachable)
            }
        }
    }

    private func publish(_ snapshot: HealthSnapshot) {
        queue.async { [weak self] in
            guard let self else { return }
            if snapshot == self.lastSnapshot { return }
            self.lastSnapshot = snapshot
            self.onUpdate?(snapshot)
        }
    }

    private static func parse(_ data: Data) -> HealthSnapshot? {
        guard let root = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return nil
        }
        let stateString = root["state"] as? String ?? "error"
        let state = HealthSnapshot.State(rawValue: stateString) ?? .error
        let senders = (root["senders"] as? [String]) ?? []
        let count = (root["transactionCount"] as? Int) ?? 0
        var lastSync: Date?
        if let iso = root["lastSync"] as? String {
            let formatter = ISO8601DateFormatter()
            formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
            lastSync = formatter.date(from: iso) ?? ISO8601DateFormatter().date(from: iso)
        }
        let message = root["message"] as? String
        return HealthSnapshot(
            state: state,
            senders: senders,
            transactionCount: count,
            lastSync: lastSync,
            message: message
        )
    }
}
