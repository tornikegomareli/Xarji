import AppKit
import os

/// Owns the NSStatusItem, renders the current health snapshot, and
/// translates menu-item clicks into callbacks.
///
/// All AppKit state lives on the main actor, so this whole class is
/// marked @MainActor and callers that cross isolation domains (e.g.
/// HealthPoller's background queue) have to hop to main before calling
/// `apply`.
///
/// The icon is a single glyph (₾, Georgian lari) with a short suffix
/// indicating current state (no suffix when running, "!" on error,
/// "?" when the service is unreachable, " ·" when unconfigured).
@MainActor
final class StatusBarController: NSObject, NSMenuDelegate {
    private let logger = Logger(subsystem: "app.xarji.menubar", category: "StatusBar")
    private let baseURL: URL
    private let onOpenDashboard: () -> Void
    private let onQuit: () -> Void

    private let statusItem: NSStatusItem
    private let openDashboardItem: NSMenuItem
    private let statusLabelItem: NSMenuItem
    private let lastSyncItem: NSMenuItem
    private let sendersItem: NSMenuItem
    private let quitItem: NSMenuItem

    private var snapshot: HealthSnapshot = .loading

    /// First-run convenience: the first time the poller reports the
    /// service as .unconfigured, automatically open the dashboard so
    /// the user lands on the onboarding wizard without having to
    /// discover the menu-bar icon. Latched so subsequent .unconfigured
    /// polls (e.g. the user closing their browser tab) don't re-open
    /// the browser every four seconds.
    private var hasAutoOpenedForSetup = false

    init(
        baseURL: URL,
        onOpenDashboard: @escaping () -> Void,
        onQuit: @escaping () -> Void
    ) {
        self.baseURL = baseURL
        self.onOpenDashboard = onOpenDashboard
        self.onQuit = onQuit

        // variableLength adapts to the icon's intrinsic size instead of
        // forcing a square slot.
        self.statusItem = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength)

        // Menu items constructed up front so the status bar is
        // reactive — apply() just mutates their titles.
        self.openDashboardItem = NSMenuItem(title: "Open dashboard", action: #selector(Self.handleOpenDashboard), keyEquivalent: "")
        self.statusLabelItem = NSMenuItem(title: "Status: loading…", action: nil, keyEquivalent: "")
        self.lastSyncItem = NSMenuItem(title: "Last sync: —", action: nil, keyEquivalent: "")
        self.sendersItem = NSMenuItem(title: "Senders: —", action: nil, keyEquivalent: "")
        self.quitItem = NSMenuItem(title: "Quit Xarji", action: #selector(Self.handleQuit), keyEquivalent: "q")

        super.init()

        self.openDashboardItem.target = self
        self.quitItem.target = self
        self.statusLabelItem.isEnabled = false
        self.lastSyncItem.isEnabled = false
        self.sendersItem.isEnabled = false

        let menu = NSMenu()
        menu.delegate = self
        menu.addItem(openDashboardItem)
        menu.addItem(NSMenuItem.separator())
        menu.addItem(statusLabelItem)
        menu.addItem(lastSyncItem)
        menu.addItem(sendersItem)
        menu.addItem(NSMenuItem.separator())
        menu.addItem(quitItem)

        if let button = statusItem.button {
            button.title = "₾"
            button.font = NSFont.menuBarFont(ofSize: 0)
            button.toolTip = "Xarji — loading…"
        }
        statusItem.menu = menu

        render()
    }

    /// Swap in a new health snapshot and redraw. Safe to call from
    /// anywhere — internally hops to the main actor before mutating
    /// AppKit state.
    nonisolated func apply(_ newSnapshot: HealthSnapshot) {
        Task { @MainActor [weak self] in
            guard let self else { return }
            self.snapshot = newSnapshot
            self.render()
            self.autoOpenIfFirstUnconfigured(newSnapshot)
        }
    }

    private func autoOpenIfFirstUnconfigured(_ snapshot: HealthSnapshot) {
        guard !hasAutoOpenedForSetup else { return }
        guard snapshot.state == .unconfigured else { return }
        hasAutoOpenedForSetup = true
        logger.info("first unconfigured snapshot — auto-opening dashboard")
        onOpenDashboard()
    }

    private func render() {
        let (titleSymbol, summary, tooltip, enableOpen) = presentation(for: snapshot)

        if let button = statusItem.button {
            button.title = titleSymbol
            button.toolTip = tooltip
        }

        statusLabelItem.title = "Status: \(summary)"
        openDashboardItem.isEnabled = enableOpen

        let sendersText = snapshot.senders.isEmpty ? "—" : snapshot.senders.joined(separator: ", ")
        sendersItem.title = "Senders: \(sendersText)"
        lastSyncItem.title = "Last sync: \(formattedLastSync(snapshot.lastSync))"
    }

    /// Returns (icon text, short status, full tooltip, open-dashboard enabled).
    private func presentation(for snapshot: HealthSnapshot) -> (String, String, String, Bool) {
        switch snapshot.state {
        case .loading:
            return ("₾", "loading…", "Xarji — loading…", true)
        case .unconfigured:
            return ("₾ ·", "needs setup", "Xarji — open the dashboard to finish setup", true)
        case .running:
            let tip = "Xarji — \(snapshot.transactionCount.formatted()) transactions · last sync \(formattedLastSync(snapshot.lastSync))"
            return ("₾", "running", tip, true)
        case .paused:
            return ("₾", "paused", "Xarji — sync paused", true)
        case .error:
            let tip = snapshot.message.map { "Xarji error: \($0)" } ?? "Xarji error"
            return ("₾!", "error", tip, true)
        case .unreachable:
            return ("₾?", "unreachable", "Xarji — can't reach the local service", false)
        }
    }

    private func formattedLastSync(_ date: Date?) -> String {
        guard let date else { return "—" }
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .short
        return formatter.localizedString(for: date, relativeTo: Date())
    }

    @objc private func handleOpenDashboard() {
        onOpenDashboard()
    }

    @objc private func handleQuit() {
        onQuit()
    }
}
