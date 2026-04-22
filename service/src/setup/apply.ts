/**
 * applySetup(values) — the persistence + bootstrap step shared by the
 * terminal wizard (`bun run setup`) and the POST /api/setup handler.
 *
 * Takes a schema-validated FieldMap and:
 *   1. Writes ~/.xarji/config.json
 *   2. Writes service/.env and client/.env (for dev-mode runs)
 *   3. Initialises ~/.xarji/state.db
 *   4. Bootstraps the InstantDB app: schemaless pass to create attrs,
 *      schema-backed pass to register unique/indexed metadata
 *
 * Any step can fail; the return value reports the failure and the
 * partial progress so callers can show useful diagnostics.
 */

import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { mkdir, writeFile, unlink } from "node:fs/promises";
import { existsSync } from "node:fs";
import { init, id } from "@instantdb/admin";
import schema from "../instant-schema";
import { StateDb, ensureStateDbDir } from "../state-db";
import { validateAll, type FieldMap } from "./schema";

const HOME = homedir();
const CONFIG_DIR = join(HOME, ".xarji");
const CONFIG_PATH = join(CONFIG_DIR, "config.json");
const SERVICE_DIR = resolve(import.meta.dir, "..", "..");
const CLIENT_DIR = resolve(SERVICE_DIR, "..", "client");

export type ApplyStep =
  | "validate"
  | "config"
  | "env"
  | "state-db"
  | "bootstrap-attrs"
  | "bootstrap-schema";

export interface ApplyProgress {
  step: ApplyStep;
  ok: boolean;
  message?: string;
}

export interface ApplyResult {
  ok: boolean;
  completed: ApplyStep[];
  failedAt?: ApplyStep;
  error?: string;
  /** Errors keyed by field id when validation fails. */
  fieldErrors?: Record<string, string>;
}

export interface ApplyOptions {
  /** Called as each step completes (or fails) so callers can stream progress. */
  onProgress?: (p: ApplyProgress) => void | Promise<void>;
}

interface ExtractedValues {
  appId: string;
  adminToken: string;
  bankSenderIds: string[];
}

function extract(values: FieldMap): ExtractedValues {
  return {
    appId: String(values.instantAppId ?? "").trim(),
    adminToken: String(values.instantAdminToken ?? "").trim(),
    bankSenderIds: (values.bankSenderIds as string[]).map((s) => s.trim()).filter(Boolean),
  };
}

/** Seed rows written during the bootstrap pass to force attribute creation. */
function bootstrapSeed(): Array<{ table: string; data: Record<string, unknown> }> {
  const now = Date.now();
  return [
    {
      table: "payments",
      data: {
        transactionId: "xarji-setup-test",
        transactionType: "payment",
        amount: 0,
        currency: "GEL",
        merchant: "Schema Test",
        cardLastDigits: "0000",
        transactionDate: now,
        messageTimestamp: now,
        syncedAt: now,
        plusEarned: 0,
        plusTotal: 0,
        bankSenderId: "TEST",
        rawMessage: "Setup schema push",
      },
    },
    {
      table: "failedPayments",
      data: {
        transactionId: "xarji-setup-test-failed",
        transactionType: "payment_failed",
        currency: "GEL",
        merchant: "Schema Test",
        cardLastDigits: "0000",
        failureReason: "setup-bootstrap",
        balance: 0,
        transactionDate: now,
        messageTimestamp: now,
        syncedAt: now,
        bankSenderId: "TEST",
        rawMessage: "Setup schema push (failed)",
      },
    },
    {
      table: "categories",
      data: {
        name: "__setup__",
        color: "#000000",
        icon: "·",
        isDefault: false,
      },
    },
    {
      table: "bankSenders",
      data: {
        senderId: "__SETUP__",
        displayName: "Setup Bootstrap",
        enabled: false,
        createdAt: now,
      },
    },
    {
      table: "credits",
      data: {
        transactionId: "xarji-setup-test-credit",
        transactionType: "transfer_in",
        amount: 0,
        currency: "GEL",
        counterparty: "Schema Test",
        cardLastDigits: "0000",
        transactionDate: now,
        messageTimestamp: now,
        syncedAt: now,
        bankSenderId: "TEST",
        rawMessage: "Setup schema push (credit)",
      },
    },
  ];
}

