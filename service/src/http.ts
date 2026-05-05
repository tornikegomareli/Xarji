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
import { patchConfig, CONFIG_PATH } from "./config";
import { getProvider, serialiseEvent } from "./ai";
import type { AIProviderId, AIStreamRequest } from "./ai/types";
import { deleteTransaction } from "./instant-sync";

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

// Allowlist of `Origin` / `Referer` values accepted by state-changing
// endpoints. The service binds 127.0.0.1 only, but a malicious page the
// user is visiting can still POST to it cross-origin via a plain HTML
// form (no preflight, response unreadable but the side effect lands).
// Reject anything that doesn't originate from the dashboard itself.
const SAFE_ORIGINS = new Set([
  "http://127.0.0.1:8721",
  "http://localhost:8721",
  // Vite dev server proxies /api → 8721 with `changeOrigin: false` so
  // requests still carry the dev origin in the Origin header.
  "http://127.0.0.1:5173",
  "http://localhost:5173",
]);

/**
 * Reject a state-changing request that doesn't carry an Origin / Referer
 * matching the dashboard. Returns a 403 Response on rejection, null on
 * pass. Apply to every POST/PUT/DELETE handler that mutates state, not
 * just the visible-to-the-user ones — a CSRF that forces a benign-looking
 * sync still leaks transactions to the user's downstream targets.
 */
