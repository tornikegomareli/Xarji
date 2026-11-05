import { homedir } from "os";
import { join, resolve } from "path";
import { mkdir, rm, readFile, writeFile } from "fs/promises";
import { existsSync } from "fs";
import {
  CONFIG_DIR,
  LAUNCHD_PLIST_PATH,
  defaultConfig,
  loadConfig,
  patchConfig,
  saveConfig,
} from "./config";
import { MessagesDbReader } from "./db-reader";
import { parseMessages } from "./parser";
import { StateDb, ensureStateDbDir } from "./state-db";
import { buildTestEvent, sendWebhook } from "./sync";
import * as tui from "./tui";

const SERVICE_NAME = "com.xarji";
const BUN_PATH = process.execPath; // Path to bun executable
const SERVICE_DIR = resolve(import.meta.dir, "..");

/**
 * Generate launchd plist content
 */
function generatePlist(webhookUrl?: string): string {
  const indexPath = join(SERVICE_DIR, "src", "index.ts");
  const logPath = join(CONFIG_DIR, "service.log");
  const errorLogPath = join(CONFIG_DIR, "service.error.log");

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${SERVICE_NAME}</string>

    <key>ProgramArguments</key>
    <array>
        <string>${BUN_PATH}</string>
        <string>run</string>
        <string>${indexPath}</string>
    </array>

    <key>WorkingDirectory</key>
    <string>${SERVICE_DIR}</string>

    <key>RunAtLoad</key>
    <true/>

    <key>KeepAlive</key>
    <true/>

    <key>StandardOutPath</key>
    <string>${logPath}</string>

    <key>StandardErrorPath</key>
    <string>${errorLogPath}</string>

    <key>EnvironmentVariables</key>
    <dict>
        <key>PATH</key>
        <string>/usr/local/bin:/usr/bin:/bin:/opt/homebrew/bin</string>
    </dict>

    <key>ProcessType</key>
    <string>Background</string>

    <key>LowPriorityIO</key>
    <true/>
</dict>
</plist>`;
}

/**
 * Save credentials to .env file
 */
async function saveEnvFile(credentials: {
  appId?: string;
  adminToken?: string;
}): Promise<void> {
  const envPath = join(SERVICE_DIR, ".env");
  let content = "";

  if (credentials.appId) {
    content += `INSTANT_APP_ID=${credentials.appId}\n`;
  }
  if (credentials.adminToken) {
    content += `INSTANT_ADMIN_TOKEN=${credentials.adminToken}\n`;
  }

  await writeFile(envPath, content);
}

/**
 * Load credentials from .env file
 */
function loadEnvFile(): { appId?: string; adminToken?: string } {
  const envPath = join(SERVICE_DIR, ".env");

  try {
    const content = require("fs").readFileSync(envPath, "utf-8");
    const lines = content.split("\n");
    const result: { appId?: string; adminToken?: string } = {};

    for (const line of lines) {
      const [key, value] = line.split("=");
      if (key === "INSTANT_APP_ID") {
        result.appId = value?.trim();
      } else if (key === "INSTANT_ADMIN_TOKEN") {
        result.adminToken = value?.trim();
      }
    }

    return result;
  } catch {
    return {};
  }
}

/**
 * Interactive install wizard
 */
async function install(): Promise<void> {
  tui.title("xarji Setup");
  tui.println();

  // Step 1: InstantDB Configuration
  tui.step(1, 4, "InstantDB Configuration");
  tui.info("Get credentials at: https://instantdb.com/dash");
  tui.println();

  const existingEnv = loadEnvFile();

  const appId = await tui.prompt("InstantDB App ID", existingEnv.appId);
  const adminToken = await tui.prompt(
    "InstantDB Admin Token",
    existingEnv.adminToken ? existingEnv.adminToken.slice(0, 8) + "..." : undefined
  );

  const finalToken = adminToken.endsWith("...") ? existingEnv.adminToken || "" : adminToken;

  // Step 2: Optional Webhook
  tui.step(2, 4, "Additional Sync Options");
  const useWebhook = await tui.confirm("Enable webhook sync?", false);
  let webhookUrl = "";

  if (useWebhook) {
    webhookUrl = await tui.prompt("Webhook URL");
  }

  // Step 3: Save Configuration
  tui.step(3, 4, "Saving Configuration");

  await tui.spinner("Saving credentials to .env", async () => {
    await saveEnvFile({ appId, adminToken: finalToken });
  });

  await tui.spinner("Creating config directory", async () => {
    await mkdir(CONFIG_DIR, { recursive: true });
  });

  await tui.spinner("Saving service configuration", async () => {
    await saveConfig({
      instantdb: {
        enabled: !!(appId && finalToken),
        appId: appId || "",
        adminToken: finalToken || "",
      },
      webhook: {
        enabled: !!webhookUrl,
        url: webhookUrl,
        headers: { "Content-Type": "application/json" },
      },
    });
  });

  await tui.spinner("Initializing state database", async () => {
    await ensureStateDbDir();
    const stateDb = new StateDb();
    stateDb.close();
  });

  // Step 4: Install Service
  tui.step(4, 4, "Installing Service");

  const launchAgentsDir = join(homedir(), "Library", "LaunchAgents");
  await mkdir(launchAgentsDir, { recursive: true });

  await tui.spinner("Creating launchd plist", async () => {
    const plistContent = generatePlist();
    await writeFile(LAUNCHD_PLIST_PATH, plistContent);
  });

  await tui.spinner("Starting service", async () => {
    Bun.spawnSync(["launchctl", "unload", LAUNCHD_PLIST_PATH]);
    const result = Bun.spawnSync(["launchctl", "load", LAUNCHD_PLIST_PATH]);
    if (result.exitCode !== 0) {
      throw new Error("Failed to load service");
    }
  });

  // Summary
  tui.println();
  tui.box(
    [
      tui.chalk.bold("Setup Complete!"),
      "",
      `Config: ${CONFIG_DIR}`,
      `InstantDB: ${appId ? "enabled" : "disabled"}`,
      `Webhook: ${webhookUrl || "disabled"}`,
    ].join("\n")
  );

  tui.println();
  tui.info("Useful commands:");
  tui.kv("Status", "bun run src/cli.ts status");
  tui.kv("Test", "bun run src/cli.ts test");
  tui.kv("Logs", "tail -f ~/.xarji/service.log");
  tui.println();

  tui.close();
}

/**
 * Uninstall the service
 */
async function uninstall(): Promise<void> {
  console.log("Uninstalling xarji service...\n");

  // 1. Unload the service
  console.log("1. Unloading service...");
  if (existsSync(LAUNCHD_PLIST_PATH)) {
    const result = Bun.spawnSync(["launchctl", "unload", LAUNCHD_PLIST_PATH]);
    if (result.exitCode === 0) {
      console.log("   Service unloaded");
    }

    // 2. Remove plist
    console.log("2. Removing plist...");
    await rm(LAUNCHD_PLIST_PATH, { force: true });
    console.log("   Removed: " + LAUNCHD_PLIST_PATH);
  } else {
    console.log("   Service was not installed");
  }

  console.log("\n" + "=".repeat(50));
  console.log("Uninstallation complete!");
  console.log("=".repeat(50));
  console.log("\nNote: Configuration and transaction data preserved at:");
  console.log(`  ${CONFIG_DIR}`);
  console.log("\nTo remove all data, run:");
  console.log(`  rm -rf ${CONFIG_DIR}`);
}

/**
 * Show service status
 */
async function status(): Promise<void> {
  console.log("xarji Status\n");
  console.log("=".repeat(50));

  // Check if plist exists
  const plistExists = existsSync(LAUNCHD_PLIST_PATH);
  console.log(`Installed: ${plistExists ? "Yes" : "No"}`);

  if (!plistExists) {
    console.log("\nRun 'bun run install-service' to install the service.");
    return;
  }

  // Check if service is running
  const result = Bun.spawnSync(["launchctl", "list", SERVICE_NAME]);
  const isRunning = result.exitCode === 0;
  console.log(`Running: ${isRunning ? "Yes" : "No"}`);

  // Check state database
  try {
    const stateDb = new StateDb();
    const txCount = stateDb.getTransactionCount();
    const syncState = stateDb.getSyncState(defaultConfig.bankSenderIds[0]);

    console.log(`\nTransactions processed: ${txCount}`);
    if (syncState) {
      console.log(`Last sync: ${syncState.lastSyncAt.toISOString()}`);
      console.log(`Last message ID: ${syncState.lastMessageId}`);
    }

    stateDb.close();
  } catch {
    console.log("\nState database not initialized yet.");
  }

  // Show config
  console.log(`\nConfiguration:`);
  console.log(`  Bank senders: ${defaultConfig.bankSenderIds.join(", ")}`);
  console.log(`  Local backup: ${defaultConfig.localBackupPath}`);
  console.log(`  InstantDB: ${defaultConfig.instantdb.enabled ? "enabled (App: " + defaultConfig.instantdb.appId + ")" : "disabled"}`);
  console.log(`  Webhook: ${defaultConfig.webhook.enabled ? defaultConfig.webhook.url : "disabled"}`);

  // Check for logs
  const logPath = join(CONFIG_DIR, "service.log");
  if (existsSync(logPath)) {
    console.log(`\nRecent logs:`);
    const logs = await readFile(logPath, "utf-8");
    const lines = logs.trim().split("\n").slice(-10);
    for (const line of lines) {
      console.log(`  ${line}`);
    }
  }

  console.log("\n" + "=".repeat(50));
}

/**
 * Test parsing messages (without syncing)
 */
async function test(): Promise<void> {
  console.log("Testing xarji...\n");

  try {
    const reader = new MessagesDbReader();

    console.log("Bank senders configured:", defaultConfig.bankSenderIds);
    console.log("");

    for (const senderId of defaultConfig.bankSenderIds) {
      console.log(`\nMessages from ${senderId}:`);
      console.log("-".repeat(40));

      const messages = reader.getMessagesBySender(senderId, 5);

      if (messages.length === 0) {
        console.log("  No messages found");
        continue;
      }

      const { success, failed } = parseMessages(messages);

      console.log(`  Found: ${messages.length} messages`);
      console.log(`  Parsed: ${success.length} transactions`);
      console.log(`  Failed: ${failed.length} messages`);

      if (success.length > 0) {
        console.log("\n  Recent transactions:");
        for (const tx of success.slice(0, 3)) {
          const amountStr = tx.amount !== null ? tx.amount.toFixed(2) : "N/A";
          const statusIcon = tx.status === "success" ? "✓" : "✗";
          console.log(
            `    ${statusIcon} ${tx.transactionDate.toISOString().split("T")[0]} | ${tx.currency} ${amountStr} | ${tx.merchant || "Unknown"}`
          );
        }
      }
    }

    reader.close();
  } catch (error) {
    console.error("Error:", error);
    if (String(error).includes("unable to open")) {
      console.log("\nNote: Make sure Full Disk Access is enabled for your terminal.");
    }
  }
}

/**
 * Configure webhook
 */
async function configureWebhook(url: string, secret?: string): Promise<void> {
  // patchConfig on a missing file would write a default config and make
  // the install look configured without InstantDB credentials.
  if (!existsSync(join(CONFIG_DIR, "config.json"))) {
    console.log("Finish onboarding first: ~/.xarji/config.json does not exist yet.");
    process.exit(1);
  }

  await patchConfig({
    webhook: {
      enabled: true,
      url,
      ...(secret ? { headers: { Authorization: `Bearer ${secret}` } } : {}),
    },
  });

  console.log(`Webhook URL set to: ${url}`);
  if (secret) console.log("Secret saved as the Authorization: Bearer header.");
  console.log("\nRestart Xarji to apply: quit it from the menu bar and open it again.");
  console.log("If you run the launchd service from `install` instead:");
  console.log("  launchctl unload " + LAUNCHD_PLIST_PATH);
  console.log("  launchctl load " + LAUNCHD_PLIST_PATH);
}

async function testWebhook(): Promise<void> {
  const { webhook } = loadConfig();
  if (!webhook.url) {
    console.log("No webhook URL configured. Run: bun run src/cli.ts set-webhook <url> --secret <value>");
    process.exit(1);
  }

  const body = JSON.stringify(buildTestEvent());

  try {
    const status = await sendWebhook(webhook, body);
    console.log(`POST ${webhook.url} -> HTTP ${status}`);
    if (status < 200 || status >= 300) process.exit(1);
  } catch (error) {
    console.log(`POST ${webhook.url} failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exit(1);
  }
}

