// Deterministic color + icon defaults for categories created without
// explicit visual identity. Re-running with the same name returns the
// same colors/glyph so a user-created category looks stable across
// recreations (and so the AI tool and the manual UI picker pick the
// same defaults — no drift between channels).

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

export function pickCategoryDefaults(name: string): { color: string; icon: string } {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  return {
    color: CATEGORY_PALETTE[hash % CATEGORY_PALETTE.length],
    icon: CATEGORY_ICONS[hash % CATEGORY_ICONS.length],
  };
}
