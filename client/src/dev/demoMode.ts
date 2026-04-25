// Dev-only switchable demo data. Replaces InstantDB-backed `db` with an
// in-memory fake (see ./demoDb) when active. Resolution and writes guard
// on `import.meta.env.DEV` so production builds tree-shake this module
// out entirely.

const STORAGE_KEY = "xarji-demo-mode";

export type DemoSeed = "default" | "empty";
export type DemoSelection = DemoSeed | "off";

function readUrlOverride(): DemoSelection | null {
  if (typeof window === "undefined") return null;
  const params = new URLSearchParams(window.location.search);
  if (!params.has("demo")) return null;
  const raw = (params.get("demo") || "").toLowerCase();

  let result: DemoSelection;
  if (raw === "0" || raw === "off" || raw === "false") result = "off";
  else if (raw === "empty") result = "empty";
  else result = "default";

  // Strip the param so it doesn't end up in screen captures of the demo.
  params.delete("demo");
  const search = params.toString();
  const url = `${window.location.pathname}${search ? `?${search}` : ""}${window.location.hash}`;
  window.history.replaceState({}, "", url);
  return result;
}

function readStorage(): DemoSeed | null {
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    if (v === "default" || v === "empty") return v;
  } catch {
    /* private browsing / storage disabled — treat as off */
  }
  return null;
}

function writeStorage(value: DemoSeed | null) {
  try {
    if (value === null) window.localStorage.removeItem(STORAGE_KEY);
    else window.localStorage.setItem(STORAGE_KEY, value);
  } catch {
    /* ignore */
  }
}

let cached: DemoSeed | null = null;
let resolved = false;

function resolve(): DemoSeed | null {
  if (resolved) return cached;
  resolved = true;
  if (!import.meta.env.DEV) {
    cached = null;
    return cached;
  }

  const url = readUrlOverride();
  if (url === "off") {
    writeStorage(null);
    cached = null;
    return cached;
  }
  if (url !== null) {
    writeStorage(url);
    cached = url;
    return cached;
  }
  cached = readStorage();
  return cached;
}

export function isDemoMode(): boolean {
  return resolve() !== null;
}

export function getDemoSeed(): DemoSeed {
  return resolve() ?? "default";
}

export function getCurrentDemoSelection(): DemoSelection {
  return resolve() ?? "off";
}

// Persists the choice and reloads the page. The dashboard owns long-lived
// InstantDB subscriptions; swapping the client live would risk leaking
// listeners, so we always reload to get a clean module evaluation.
export function setDemoMode(value: DemoSelection): void {
  if (!import.meta.env.DEV) return;
  writeStorage(value === "off" ? null : value);
  window.location.reload();
}