/**
 * Configure InstantDB
 */
async function configureInstantDB(appId: string, adminToken: string): Promise<void> {
  console.log("Configuring InstantDB...\n");

  await saveConfig({
    instantdb: {
      enabled: true,
      appId,
      adminToken,
    },
  });

  console.log(`InstantDB App ID: ${appId}`);
  console.log(`InstantDB Admin Token: ${adminToken.slice(0, 8)}...`);
  console.log("\nRestart the service to apply changes:");
  console.log("  launchctl unload " + LAUNCHD_PLIST_PATH);
  console.log("  launchctl load " + LAUNCHD_PLIST_PATH);
}

// CLI argument parsing
const args = process.argv.slice(2);
const command = args[0];

switch (command) {
  case "install":
    await install();
    break;

  case "uninstall":
    await uninstall();
    break;

  case "status":
    await status();
    break;

  case "test":
    await test();
    break;

  case "set-webhook":
    if (args[1] && (args[2] === undefined || (args[2] === "--secret" && args[3]))) {
      await configureWebhook(args[1], args[3]);
    } else {
      console.log("Usage: bun run src/cli.ts set-webhook <url> [--secret <value>]");
    }
    break;

  case "test-webhook":
    await testWebhook();
    break;

  case "set-instantdb":
    if (args[1] && args[2]) {
      await configureInstantDB(args[1], args[2]);
    } else {
      console.log("Usage: bun run src/cli.ts set-instantdb <app-id> <admin-token>");
      console.log("\nYou can also set via environment variables:");
      console.log("  INSTANT_APP_ID=<app-id>");
      console.log("  INSTANT_ADMIN_TOKEN=<admin-token>");
    }
    break;

  default:
    console.log("xarji CLI\n");
    console.log("Usage:");
    console.log("  bun run src/cli.ts install                         Interactive setup wizard");
    console.log("  bun run src/cli.ts uninstall                       Remove the service");
    console.log("  bun run src/cli.ts status                          Show service status");
    console.log("  bun run src/cli.ts test                            Test message parsing");
    console.log("  bun run src/cli.ts set-webhook <url> [--secret <value>]  Configure webhook URL + Bearer secret");
    console.log("  bun run src/cli.ts test-webhook                    Send a test event to the webhook");
    console.log("  bun run src/cli.ts set-instantdb <app-id> <token>  Configure InstantDB");
}
