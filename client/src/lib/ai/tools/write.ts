// Write tools the model can call to mutate the user's data. Unlike
// readonly tools, these have side effects in InstantDB.
//
// Auto-apply policy (per issue #29):
//   - CREATE  → executes immediately, returns the new entity
//   - EDIT    → must require confirm (renders a card with Apply/Cancel)
//   - DELETE  → must require confirm
//
// Phase 1.0 ships only `create_category` — the simplest auto-apply
// case. Override + remove tools land in Phase 1.1 along with the
// confirm-card UX.
//
// Tools call `db.transact()` directly via the imported singleton
// (matches the pattern in client/src/hooks/useCategories.ts). The
// singleton already handles the demo-mode swap in dev, so write tools
// against `?demo=1` mutate the in-memory store, not the user's
// InstantDB app.

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
      "Creates a new spending category. AUTO-APPLIES — the new category appears immediately in the user's category list with no confirmation step (creating an empty category is reversible by deleting it). Returns the new category's id and name. The model should call this when the user asks to make, add, or create a new category. The user can then ask the assistant to move transactions into the new category via apply_category_override (added in a follow-up).",
    inputSchema: {
      type: "object",
      properties: {
        name: {
          type: "string",
          description: "Display name for the new category (e.g. 'Coffee shops', 'Pet care'). Required.",
        },
        color: {
          type: "string",
          description: "Optional hex color for the category dot (e.g. '#FF5A3A'). If omitted, a default is picked based on the name.",
        },
        icon: {
          type: "string",
          description: "Optional one-character glyph rendered next to the category name. If omitted, a default is picked based on the name.",
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

    // Reject duplicate names case-insensitively. The user can have a
    // "Coffee" category and not see a confusing "Coffee" / "coffee"
    // pair appear after the assistant's call. Better to surface the
    // collision as a tool error so the model can decide what to do
    // (mention the existing category, suggest a different name, etc.)
    // than silently create a parallel one.
    const existing = ctx.categories.find(
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

export const WRITE_TOOLS: AITool[] = [createCategory];