function assertSafeOrigin(req: Request): Response | null {
  const origin = req.headers.get("origin");
  if (origin) {
    return SAFE_ORIGINS.has(origin)
      ? null
      : json({ error: "Forbidden: cross-origin request" }, { status: 403 });
  }
  // Browsers always send `Origin` on POST since 2017. Fall back to
  // `Referer` for non-browser clients (curl, the menu-bar app) and
  // require it match. If neither is present, reject — a missing Origin
  // on a POST is suspicious.
  const referer = req.headers.get("referer");
  if (!referer) {
    return json({ error: "Forbidden: missing Origin" }, { status: 403 });
  }
  try {
    const refOrigin = new URL(referer).origin;
    return SAFE_ORIGINS.has(refOrigin)
      ? null
      : json({ error: "Forbidden: cross-origin request" }, { status: 403 });
  } catch {
    return json({ error: "Forbidden: malformed Referer" }, { status: 403 });
  }
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
    // 0 = no socket idle cutoff. Required for `/api/ai/stream`, which
    // returns a long-lived SSE response that can sit silent for >60s
    // during a slow upstream LLM call or a multi-step tool loop with
    // no heartbeat between events. The earlier 60s default would cut
    // those streams mid-response with no retry signal to the client.
    // Localhost-only service with bounded clients (just the dashboard
    // tab + the menu-bar app), so the historical "reclaim idle sockets"
    // motivation doesn't apply.
    idleTimeout: 0,
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
      if (path === "/api/sync" && req.method === "POST") {
        const csrf = assertSafeOrigin(req);
        if (csrf) return csrf;
        if (!opts.service) return json({ error: "Service not running" }, { status: 503 });
        const outcome = await opts.service.processNewMessages();
        return json(outcome);
      }
      if (path === "/api/transactions/delete" && req.method === "POST") {
        const csrf = assertSafeOrigin(req);
        if (csrf) return csrf;
        if (!opts.service || !opts.service.stateDb) {
          return json({ error: "Service not running" }, { status: 503 });
        }
        const stateDb = opts.service.stateDb;
        let body: { transactionId?: string; instantId?: string; kind?: string };
        try {
          body = (await req.json()) as typeof body;
        } catch {
          return json({ error: "Invalid JSON body" }, { status: 400 });
        }
        const { transactionId, instantId, kind } = body;
        if (typeof transactionId !== "string" || !transactionId) {
          return json({ error: "`transactionId` is required" }, { status: 400 });
        }
        if (typeof instantId !== "string" || !instantId) {
          return json({ error: "`instantId` is required" }, { status: 400 });
        }
        if (kind !== "payment" && kind !== "credit" && kind !== "failedPayment") {
          return json(
            { error: "`kind` must be 'payment', 'credit', or 'failedPayment'" },
            { status: 400 }
          );
        }
        // Delete from InstantDB FIRST. If the InstantDB delete fails the
        // tombstone is never written, so on next sync the SMS does NOT
        // get blocked from re-importing — the user keeps the row and
        // can retry. Reversed order would orphan a tombstone on a failed
        // delete and silently drop the SMS forever.
        const deleteResult = await deleteTransaction(instantId, kind, transactionId);
        if (!deleteResult.success) {
          return json(
            { deleted: false, error: deleteResult.error ?? "delete failed" },
            { status: 502 }
          );
        }
        try {
          stateDb.markTransactionDeleted(transactionId, kind);
        } catch (err) {
          // Tombstone failed but InstantDB delete succeeded. The user
          // sees the row gone; on next sync the SMS will re-import.
          // Log loudly so we can spot this in real usage.
          const message = err instanceof Error ? err.message : String(err);
          console.error(
            `[delete] tombstone write failed for ${transactionId}: ${message} — row will re-import on next sync`
          );
          return json({ deleted: true, tombstoned: false, warning: message });
        }
        return json({ deleted: true, tombstoned: true });
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
      if (path === "/api/ai/keys" && req.method === "GET") {
        // Boolean presence only — never echo the key value back.
        const keys = opts.config.aiProviderKeys ?? {};
        return json({
          anthropic: !!keys.anthropic,
          openai: !!keys.openai,
        });
      }

      if (path === "/api/ai/keys" && req.method === "POST") {
        let body: { provider?: unknown; apiKey?: unknown };
        try {
          body = (await req.json()) as { provider?: unknown; apiKey?: unknown };
        } catch {
          return json({ error: "Body must be valid JSON" }, { status: 400 });
        }
        const provider = body.provider;
        const apiKey = body.apiKey;
        if (provider !== "anthropic" && provider !== "openai") {
          return json({ error: "`provider` must be 'anthropic' or 'openai'" }, { status: 400 });
        }
        if (typeof apiKey !== "string" || apiKey.trim().length < 20) {
          return json({ error: "`apiKey` must be a non-empty string" }, { status: 400 });
        }
        const next = await patchConfig({
          aiProviderKeys: { [provider]: apiKey.trim() },
        });
        opts.config = next;
        return json({ ok: true });
      }

      if (path.startsWith("/api/ai/keys/") && req.method === "DELETE") {
        const segments = path.split("/");
        const provider = segments[segments.length - 1];
        if (provider !== "anthropic" && provider !== "openai") {
          return json({ error: "Unknown provider" }, { status: 400 });
        }
        // patchConfig deep-merges so it can't express "remove this key";
        // do a direct read-prune-write instead.
        const cfg = loadConfig();
        const next = { ...(cfg.aiProviderKeys ?? {}) };
        delete next[provider as "anthropic" | "openai"];
        const updated = { ...cfg, aiProviderKeys: next };
        await Bun.write(CONFIG_PATH, JSON.stringify(updated, null, 2));
        opts.config = updated;
        return json({ ok: true });
      }

      if (path === "/api/ai/stream" && req.method === "POST") {
        let body: AIStreamRequest;
        try {
          body = (await req.json()) as AIStreamRequest;
        } catch {
          return json({ error: "Body must be valid JSON" }, { status: 400 });
        }
        const providerId = body.provider as AIProviderId;
        if (providerId !== "anthropic" && providerId !== "openai") {
          return json({ error: "`provider` must be 'anthropic' or 'openai'" }, { status: 400 });
        }
        const apiKey = opts.config.aiProviderKeys?.[providerId];
        if (!apiKey) {
          return json(
            { error: `No API key configured for ${providerId}. Set one via POST /api/ai/keys.` },
            { status: 412 }
          );
        }
        if (!body.model || typeof body.model !== "string") {
          return json({ error: "`model` is required" }, { status: 400 });
        }
        if (!Array.isArray(body.messages) || body.messages.length === 0) {
          return json({ error: "`messages` must be a non-empty array" }, { status: 400 });
        }

        const provider = getProvider(providerId);
        const upstreamAbort = new AbortController();
        // If the dashboard disconnects mid-stream, propagate to the
        // upstream provider so we don't keep paying for tokens nobody
        // will ever read.
        req.signal.addEventListener("abort", () => upstreamAbort.abort());

        const sse = new ReadableStream<Uint8Array>({
          async start(controller) {
            const encoder = new TextEncoder();
            try {
              for await (const event of provider.stream({
                apiKey,
                model: body.model,
                systemPrompt: body.systemPrompt ?? "",
                messages: body.messages,
                tools: body.tools ?? [],
                signal: upstreamAbort.signal,
              })) {
                controller.enqueue(encoder.encode(serialiseEvent(event)));
              }
            } catch (err) {
              const message = err instanceof Error ? err.message : String(err);
              controller.enqueue(
                encoder.encode(serialiseEvent({ kind: "error", error: message }))
              );
            } finally {
              controller.close();
            }
          },
          cancel() {
            upstreamAbort.abort();
          },
        });

        return new Response(sse, {
          headers: {
            "content-type": "text/event-stream; charset=utf-8",
            "cache-control": "no-store",
            "x-accel-buffering": "no",
          },
        });
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
