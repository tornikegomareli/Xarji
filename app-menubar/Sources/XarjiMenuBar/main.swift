import AppKit

// Menu-bar apps are conventionally started via NSApplication.shared +
// an explicit AppDelegate assignment. No @main attribute because there
// is no SwiftUI Scene — the whole app lives in an NSStatusItem.
let app = NSApplication.shared
let delegate = AppDelegate()
app.delegate = delegate
// Accessory activation policy hides the Dock icon for a belt-and-
// suspenders match with LSUIElement in Info.plist.
app.setActivationPolicy(.accessory)

// If the app dies via SIGTERM (kill command, Force Quit from Activity
// Monitor, system shutdown) the AppDelegate.applicationWillTerminate
// hook does NOT fire on its own — AppKit only plumbs that through for
// graceful `NSApplication.terminate()` paths. Route SIGTERM into the
// graceful path so the child xarji-core is stopped instead of
// orphaned. Signal handlers can only do async-signal-safe work, so
// we just post to the main queue and let the delegate do the teardown.
signal(SIGTERM) { _ in
    DispatchQueue.main.async {
        NSApplication.shared.terminate(nil)
    }
}

app.run()