export async function applySetup(
  values: FieldMap,
  opts: ApplyOptions = {}
): Promise<ApplyResult> {
  const report = async (step: ApplyStep, ok: boolean, message?: string) => {
    await opts.onProgress?.({ step, ok, message });
  };

  // 1. Validate
  const fieldErrors = validateAll(values);
  if (Object.keys(fieldErrors).length > 0) {
    await report("validate", false, "Invalid field values");
    return {
      ok: false,
      completed: [],
      failedAt: "validate",
      error: "Invalid field values",
      fieldErrors,
    };
  }
  await report("validate", true);

  const { appId, adminToken, bankSenderIds } = extract(values);
  const completed: ApplyStep[] = ["validate"];

  // Ordering rationale: the InstantDB bootstrap steps (which can fail on
  // bad credentials, permission errors, network blips) must run BEFORE
  // the config file is written to disk. Otherwise a failed bootstrap
  // leaves ~/.xarji/config.json on the filesystem and the next launch
  // treats the install as configured, skipping onboarding and booting
  // against credentials the user already knows don't work.

  // 2a. Bootstrap attributes without schema. `@instantdb/admin` sets
  //     `throw-on-missing-attrs?` when initialised with a schema, so a
  //     brand-new app needs this schemaless pass to auto-create attrs.
  try {
    const bootstrapDb = init({ appId, adminToken });
    for (const { table, data } of bootstrapSeed()) {
      const rowId = id();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tx = (bootstrapDb.tx as any)[table][rowId];
      await bootstrapDb.transact(tx.update(data));
      await bootstrapDb.transact(tx.delete());
    }
    completed.push("bootstrap-attrs");
    await report("bootstrap-attrs", true);
  } catch (err) {
    await report("bootstrap-attrs", false, String(err));
    return { ok: false, completed, failedAt: "bootstrap-attrs", error: String(err) };
  }

  // 2b. Second pass with the schema applied so uniqueness + indexes
  //     register on the now-existing attributes.
  try {
    const schemaDb = init({ appId, adminToken, schema });
    for (const { table, data } of bootstrapSeed()) {
      const rowId = id();
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tx = (schemaDb.tx as any)[table][rowId];
      await schemaDb.transact(tx.update(data));
      await schemaDb.transact(tx.delete());
    }
    completed.push("bootstrap-schema");
    await report("bootstrap-schema", true);
  } catch (err) {
    await report("bootstrap-schema", false, String(err));
    return { ok: false, completed, failedAt: "bootstrap-schema", error: String(err) };
  }

  // From here on we touch the filesystem; if anything fails we rollback
  // the config file so the next launch sees the install as unconfigured.
  const rollbackConfig = async () => {
    try {
      if (existsSync(CONFIG_PATH)) await unlink(CONFIG_PATH);
    } catch {
      // Best-effort — if we can't delete it, the user will have to
      // remove it by hand to retry onboarding. Logged by the caller.
    }
  };

  // 3. Write ~/.xarji/config.json
  try {
    await mkdir(CONFIG_DIR, { recursive: true });
    const config = {
      bankSenderIds,
      messagesDbPath: join(HOME, "Library", "Messages", "chat.db"),
      stateDbPath: join(CONFIG_DIR, "state.db"),
      localBackupPath: join(CONFIG_DIR, "transactions.json"),
      instantdb: { enabled: true, appId, adminToken },
      webhook: { enabled: false, url: "" },
      pollIntervalMs: 60000,
    };
    await writeFile(CONFIG_PATH, JSON.stringify(config, null, 2));
    completed.push("config");
    await report("config", true);
  } catch (err) {
    await report("config", false, String(err));
    return { ok: false, completed, failedAt: "config", error: String(err) };
  }

  // 4. .env files are deliberately NOT written from this path. They used
  // to be a dev convenience but caused two cascading reloads mid-setup:
  // bun --watch restarts when service/.env changes (killing the in-flight
  // POST), and Vite restarts when client/.env changes (triggering a
  // browser reload that races our own). The runtime always reads
  // ~/.xarji/config.json directly, and the client now resolves the
  // InstantDB app id by fetching /api/config when window.__XARJI_APP_ID__
  // is unavailable, so neither file is needed.
  completed.push("env");
  await report("env", true);

  // 5. Initialise state.db
  try {
    await ensureStateDbDir();
    const stateDb = new StateDb();
    stateDb.close();
    completed.push("state-db");
    await report("state-db", true);
  } catch (err) {
    await report("state-db", false, String(err));
    await rollbackConfig();
    return { ok: false, completed, failedAt: "state-db", error: String(err) };
  }

  return { ok: true, completed };
}
