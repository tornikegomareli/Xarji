/**
 * xarji setup — Interactive onboarding wizard
 *
 * Single command to go from zero to running:
 *   bun run setup
 */

import { homedir } from "os";
import { join, resolve } from "path";
import { mkdir, writeFile, access } from "fs/promises";
import { existsSync } from "fs";
import { init, id } from "@instantdb/admin";
import schema from "./instant-schema";
import { StateDb, ensureStateDbDir } from "./state-db";
import * as tui from "./tui";

const HOME = homedir();
const CONFIG_DIR = join(HOME, ".xarji");
const SERVICE_DIR = resolve(import.meta.dir, "..");
const CLIENT_DIR = resolve(SERVICE_DIR, "..", "client");

// Georgian bank SMS sender IDs
const KNOWN_BANKS: { id: string; name: string }[] = [
  { id: "SOLO", name: "Bank of Georgia (Solo)" },
  { id: "BOG", name: "Bank of Georgia" },
  { id: "TBC", name: "TBC Bank" },
  { id: "LIBERTY", name: "Liberty Bank" },
  { id: "CREDO", name: "Credo Bank" },
  { id: "BASISBANK", name: "Basis Bank" },
  { id: "TERABANK", name: "Tera Bank" },
];

async function checkFullDiskAccess(): Promise<boolean> {
  const chatDbPath = join(HOME, "Library", "Messages", "chat.db");
  try {
    await access(chatDbPath);
    return true;
  } catch {
    return false;
  }
}

