// Write tools the assistant can call to mutate the user's data.
// Unlike the readonly tools, these have side effects in InstantDB.
//
// Auto-apply policy (decided across issue #29 + #33 reviews):
//   - CREATE   → executes immediately (reversible via /categories ×
//                button or CategoryPicker's "Clear override" button)
//   - EDIT     → auto-apply for category property edits (name / color
//                / icon — pure visual, blast radius zero). Override
//                replacement also auto-applies (one merchant, easily
//                reverted via CategoryPicker).
//   - DELETE   → NOT a tool. The UI's × button on /categories already
//                gates deletion behind a confirm dialog AND cleans up
//                dangling overrides; bypassing that dialog from chat
//                would silently destroy manual categorization state on
//                a single mistaken model call (Codex HIGH on PR #35).
//                The assistant can describe a deletion the user might
//                want and tell them to click × on /categories — that
//                routes through the existing confirm path naturally.
//
// Tools call `db.transact()` directly via the imported singleton
// (matches the pattern in client/src/hooks/useCategories.ts and
// useMerchantOverrides.ts). The singleton handles the demo-mode swap
// in dev, so writes against `?demo=1` mutate the in-memory store and
// never touch the user's real InstantDB app.

import { id } from "@instantdb/react";
import { db } from "../../instant";
import { pickCategoryDefaults } from "../../categoryDefaults";
import type { AITool } from "./types";

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

    const defaults = pickCategoryDefaults(name);
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

const updateCategory: AITool = {
  definition: {
    name: "update_category",
    description:
      "Renames or recolors an existing category. AUTO-APPLIES — the change is reflected immediately. Only works on user-created categories (those with `isDefault: false`); default categories like Groceries / Dining / Subscriptions return an error because changing their visible identity would break the regex categoriser's mapping. At least one of `name`, `color`, `icon` must be provided. Use list_categories to discover ids.",
    inputSchema: {
      type: "object",
      properties: {
        id: {
          type: "string",
          description: "The id of the category to update. Required.",
        },
        name: {
          type: "string",
          description: "New display name. Optional.",
        },
        color: {
          type: "string",
          description: "New hex color (e.g. '#FF5A3A'). Optional.",
        },
        icon: {
          type: "string",
          description: "New one-character glyph for the category dot. Optional.",
        },
      },
      required: ["id"],
    },
  },
  statusText: "Updating the category…",
  executor: async (input, ctx) => {
    const id = typeof input.id === "string" ? input.id : "";
    if (!id) throw new Error("`id` is required.");

    // Validate the id resolves to a non-default DB-backed category.
    // Defaults can't be edited safely — the regex categoriser maps
    // merchants to canonical default ids, which would no longer match
    // a renamed entry. (Allowing default-renames needs a canonicalId
    // schema field — tracked as B.2 in issue #33.)
    const target = ctx.getAllCategories().find((c) => c.id === id);
    if (!target) {
      throw new Error(
        `No category with id "${id}". Call list_categories to see valid ids.`
      );
    }
    const dbRow = ctx.categories.find((c) => c.id === id);
    if (!dbRow) {
      throw new Error(
        `"${target.name}" is a built-in category and can't be edited from chat. The user can rename a category they created themselves on /categories.`
      );
    }
    if (dbRow.isDefault) {
      throw new Error(
        `"${target.name}" is a default category and can't be edited from chat. The user can rename categories they created themselves on /categories.`
      );
    }

    const updates: Record<string, string> = {};
    if (typeof input.name === "string" && input.name.trim()) {
      const newName = input.name.trim();
      // Reject duplicate-name collisions against any other category
      // (case-insensitive). The form on /categories enforces the same
      // rule, so the rules match across channels.
      const collide = ctx.getAllCategories().find(
        (c) => c.id !== id && c.name.toLowerCase() === newName.toLowerCase()
      );
      if (collide) {
        throw new Error(`A category named "${collide.name}" already exists.`);
      }
      updates.name = newName;
    }
    if (typeof input.color === "string") updates.color = input.color;
    if (typeof input.icon === "string") updates.icon = input.icon;
    if (Object.keys(updates).length === 0) {
      throw new Error("At least one of `name`, `color`, `icon` must be provided.");
    }

    await db.transact(db.tx.categories[id].update(updates));

    return {
      id,
      previousName: target.name,
      ...updates,
      updated: true,
    };
  },
};

// `delete_category` deliberately not exposed as a tool. The UI's ×
// button on /categories gates deletion behind window.confirm AND
// triggers the dangling-override cleanup; piping the model around
// that dialog would silently destroy manual categorization state on
// a single mistaken model call. The assistant describes the
// deletion the user might want and points at /categories' × button.

export const WRITE_TOOLS: AITool[] = [
  createCategory,
  applyCategoryOverride,
  updateCategory,
];
