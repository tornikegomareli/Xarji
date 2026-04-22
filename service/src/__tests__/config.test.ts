import { describe, test, expect, beforeEach, afterEach } from "bun:test";
import { existsSync, mkdirSync, renameSync, writeFileSync, unlinkSync } from "node:fs";
import { dirname } from "node:path";
import { loadConfig, isConfigured, hasSavedConfig, CONFIG_PATH } from "../config";

/**
 * Config loading has three distinct paths that all have to stay honest:
 *
 *   1. ~/.xarji/config.json exists → read it, merge over defaults.
 *   2. No file, but INSTANT_APP_ID + INSTANT_ADMIN_TOKEN env vars set →
 *      synthesise a config that treats InstantDB as enabled so the
 *      parser actually starts (regression caught in Codex review).
 *   3. Neither — return defaults; the HTTP server serves just the
 *      onboarding UI until the user sets things up.
 *
 * `isConfigured()` must return true for (1) and (2), false for (3),
 * because it's what index.ts checks to decide whether to spin up the
 * ExpenseTrackerService.
 */

const BACKUP_PATH = `${CONFIG_PATH}.test-backup`;
const CONFIG_DIR = dirname(CONFIG_PATH);

function ensureConfigDir() {
  // On CI the runner has no ~/.xarji yet, so writeFileSync would fail
  // with ENOENT. The tests only need the directory to exist; actual
  // config contents are stashed/restored around each test.
  mkdirSync(CONFIG_DIR, { recursive: true });
}

function stashConfig() {
  ensureConfigDir();
  if (existsSync(CONFIG_PATH)) renameSync(CONFIG_PATH, BACKUP_PATH);
}
function restoreConfig() {
  if (existsSync(CONFIG_PATH)) unlinkSync(CONFIG_PATH);
  if (existsSync(BACKUP_PATH)) renameSync(BACKUP_PATH, CONFIG_PATH);
}

beforeEach(() => {
  stashConfig();
  delete process.env.INSTANT_APP_ID;
  delete process.env.INSTANT_ADMIN_TOKEN;
});

afterEach(() => {
  delete process.env.INSTANT_APP_ID;
  delete process.env.INSTANT_ADMIN_TOKEN;
  restoreConfig();
});

describe("loadConfig + isConfigured — env-var path", () => {
  test("no file + no env vars → isConfigured() is false", () => {
    const cfg = loadConfig();
    expect(hasSavedConfig()).toBe(false);
    expect(isConfigured()).toBe(false);
    // Defaults shouldn't claim InstantDB is usable.
    expect(cfg.instantdb.enabled).toBe(false);
  });

  test("env vars set → loaded config has enabled=true + the env values, isConfigured() is true", () => {
    process.env.INSTANT_APP_ID = "env-app-id";
    process.env.INSTANT_ADMIN_TOKEN = "env-admin-token";
    const cfg = loadConfig();
    expect(cfg.instantdb.enabled).toBe(true);
    expect(cfg.instantdb.appId).toBe("env-app-id");
    expect(cfg.instantdb.adminToken).toBe("env-admin-token");
    expect(isConfigured()).toBe(true);
  });

  test("only INSTANT_APP_ID set (no token) → isConfigured() stays false", () => {
    process.env.INSTANT_APP_ID = "env-app-id";
    const cfg = loadConfig();
    expect(cfg.instantdb.enabled).toBe(false);
    expect(isConfigured()).toBe(false);
  });

  test("only INSTANT_ADMIN_TOKEN set (no app id) → isConfigured() stays false", () => {
    process.env.INSTANT_ADMIN_TOKEN = "env-admin-token";
    const cfg = loadConfig();
    expect(cfg.instantdb.enabled).toBe(false);
    expect(isConfigured()).toBe(false);
  });
});

describe("loadConfig + isConfigured — file path", () => {
  test("file present (even with enabled=false) → isConfigured() is true", () => {
    writeFileSync(
      CONFIG_PATH,
      JSON.stringify({
        bankSenderIds: ["SOLO"],
        instantdb: { enabled: false, appId: "", adminToken: "" },
        webhook: { enabled: false, url: "" },
      })
    );
    expect(hasSavedConfig()).toBe(true);
    expect(isConfigured()).toBe(true);
    // enabled:false in the file means the parser runs without InstantDB
    // sync — a legitimate "local-only" mode. The file's truthfulness
    // beats env vars (we don't silently re-enable it from env).
    const cfg = loadConfig();
    expect(cfg.instantdb.enabled).toBe(false);
  });

  test("file beats env vars when both present", () => {
    writeFileSync(
      CONFIG_PATH,
      JSON.stringify({
        bankSenderIds: ["SOLO"],
        instantdb: { enabled: true, appId: "from-file", adminToken: "from-file-token" },
        webhook: { enabled: false, url: "" },
      })
    );
    process.env.INSTANT_APP_ID = "from-env";
    process.env.INSTANT_ADMIN_TOKEN = "from-env-token";
    const cfg = loadConfig();
    expect(cfg.instantdb.appId).toBe("from-file");
    expect(cfg.instantdb.adminToken).toBe("from-file-token");
  });
});