async function setup() {
  tui.println();
  tui.println(tui.chalk.bold("  ხარჯი — xarji setup"));
  tui.println(tui.chalk.dim("  Finance manager for Georgian banks"));
  tui.println();

  const totalSteps = 5;

  // ─── Step 1: InstantDB credentials ───
  tui.step(1, totalSteps, "InstantDB Account");
  tui.println();
  tui.info("  Create a free app at: https://instantdb.com/dash");
  tui.info("  Then copy your App ID and Admin Token from the dashboard.");
  tui.println();

  const appId = await tui.prompt("  App ID");
  if (!appId) {
    tui.error("App ID is required. Get one at https://instantdb.com/dash");
    tui.close();
    process.exit(1);
  }

  const adminToken = await tui.prompt("  Admin Token");
  if (!adminToken) {
    tui.error("Admin Token is required. Find it in your InstantDB dashboard.");
    tui.close();
    process.exit(1);
  }

  // ─── Step 2: Pick bank senders ───
  tui.step(2, totalSteps, "Select Your Banks");
  tui.println();

  for (let i = 0; i < KNOWN_BANKS.length; i++) {
    tui.println(`  ${tui.chalk.dim(`${i + 1}.`)} ${KNOWN_BANKS[i].name} ${tui.chalk.dim(`(${KNOWN_BANKS[i].id})`)}`);
  }
  tui.println();

  const bankInput = await tui.prompt("  Enter numbers separated by comma (e.g. 1,3)", "1");
  const selectedIndices = bankInput
    .split(",")
    .map((s) => parseInt(s.trim(), 10) - 1)
    .filter((i) => i >= 0 && i < KNOWN_BANKS.length);

  if (selectedIndices.length === 0) {
    tui.error("No valid banks selected.");
    tui.close();
    process.exit(1);
  }

  const selectedBanks = selectedIndices.map((i) => KNOWN_BANKS[i]);
  const bankSenderIds = selectedBanks.map((b) => b.id);

  tui.println();
  for (const bank of selectedBanks) {
    tui.success(`${bank.name}`);
  }

  // Allow custom sender ID
  const addCustom = await tui.confirm("  Add a custom sender ID?", false);
  if (addCustom) {
    const customId = await tui.prompt("  Custom sender ID");
    if (customId) {
      bankSenderIds.push(customId);
      tui.success(`Custom: ${customId}`);
    }
  }

  // ─── Step 3: Check macOS permissions ───
  tui.step(3, totalSteps, "macOS Permissions");
  tui.println();

  const hasDiskAccess = await checkFullDiskAccess();
  if (hasDiskAccess) {
    tui.success("Full Disk Access is granted");
  } else {
    tui.error("Full Disk Access not detected");
    tui.println();
    tui.println(tui.chalk.yellow("  ⚠  The service needs to read your Messages database."));
    tui.println(tui.chalk.yellow("     Go to: System Settings → Privacy & Security → Full Disk Access"));
    tui.println(tui.chalk.yellow("     Add your terminal app (Terminal, iTerm, Warp, etc.)"));
    tui.println();
    const proceed = await tui.confirm("  Continue setup anyway?", true);
    if (!proceed) {
      tui.info("Re-run setup after granting Full Disk Access.");
      tui.close();
      process.exit(0);
    }
  }

  // ─── Step 4: Save everything ───
  tui.step(4, totalSteps, "Saving Configuration");
  tui.println();

  // Create config directory
  await tui.spinner("Creating config directory", async () => {
    await mkdir(CONFIG_DIR, { recursive: true });
  });

  // Save config.json
  await tui.spinner("Writing config.json", async () => {
    const config = {
      bankSenderIds,
      messagesDbPath: join(HOME, "Library", "Messages", "chat.db"),
      stateDbPath: join(CONFIG_DIR, "state.db"),
      localBackupPath: join(CONFIG_DIR, "transactions.json"),
      instantdb: {
        enabled: true,
        appId,
        adminToken,
      },
      webhook: {
        enabled: false,
        url: "",
      },
      pollIntervalMs: 60000,
    };
    await writeFile(
      join(CONFIG_DIR, "config.json"),
      JSON.stringify(config, null, 2)
    );
  });

  // Save .env for service
  await tui.spinner("Writing service .env", async () => {
    const envContent = `INSTANT_APP_ID=${appId}\nINSTANT_ADMIN_TOKEN=${adminToken}\n`;
    await writeFile(join(SERVICE_DIR, ".env"), envContent);
  });

  // Save client .env
  await tui.spinner("Writing client .env", async () => {
    const envContent = `VITE_INSTANT_APP_ID=${appId}\n`;
    await writeFile(join(CLIENT_DIR, ".env"), envContent);
  });

  // Initialize state DB
  await tui.spinner("Initializing state database", async () => {
    await ensureStateDbDir();
    const stateDb = new StateDb();
    stateDb.close();
  });

  // ─── Step 5: Push schema to InstantDB ───
  tui.step(5, totalSteps, "Setting Up InstantDB");
  tui.println();

  await tui.spinner("Pushing schema to InstantDB", async () => {
    const db = init({ appId, adminToken, schema });

    // Create and delete a test record to ensure schema is applied
    const testId = id();
    await db.transact(
      db.tx.payments[testId].update({
        transactionId: "xarji-setup-test",
        transactionType: "payment",
        amount: 0,
        currency: "GEL",
        merchant: "Schema Test",
        cardLastDigits: "0000",
        transactionDate: Date.now(),
        messageTimestamp: Date.now(),
        syncedAt: Date.now(),
        plusEarned: 0,
        plusTotal: 0,
        bankSenderId: "TEST",
        rawMessage: "Setup schema push",
      })
    );
    await db.transact(db.tx.payments[testId].delete());
  });

  tui.success("Schema pushed successfully");

  // ─── Done ───
  tui.println();
  tui.box(
    [
      tui.chalk.bold("Setup complete!"),
      "",
      `Config:      ${CONFIG_DIR}/config.json`,
      `Banks:       ${selectedBanks.map((b) => b.name).join(", ")}`,
      `InstantDB:   ${appId.slice(0, 8)}...`,
      "",
      tui.chalk.bold("Next steps:"),
      "",
      `  ${tui.chalk.dim("1.")} Start the service:`,
      `     ${tui.primary("cd service && bun run start")}`,
      "",
      `  ${tui.chalk.dim("2.")} Start the client:`,
      `     ${tui.primary("cd client && bun run dev")}`,
      "",
      `  ${tui.chalk.dim("3.")} Open ${tui.primary("http://localhost:5173")}`,
    ].join("\n"),
    { title: "ხარჯი" }
  );

  tui.println();
  tui.close();
}

// Run
setup().catch((err) => {
  tui.error(`Setup failed: ${err.message || err}`);
  tui.close();
  process.exit(1);
});
