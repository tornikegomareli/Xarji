/**
 * Localhost HTTP server.
 *
 * Serves the React client (from embedded assets when running as a
 * compiled binary, from client/dist/ on disk otherwise) and exposes a
 * small JSON API the dashboard + menu-bar app consume.
 *
 * Always binds 127.0.0.1 — never 0.0.0.0 — so the local network cannot
 * reach the dashboard. This is a single-user local app; access control
 * is "the user owns the loopback interface."
 */

import { file } from "bun";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import type { Config } from "./config";
import { loadConfig } from "./config";
import { ExpenseTrackerService } from "./service";
import { allBanks } from "./parser";
import { CLIENT_ASSETS } from "./generated/client-assets";
import { serializeSchema, type FieldMap } from "./setup/schema";
import { applySetup } from "./setup/apply";
import { previewSenders } from "./setup/preview";
import { getRateSheet } from "./exchange-rate/exchange-service";
import {
  NbgDateNotFoundError,
  NbgFutureDateError,
  NbgInvalidLanguageError,
  NbgRequestFailedError,
  type NbgLanguage,
} from "./exchange-rate/nbg-client";

export interface HttpServerOptions {
  port: number;
  config: Config;
  service: ExpenseTrackerService | null;
  // `configured` is separate from `service` because we always start the
  // HTTP server first; the parser only spins up when config is valid.
  configured: boolean;
}

/**
 * Build the redacted form of current config values used by the
 * onboarding UI to pre-populate the wizard on a re-run. We intentionally
 * don't echo the admin token back so a "reconfigure" flow still has to
 * re-paste the secret.
 */
function currentSetupValues(config: Config): FieldMap {
  return {
    instantAppId: config.instantdb.appId || "",
    instantAdminToken: config.instantdb.adminToken ? "" : "",
    bankSenderIds: config.bankSenderIds,
  };
}

interface HealthResponse {
  state: "unconfigured" | "running" | "paused" | "error";
  message?: string;
  senders: string[];
  transactionCount: number;
  lastSync: string | null;
  running: boolean;
}

function loggedIp(req: Request): string {
  return req.headers.get("x-forwarded-for") || "local";
}

function json(value: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(value), {
    ...init,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...(init?.headers || {}),
    },
  });
}

function notFound(): Response {
  return new Response("Not found", { status: 404 });
}

// When the generated module is populated the server reads bytes through
// Bun.file(path) where `path` is the string returned by the file-type
// import — that string resolves correctly inside a compiled binary.
//
// When the module is empty (checked-in placeholder, dev mode), fall back
// to serving from client/dist/ on disk.
const DEV_CLIENT_DIST = resolve(import.meta.dir, "..", "..", "client", "dist");
const HAS_EMBEDDED_ASSETS = Object.keys(CLIENT_ASSETS).length > 0;

function resolveAssetPath(urlPath: string): string | null {
  const normalized = urlPath === "" || urlPath === "/" ? "/" : urlPath;
  if (HAS_EMBEDDED_ASSETS) {
    return CLIENT_ASSETS[normalized] ?? null;
  }
  const candidate = normalized === "/" ? "index.html" : normalized.replace(/^\/+/, "");
  const full = join(DEV_CLIENT_DIST, candidate);
  return existsSync(full) ? full : null;
}

function contentTypeFor(urlPath: string): string {
  // The bare root maps to index.html; treat it explicitly so the browser
  // doesn't render the HTML as a binary download.
  if (urlPath === "/" || urlPath.endsWith(".html")) return "text/html; charset=utf-8";
  if (urlPath.endsWith(".js") || urlPath.endsWith(".mjs")) return "text/javascript; charset=utf-8";
  if (urlPath.endsWith(".css")) return "text/css; charset=utf-8";
  if (urlPath.endsWith(".svg")) return "image/svg+xml";
  if (urlPath.endsWith(".png")) return "image/png";
  if (urlPath.endsWith(".ico")) return "image/x-icon";
  if (urlPath.endsWith(".json")) return "application/json; charset=utf-8";
  if (urlPath.endsWith(".webmanifest")) return "application/manifest+json; charset=utf-8";
  if (urlPath.endsWith(".woff2")) return "font/woff2";
  return "application/octet-stream";
}

/**
 * Inject runtime globals into served HTML. Vite inlines
 * VITE_INSTANT_APP_ID at build time, so a pre-compiled client bundle
 * would otherwise always hit the baked-in app id regardless of what
 * the user entered in the onboarding wizard. Injecting a small
 * `<script>` tag with the *currently-configured* InstantDB app id
 * lets client/src/lib/instant.ts prefer window.__XARJI_APP_ID__ and
 * pick up the live value on the next page reload.
 *
 * The runtime config is read per-request so swapping config via
 * POST /api/setup takes effect without a service restart.
 */
