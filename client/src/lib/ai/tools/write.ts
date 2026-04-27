// Write tools the assistant can call to mutate the user's data.
// Unlike the readonly tools, these have side effects in InstantDB.
//
// Auto-apply policy (from issue #29):
//   - CREATE  → executes immediately (reversible via /categories × button
//               or CategoryPicker's "Clear override" button)
//   - EDIT    → would require confirm. Not in this PR — see issue #29
//               for the discussion. Replacing an existing override is
//               technically an EDIT but the blast radius is small (at
//               most one merchant's category) and the user can clear it
//               in /transactions, so apply_category_override permits
//               the replace case.
//   - DELETE  → not exposed as tools. /categories has a × button for
//               categories; /transactions' CategoryPicker has a Clear
//               Override button. Both are 1-click UI actions, so the
//               assistant tells the user to use them rather than
//               carrying confirm-card UX in chat.
//
// Tools call `db.transact()` directly via the imported singleton
// (matches the pattern in client/src/hooks/useCategories.ts and
// useMerchantOverrides.ts). The singleton handles the demo-mode swap
// in dev, so writes against `?demo=1` mutate the in-memory store and
// never touch the user's real InstantDB app.

import { id } from "@instantdb/react";
import { db } from "../../instant";
import type { AITool } from "./types";

const CATEGORY_PALETTE = [
  "#FF5A3A", // coral
  "#4BD9A2", // emerald
  "#6AA3FF", // azure
  "#E8A05A", // amber
  "#B38DF7", // violet
  "#FF7A9E", // rose
  "#F1B84A", // gold
  "#6b7280", // slate (matches Other)
];

const CATEGORY_ICONS = ["◐", "◆", "◉", "✦", "✧", "◇", "✶", "◈"];

/** Pick a deterministic-but-varied default for color/icon when the model
 *  doesn't supply them. The hash is derived from the category name so
 *  re-running create_category with the same name returns the same
 *  visual identity. */
function pickDefaults(name: string): { color: string; icon: string } {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  return {
    color: CATEGORY_PALETTE[hash % CATEGORY_PALETTE.length],
    icon: CATEGORY_ICONS[hash % CATEGORY_ICONS.length],
  };
}

const createCategory: AITool = {
  definition: {
    name: "create_category",
    description:
      "Creates a new spending category. AUTO-APPLIES — the new category appears immediately in the user's category list with no confirmation step. Returns the new category's id and name. The user can rename or delete the category at /categories. Call this when the user asks to make, add, or create a new category, or when they ask to organize transactions in a way that needs a category that doesn't exist yet.",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description:
            "Display name for the new category (e.g. 'Coffee shops', 'Pet care', 'Side hustle expenses'). Required.",
        },
        color: {
          type: "string",
          description:
            "Optional hex color for the category dot (e.g. '#FF5A3A'). If omitted, a default is picked deterministically from the name.",
        },
        icon: {
          type: "string",
          description:
            "Optional one-character glyph rendered next to the category name. If omitted, a default is picked deterministically from the name.",
        },
      },
      required: ["name"],
    },
  },
  statusText: "Creating the category…",
  executor: async (input, ctx) => {
    const name = typeof input.name === "string" ? input.name.trim() : "";
    if (!name) {
      throw new Error("`name` is required and must be a non-empty string.");
    }

    // Reject duplicate names case-insensitively. Use the merged live
    // category list so we catch BOTH persisted DB rows AND
    // DEFAULT_CATEGORIES that aren't yet seeded — the latter is still
    // a real category in the regex categoriser, so a parallel
    // "Subscriptions" would still produce duplicates in pickers.
    // Live getter so a category created earlier in the same agentic
    // loop is visible here.
    const existing = ctx.getAllCategories().find(
      (c) => c.name.toLowerCase() === name.toLowerCase()
    );
    if (existing) {
      throw new Error(
        `A category named "${existing.name}" already exists. The user can move transactions into it without creating a new one.`
      );
    }

    const defaults = pickDefaults(name);
    const color = typeof input.color === "string" ? input.color : defaults.color;
    const icon = typeof input.icon === "string" ? input.icon : defaults.icon;

    const newId = id();
    await db.transact(
      db.tx.categories[newId].update({
        name,
        color,
        icon,
        isDefault: false,
      })
    );

    return {
      id: newId,
      name,
      color,
      icon,
      created: true,
    };
  },
};

const applyCategoryOverride: AITool = {
  definition: {
    name: "apply_category_override",
    description:
      "Maps a merchant to a specific category — every transaction (past and future) from that merchant will categorise under the chosen category instead of the auto-detected one. AUTO-APPLIES (no confirm). Use this when the user asks to move a merchant's transactions to a different category, e.g. 'put all Skola transactions in Coffee shops' or 'move Starbucks to Dining.' If the user wants multiple merchants moved to the same category, call this tool once per merchant. The user can clear the override anytime by clicking the merchant's category badge in /transactions and choosing 'Clear override.'",
    inputSchema: {
      type: "object",
      properties: {
        merchant: {
          type: "string",
          description:
            "The merchant string to map (case-insensitive in matching, but stored as the user wrote it for display). Required.",
        },
        categoryId: {
          type: "string",
          description:
            "The id of the category to map the merchant to. Use list_categories first if you don't already know the id. Required.",
        },
      },
      required: ["merchant", "categoryId"],
    },
  },
  statusText: "Applying the category override…",
  executor: async (input, ctx) => {
    const merchant = typeof input.merchant === "string" ? input.merchant.trim() : "";
    const categoryId = typeof input.categoryId === "string" ? input.categoryId : "";
    if (!merchant) {
      throw new Error("`merchant` is required and must be a non-empty string.");
    }
    if (!categoryId) {
      throw new Error("`categoryId` is required.");
    }

    // Validate the categoryId resolves against the merged live list.
    // A bogus id silently writes a dangling override and the
    // categorizer's defensive fallback hides the bug. Surface as a
    // tool error so the model corrects itself. Live getter so a
    // category created EARLIER IN THE SAME AGENTIC LOOP is visible
    // here — without that, "create Coffee shops" + "move Skola to
    // Coffee shops" in one assistant turn would fail validation on
    // the second call.
    const target = ctx.getAllCategories().find((c) => c.id === categoryId);
    if (!target) {
      throw new Error(
        `No category with id "${categoryId}". Call list_categories first to see the valid ids.`
      );
    }

    // Reuse the existing override row if there is one — keeps the
    // createdAt timestamp stable AND avoids the unique-merchant
    // constraint failing on a fresh id() write. Live getter so an
    // override applied earlier in the same agentic loop is visible.
    const existing = ctx.getOverrides().find(
      (o) => o.merchant.toLowerCase() === merchant.toLowerCase()
    );

    const opId = existing?.id ?? id();
    await db.transact(
      db.tx.merchantCategoryOverrides[opId].update({
        merchant,
        categoryId,
        createdAt: existing?.createdAt ?? Date.now(),
      })
    );

    return {
      merchant,
      categoryId,
      categoryName: target.name,
      replacedExistingOverride: !!existing,
    };
  },
};

export const WRITE_TOOLS: AITool[] = [createCategory, applyCategoryOverride];
