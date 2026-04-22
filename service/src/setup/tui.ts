/**
 * Terminal setup wizard.
 *
 * This replaces the hand-rolled prompt flow that used to live directly
 * in setup.ts. The actual prompts are now schema-driven: each field's
 * kind, help text, validator and default all come from ./schema.ts, so
 * adding a new field doesn't require changing the TUI.
 *
 * Spinner messages for each applySetup step come from ./apply.ts via
 * its onProgress callback.
 */

import { access } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import * as tui from "../tui";
import { FIELDS, STEPS, type FieldDef, type FieldMap } from "./schema";
import { applySetup, type ApplyStep } from "./apply";

async function checkFullDiskAccess(): Promise<boolean> {
  const chatDbPath = join(homedir(), "Library", "Messages", "chat.db");
  try {
    await access(chatDbPath);
    return true;
  } catch {
    return false;
  }
}

async function promptField(field: FieldDef, currentValues: FieldMap): Promise<unknown> {
  // Each kind has its own prompt strategy. Re-prompt on validation
  // failure so the user doesn't have to restart the whole wizard.
  while (true) {
    let raw: unknown;
    if (field.kind === "multiselect") {
      const opts = field.options ?? [];
      tui.println();
      opts.forEach((o, i) => {
        tui.println(`  ${tui.chalk.dim(`${i + 1}.`)} ${o.label} ${tui.chalk.dim(`(${o.id})`)}`);
      });
      tui.println();
      const raw$ = await tui.prompt(
        `  ${field.label} — numbers separated by comma`,
        "1"
      );
      const indices = raw$
        .split(",")
        .map((s) => parseInt(s.trim(), 10) - 1)
        .filter((i) => i >= 0 && i < opts.length);
      raw = indices.map((i) => opts[i].id);
    } else if (field.kind === "boolean") {
      raw = await tui.confirm(`  ${field.label}`, (field.default as boolean | undefined) ?? false);
    } else {
      // string + secret share the same underlying prompt. The current
      // tui.prompt doesn't mask input for secrets; that's a pre-existing
      // limitation, not something this refactor introduces.
      const defaultVal = typeof field.default === "string" ? field.default : undefined;
      raw = await tui.prompt(`  ${field.label}`, defaultVal);
    }

    const err = field.validate?.(raw, { ...currentValues, [field.id]: raw });
    if (err) {
      tui.error(err);
      continue;
    }
    return raw;
  }
}

export async function runSetupTui(): Promise<number> {
  tui.println();
  tui.println(tui.chalk.bold("  ხარჯი — xarji setup"));
  tui.println(tui.chalk.dim("  Finance manager for Georgian banks"));
  tui.println();

  const values: FieldMap = {};

  // Preview steps render live data in the web wizard; in the terminal
  // we skip them (keeping the TUI behaviour identical to what it was
  // before the preview step landed) rather than half-implementing a
  // textual preview that would just duplicate what `bun run
  // src/diagnose-month.ts` already does.
  const interactiveSteps = STEPS.filter((s) => (s.kind ?? "fields") === "fields");
  for (let i = 0; i < interactiveSteps.length; i++) {
    const step = interactiveSteps[i];
    tui.step(i + 1, interactiveSteps.length + 2, step.title);
    if (step.subtitle) {
      tui.println();
      tui.info(`  ${step.subtitle}`);
    }
    for (const fieldId of step.fieldIds) {
      const field = FIELDS[fieldId];
      if (!field) continue;
      if (field.help) {
        tui.println();
        tui.info(`  ${field.help}`);
      }
      values[fieldId] = await promptField(field, values);
    }
    tui.println();
  }

  // Permissions check — informational, not part of the schema because
  // it's a macOS thing rather than a config field.
  tui.step(interactiveSteps.length + 1, interactiveSteps.length + 2, "macOS Permissions");
  tui.println();
  const hasDisk = await checkFullDiskAccess();
  if (hasDisk) {
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
      return 0;
    }
  }
  tui.println();

  // Persistence + bootstrap.
  tui.step(interactiveSteps.length + 2, interactiveSteps.length + 2, "Saving configuration");
  tui.println();

  const stepLabels: Record<ApplyStep, string> = {
    validate: "Validating inputs",
    config: "Writing config.json",
    env: "Writing service + client .env",
    "state-db": "Initialising state database",
    "bootstrap-attrs": "Creating InstantDB attributes",
    "bootstrap-schema": "Applying schema metadata",
  };

  const result = await applySetup(values, {
    onProgress: async (p) => {
      const label = stepLabels[p.step];
      if (p.ok) {
        tui.success(label);
      } else {
        tui.error(`${label} — ${p.message ?? "failed"}`);
      }
    },
  });

  tui.close();

  if (!result.ok) {
    tui.println();
    tui.error(`Setup failed at '${result.failedAt}': ${result.error ?? "unknown error"}`);
    if (result.fieldErrors) {
      for (const [id, msg] of Object.entries(result.fieldErrors)) {
        tui.error(`  ${id}: ${msg}`);
      }
    }
    return 1;
  }

  const appId = String(values.instantAppId ?? "");
  const bankLabels = (values.bankSenderIds as string[])
    .map((id) => FIELDS.bankSenderIds.options?.find((o) => o.id === id)?.label ?? id);

  tui.println();
  tui.box(
    [
      tui.chalk.bold("Setup complete!"),
      "",
      `Config:     ~/.xarji/config.json`,
      `Banks:      ${bankLabels.join(", ")}`,
      `InstantDB:  ${appId.slice(0, 8)}…`,
      "",
      tui.chalk.bold("Next steps:"),
      "",
      `  ${tui.chalk.dim("1.")} Start the service:  ${tui.chalk.cyan("bun run start")}`,
      `  ${tui.chalk.dim("2.")} Open the dashboard: ${tui.chalk.cyan("http://127.0.0.1:8721")}`,
    ].join("\n"),
    { title: "ხარჯი" }
  );
  tui.println();
  return 0;
}