async function serveHtmlWithRuntimeConfig(assetPath: string, opts: HttpServerOptions): Promise<Response> {
  const original = await file(assetPath).text();
  const appId = opts.config.instantdb.appId ?? "";
  // Escape `</` in the JSON payload so a pathological app id couldn't
  // close the <script> tag early. JSON.stringify never produces `</`,
  // but belt-and-braces is cheap here.
  const appIdJson = JSON.stringify(appId).replace(/<\//g, "<\\/");
  const snippet = `<script>window.__XARJI_APP_ID__=${appIdJson};</script>`;
  const injected = original.includes("</head>")
    ? original.replace("</head>", `${snippet}</head>`)
    : `${snippet}${original}`;
  return new Response(injected, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

async function serveAsset(urlPath: string, opts: HttpServerOptions): Promise<Response> {
  const assetPath = resolveAssetPath(urlPath);
  if (!assetPath) {
    // SPA fallback: any unknown non-API path serves index.html so the
    // React router can render the correct screen.
    const indexPath = resolveAssetPath("/index.html");
    if (!indexPath) return notFound();
    return serveHtmlWithRuntimeConfig(indexPath, opts);
  }
  // HTML entries (/, index.html) get runtime config injected so the
  // dashboard boots against the right InstantDB app after onboarding.
  const isHtml = urlPath === "/" || urlPath.endsWith(".html");
  if (isHtml) {
    return serveHtmlWithRuntimeConfig(assetPath, opts);
  }
  const headers: Record<string, string> = { "content-type": contentTypeFor(urlPath) };
  // Hashed asset filenames (Vite emits `index-<hash>.js` etc.) are
  // content-addressed so they can safely be cached forever.
  if (/\/assets\/[^/]+-[A-Za-z0-9_-]{6,}\.[a-z]+$/.test(urlPath)) {
    headers["cache-control"] = "public, max-age=31536000, immutable";
  } else {
    headers["cache-control"] = "no-store";
  }
  return new Response(file(assetPath), { headers });
}

/**
 * Build the redacted config view for GET /api/config. Admin token and
 * any other secret fields are replaced with a stable indicator so the
 * dashboard can show "configured" without being able to read the token.
 */
function redactConfig(config: Config): Record<string, unknown> {
  return {
    bankSenderIds: config.bankSenderIds,
    messagesDbPath: config.messagesDbPath,
    localBackupPath: config.localBackupPath,
    pollIntervalMs: config.pollIntervalMs,
    instantdb: {
      enabled: config.instantdb.enabled,
      appId: config.instantdb.appId,
      adminToken: config.instantdb.adminToken ? "[redacted]" : "",
    },
    webhook: {
      enabled: config.webhook.enabled,
      url: config.webhook.url,
    },
  };
}

function buildHealth(opts: HttpServerOptions): HealthResponse {
  if (!opts.configured) {
    return {
      state: "unconfigured",
      senders: [],
      transactionCount: 0,
      lastSync: null,
      running: false,
    };
  }
  const status = opts.service?.getStatus();
  return {
    state: status?.running ? "running" : "paused",
    senders: opts.config.bankSenderIds,
    transactionCount: status?.transactionCount ?? 0,
    lastSync: status?.lastSync ? status.lastSync.toISOString() : null,
    running: !!status?.running,
  };
}

export interface HttpServerHandle {
  port: number;
  url: string;
  stop(): void;
}

export function startHttpServer(opts: HttpServerOptions): HttpServerHandle {
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: opts.port,
    async fetch(req) {
      const url = new URL(req.url);
      const path = url.pathname;

      // API surface. All endpoints live under /api/.
      if (path === "/api/health") {
        return json(buildHealth(opts));
      }
      if (path === "/api/config") {
        return json(redactConfig(opts.config));
      }
      if (path === "/api/banks") {
        return json(
          allBanks().map((b) => ({ bankKey: b.bankKey, senderIds: b.senderIds }))
        );
      }
      if (path === "/api/setup" && req.method === "GET") {
        return json({
          configured: opts.configured,
          schema: serializeSchema(),
          currentValues: currentSetupValues(opts.config),
        });
      }
      if (path === "/api/preview" && req.method === "POST") {
        let body: { senders?: unknown };
        try {
          body = (await req.json()) as { senders?: unknown };
        } catch {
          return json({ ok: false, error: "Request body must be valid JSON", errorKind: "internal" }, { status: 400 });
        }
        const rawSenders = body.senders;
        if (!Array.isArray(rawSenders) || rawSenders.length === 0) {
          return json(
            { ok: false, error: "`senders` must be a non-empty array of strings.", errorKind: "internal" },
            { status: 400 }
          );
        }
        const senders = rawSenders
          .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
          .map((s) => s.trim());
        if (senders.length === 0) {
          return json(
            { ok: false, error: "`senders` contained no non-empty strings.", errorKind: "internal" },
            { status: 400 }
          );
        }
        const result = previewSenders(senders);
        return json(result, { status: result.ok ? 200 : 200 });
      }
      if (path === "/api/setup" && req.method === "POST") {
        let body: unknown;
        try {
          body = await req.json();
        } catch {
          return json({ ok: false, error: "Request body must be valid JSON" }, { status: 400 });
        }
        const values = (body ?? {}) as FieldMap;
        const result = await applySetup(values);
        if (!result.ok) {
          return json(result, { status: 400 });
        }
        // Swap the running process into the configured state in place:
        // reload config from disk, spin up the parser, and flip the
        // flags so /api/health starts reporting "running" without the
        // user having to restart the binary.
        try {
          const newConfig = loadConfig();
          const newService = new ExpenseTrackerService(newConfig);
          await newService.start();
          // Stop any previous instance just in case this was a reconfigure.
          opts.service?.stop();
          opts.config = newConfig;
          opts.service = newService;
          opts.configured = true;
        } catch (err) {
          // Config is written but the parser failed to start. The user
          // can recover by restarting the binary; we don't roll back.
          return json(
            {
              ok: true,
              completed: result.completed,
              warning: `Config saved but parser failed to start: ${String(err)}. Restart the binary.`,
            },
            { status: 200 }
          );
        }
        return json(result);
      }
      if (path === "/api/exchange-rate" && req.method === "GET") {
        const dateParam = url.searchParams.get("date");
        const langParam = url.searchParams.get("lang");
        const codesParam = url.searchParams.get("codes");

        if (dateParam !== null && !/^\d{4}-\d{2}-\d{2}$/.test(dateParam)) {
          return json({ error: "`date` must be YYYY-MM-DD" }, { status: 400 });
        }
        let language: NbgLanguage = "en";
        if (langParam !== null) {
          if (langParam !== "ka" && langParam !== "en" && langParam !== "ru") {
            return json({ error: "`lang` must be ka, en, or ru" }, { status: 400 });
          }
          language = langParam;
        }
        const filterCodes = codesParam
          ? codesParam.split(",").map((c) => c.trim().toUpperCase()).filter(Boolean)
          : null;

        try {
          const sheet = await getRateSheet({
            date: dateParam ?? undefined,
            language,
          });
          const ratesObj: Record<string, { rate: number; diff: number; change: number; name: string; validFrom: string }> = {};
          for (const [code, r] of sheet.rates) {
            if (filterCodes && !filterCodes.includes(code)) continue;
            ratesObj[code] = {
              rate: r.rate,
              diff: r.diff,
              change: r.change,
              name: r.name,
              validFrom: r.validFrom,
            };
          }
          return json({
            ok: true,
            base: "GEL",
            date: sheet.date,
            language: sheet.language,
            rates: ratesObj,
          });
        } catch (err) {
          if (err instanceof NbgFutureDateError) {
            return json({ ok: false, error: err.message, errorKind: "future-date" }, { status: 400 });
          }
          if (err instanceof NbgDateNotFoundError) {
            return json({ ok: false, error: err.message, errorKind: "no-rates" }, { status: 404 });
          }
          if (err instanceof NbgInvalidLanguageError) {
            return json({ ok: false, error: err.message, errorKind: "bad-language" }, { status: 400 });
          }
          if (err instanceof NbgRequestFailedError) {
            return json({ ok: false, error: err.message, errorKind: "upstream" }, { status: 502 });
          }
          return json({ ok: false, error: String(err), errorKind: "internal" }, { status: 500 });
        }
      }
      if (path.startsWith("/api/")) {
        return json({ error: "unknown endpoint" }, { status: 404 });
      }

      // Static assets + SPA fallback.
      if (req.method !== "GET" && req.method !== "HEAD") {
        return new Response("Method not allowed", { status: 405 });
      }
      return serveAsset(path, opts);
    },
    error(err) {
      console.error("[http] server error:", err);
      return new Response("Internal error", { status: 500 });
    },
  });

  // Bun.serve.port is typed as `number | undefined` but in practice it's
  // always populated after serve() returns. Coerce through the requested
  // port so the return type is honest.
  const boundPort = server.port ?? opts.port;
  const url = `http://127.0.0.1:${boundPort}`;
  console.log(`[http] listening on ${url} (${HAS_EMBEDDED_ASSETS ? "embedded" : "dev"} assets)`);

  return {
    port: boundPort,
    url,
    stop: () => {
      server.stop(true);
    },
  };
}
