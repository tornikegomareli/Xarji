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
// orphaned.
//
// Use a GCD signal source instead of a raw `signal(2)` handler. The
// handler block attached to a DispatchSource runs on the main dispatch
// queue *outside* signal context, so it can legitimately call
// NSApplication.terminate and other non-async-signal-safe APIs.
// `SIG_IGN` is installed first so the default SIGTERM disposition
// (immediate process termination) doesn't race the dispatch source.
signal(SIGTERM, SIG_IGN)
let sigtermSource = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .main)
sigtermSource.setEventHandler {
    NSApplication.shared.terminate(nil)
}
sigtermSource.resume()

app.run()
