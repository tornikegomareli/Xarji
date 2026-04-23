import { useCallback, useEffect, useState } from "react";

/**
 * Chromium exposes a `beforeinstallprompt` event when the page becomes
 * installable (manifest + service worker + not already installed). The
 * page can call `preventDefault()` on it, stash it, and then trigger
 * the install dialog later by calling `.prompt()` on the stashed event.
 *
 * Works in Chrome, Edge, Brave, Arc. Safari does NOT fire this event;
 * Safari users still install via File → Add to Dock. We surface
 * `canInstall` so UI code can hide the button when it wouldn't do
 * anything.
 *
 * Also listens for the `appinstalled` event (dispatched when the user
 * accepts the prompt) so the button disappears after a successful
 * install without needing a page reload.
 */
interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
}

export interface PwaInstall {
  /** True only when the browser has a pending install prompt we can fire. */
  canInstall: boolean;
  /** True when the page is already running in the installed PWA window. */
  isStandalone: boolean;
  /** Fire the native install dialog. Resolves to the user's choice. */
  install: () => Promise<"accepted" | "dismissed" | "unavailable">;
}

function detectStandalone(): boolean {
  if (typeof window === "undefined") return false;
  const mqStandalone = window.matchMedia?.("(display-mode: standalone)").matches ?? false;
  // Safari/iOS uses a non-standard navigator.standalone flag.
  const navStandalone = (window.navigator as { standalone?: boolean }).standalone === true;
  return mqStandalone || navStandalone;
}

export function usePwaInstall(): PwaInstall {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [isStandalone, setIsStandalone] = useState<boolean>(detectStandalone);

  useEffect(() => {
    function onPrompt(event: Event) {
      // Prevent the mini-infobar (Chrome's default) so our own button
      // stays the only install surface — otherwise the user sees two.
      event.preventDefault();
      setDeferred(event as BeforeInstallPromptEvent);
    }
    function onInstalled() {
      setDeferred(null);
      setIsStandalone(true);
    }
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  const install = useCallback(async (): Promise<"accepted" | "dismissed" | "unavailable"> => {
    if (!deferred) return "unavailable";
    await deferred.prompt();
    const { outcome } = await deferred.userChoice;
    // The spec says the event can only be used once; clear regardless
    // of the user's choice so a subsequent click doesn't throw.
    setDeferred(null);
    return outcome;
  }, [deferred]);

  return { canInstall: deferred !== null, isStandalone, install };
}
