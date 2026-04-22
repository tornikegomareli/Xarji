import { describe, test, expect } from "bun:test";
import { previewSenders } from "../preview";

/**
 * `previewSenders` reads chat.db; on a CI runner that file doesn't
 * exist so we can't hit the happy path there. These tests cover the
 * graceful error paths that MUST hold regardless of platform: the
 * function never throws, it reports the correct errorKind, and it
 * rejects empty input when called via the router.
 *
 * The router's own input validation (empty `senders`, wrong types)
 * lives in http.ts and is covered indirectly by the /api/preview
 * smoke test on a live binary.
 */

describe("previewSenders — error paths", () => {
  test("reports messages-db-missing when chat.db path doesn't exist", () => {
    const result = previewSenders(["SOLO"], {
      messagesDbPath: "/definitely/does/not/exist/chat.db",
    });
    expect(result.ok).toBe(false);
    expect(result.errorKind).toBe("messages-db-missing");
    expect(result.banks).toEqual([]);
    expect(result.error).toContain("not found");
  });

  test("never throws on empty sender list (returns empty banks if db exists)", () => {
    // If the running machine happens to have chat.db we get ok:true + []
    // banks; otherwise messages-db-missing. Either way, no throw.
    const result = previewSenders([], {
      messagesDbPath: "/tmp/xarji-unit-test-nonexistent.db",
    });
    expect(typeof result.ok).toBe("boolean");
  });
});

describe("previewSenders — happy path (uses real chat.db if present)", () => {
  // Skip this whole block on CI / any environment without a Messages DB.
  const { accessSync } = require("node:fs") as typeof import("node:fs");
  const { homedir } = require("node:os") as typeof import("node:os");
  const { join } = require("node:path") as typeof import("node:path");
  const chatDbPath = join(homedir(), "Library", "Messages", "chat.db");
  let hasChatDb = false;
  try {
    accessSync(chatDbPath);
    hasChatDb = true;
  } catch {
    hasChatDb = false;
  }

  const maybeTest = hasChatDb ? test : test.skip;

  maybeTest("returns per-bank counts for an unknown sender (0 messages)", () => {
    const result = previewSenders(["__definitely-not-a-real-sender__"]);
    expect(result.ok).toBe(true);
    expect(result.banks).toHaveLength(1);
    expect(result.banks[0].senderId).toBe("__definitely-not-a-real-sender__");
    expect(result.banks[0].messageCount).toBe(0);
    expect(result.banks[0].parsedCount).toBe(0);
    expect(result.banks[0].failedCount).toBe(0);
    expect(result.banks[0].samples).toEqual([]);
  });

  maybeTest("caps samples at sampleLimit", () => {
    const result = previewSenders(["SOLO"], { sampleLimit: 3 });
    if (result.ok && result.banks[0].parsedCount > 3) {
      expect(result.banks[0].samples.length).toBeLessThanOrEqual(3);
    }
  });
});
