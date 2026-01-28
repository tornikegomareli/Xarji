import { homedir } from "os";
import { join } from "path";

export interface Config {
  // Messages database path
  messagesDbPath: string;

  // Bank sender IDs to monitor
  bankSenderIds: string[];

  // State database for deduplication
  stateDbPath: string;

  // Local backup path
  localBackupPath: string;

  // InstantDB configuration
  instantdb: {
    enabled: boolean;
    appId: string;
    adminToken: string;
  };

  // Webhook configuration (optional, in addition to InstantDB)
  webhook: {
    enabled: boolean;
    url: string;
    headers?: Record<string, string>;
  };

  // Polling interval in milliseconds (fallback if file watching fails)
  pollIntervalMs: number;

  // Regex patterns for parsing
  patterns: {
    payment: {
      trigger: RegExp;
      amount: RegExp;
    };
    card: RegExp;
    date: RegExp;
    plusEarned: RegExp;
    plusTotal: RegExp;
  };
}

const home = homedir();

// Default configuration
export const defaultConfig: Config = {
  messagesDbPath: join(home, "Library", "Messages", "chat.db"),

  bankSenderIds: ["SOLO"],

  stateDbPath: join(home, ".sms-expense-tracker", "state.db"),

  localBackupPath: join(home, ".sms-expense-tracker", "transactions.json"),

  instantdb: {
    enabled: false,
    appId: process.env.INSTANT_APP_ID || "",
    adminToken: process.env.INSTANT_ADMIN_TOKEN || "",
  },

  webhook: {
    enabled: false,
    url: "",
    headers: {
      "Content-Type": "application/json",
    },
  },

  pollIntervalMs: 60000, // 1 minute fallback

  patterns: {
    payment: {
      trigger: /გადახდა:/,
      amount: /გადახდა:\s*([A-Z]{3})([\d,]+\.?\d*)/,
    },
    card: /Card:\*{3}(\d+)/,
    date: /(\d{2}\.\d{2}\.\d{4})/,
    plusEarned: /დაგერიცხებათ:\s*([\d,]+\.?\d*)\s*PLUS/,
    plusTotal: /სულ:\s*([\d,]+\.?\d*)\s*PLUS/,
  },
};

// Load config from file if exists, otherwise use defaults
export function loadConfig(): Config {
  const configPath = join(home, ".sms-expense-tracker", "config.json");

  try {
    const file = Bun.file(configPath);
    // Use sync read for initialization
    const text = require("fs").readFileSync(configPath, "utf-8");
    const userConfig = JSON.parse(text);
    return { ...defaultConfig, ...userConfig };
  } catch {
    // Config file doesn't exist or is invalid, use defaults
  }

  return defaultConfig;
}

// Save config to file
export async function saveConfig(config: Partial<Config>): Promise<void> {
  const configDir = join(home, ".sms-expense-tracker");
  const configPath = join(configDir, "config.json");

  // Ensure directory exists
  await Bun.$`mkdir -p ${configDir}`;

  const merged = { ...defaultConfig, ...config };

  // Convert RegExp to strings for JSON serialization
  const serializable = {
    ...merged,
    patterns: undefined, // Don't save patterns, use defaults
  };

  await Bun.write(configPath, JSON.stringify(serializable, null, 2));
}

export const CONFIG_DIR = join(home, ".sms-expense-tracker");
export const LAUNCHD_PLIST_PATH = join(
  home,
  "Library",
  "LaunchAgents",
  "com.smsexpensetracker.plist"
);
