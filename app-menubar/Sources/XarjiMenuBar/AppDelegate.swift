import AppKit
import os

/// Top-level lifecycle. Owns the child-process supervisor, the health
/// poller, and the status-bar controller — hands them to each other on
/// launch and tears them down in a deterministic order on quit.
final class AppDelegate: NSObject, NSApplicationDelegate {
    private let logger = Logger(subsystem: "app.xarji.menubar", category: "AppDelegate")

    private var coreProcess: CoreProcess?
    private var healthPoller: HealthPoller?
    private var statusBar: StatusBarController?

    /// The compiled service binary publishes a JSON API here. The menu-bar
    /// app polls /api/health to drive the status icon and opens this URL
    /// in the user's default browser on "Open dashboard".
    static let coreBaseURL = URL(string: "http://127.0.0.1:8721")!

    func applicationDidFinishLaunching(_ notification: Notification) {
        logger.info("XarjiMenuBar launching")

        let core = CoreProcess(baseURL: AppDelegate.coreBaseURL)
        self.coreProcess = core

        let poller = HealthPoller(baseURL: AppDelegate.coreBaseURL)
        self.healthPoller = poller

        let controller = StatusBarController(
            baseURL: AppDelegate.coreBaseURL,
            onOpenDashboard: { [weak self] in self?.openDashboard() },
            onQuit: { [weak self] in self?.quit() }
        )
        self.statusBar = controller

        // Wire the poller → status bar hand-off before anything starts
        // so we don't drop the first update.
        poller.onUpdate = { [weak controller] snapshot in
            controller?.apply(snapshot)
        }

        core.start()
        poller.start()
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        // Menu-bar apps have no windows by design; ignore the last-window-
        // closed signal so closing a transient NSAlert doesn't quit us.
        return false
    }

    func applicationWillTerminate(_ notification: Notification) {
        logger.info("XarjiMenuBar terminating — stopping core")
        healthPoller?.stop()
        coreProcess?.stop()
    }

    // MARK: - Menu actions

    func openDashboard() {
        NSWorkspace.shared.open(AppDelegate.coreBaseURL)
    }

    func quit() {
        // This is invoked from the MainActor-isolated
        // StatusBarController.handleQuit callback, so we're already on
        // main. The cross-isolation warning is silenced with an explicit
        // Task that re-enters the main actor.
        Task { @MainActor in
            NSApplication.shared.terminate(nil)
        }
    }
}
