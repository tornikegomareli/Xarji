/**
 * Setup schema — pure data, no runtime side effects.
 *
 * Every entry path (the terminal wizard `bun run setup`, the POST
 * /api/setup handler, and the React onboarding UI) consumes this
 * module. Adding a new field means editing this file and nothing else;
 * validation, rendering, and persistence all fall out of it.
 *
 * Validators are pure functions so the server can re-run them on POST.
 * The serialized form returned by /api/setup keeps only the pieces the
 * client needs (label, regex pattern string, options), not the functions
 * themselves.
 */

export type FieldKind = "string" | "secret" | "multiselect" | "boolean";

export interface FieldOption {
  id: string;
  label: string;
  /** Optional hint rendered alongside the option. */
  hint?: string;
}

export interface FieldDef {
  id: string;
  label: string;
  kind: FieldKind;
  required?: boolean;
  help?: string;
  placeholder?: string;
  default?: unknown;
  /** Validator used by the server + a stringified form for client hints. */
  validate?: (value: unknown, all: FieldMap) => string | null;
  /** Exposed to the client so it can live-validate without shipping a function. */
  patternSource?: string;
  patternMessage?: string;
  /** For multiselect. */
  options?: FieldOption[];
  /** Minimum selections for multiselect. */
  minSelections?: number;
}

export type StepKind = "fields" | "preview";

export interface StepDef {
  id: string;
  title: string;
  subtitle?: string;
  /**
   * "fields" — ordinary form step, the UI renders controls for each fieldId.
   * "preview" — renders the live /api/preview output instead; fieldIds is
   * still populated with the field ids whose values drive the preview
   * (typically `["bankSenderIds"]`) so the step's inputs are explicit.
   */
  kind?: StepKind;
  fieldIds: string[];
}

export type FieldMap = Record<string, unknown>;

/** Known Georgian bank SMS sender IDs, as they appear in chat.db. */
export const KNOWN_BANK_OPTIONS: FieldOption[] = [
  { id: "SOLO", label: "Bank of Georgia — Solo", hint: "sender id: SOLO" },
  { id: "BOG", label: "Bank of Georgia (main)", hint: "sender id: BOG" },
  { id: "TBC SMS", label: "TBC Bank", hint: 'sender id: "TBC SMS" — with the space' },
  { id: "LIBERTY", label: "Liberty Bank", hint: "sender id: LIBERTY" },
  { id: "CREDO", label: "Credo Bank", hint: "sender id: CREDO" },
  { id: "BASISBANK", label: "Basis Bank", hint: "sender id: BASISBANK" },
  { id: "TERABANK", label: "Tera Bank", hint: "sender id: TERABANK" },
];

const UUID_SOURCE = "^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$";
const UUID_REGEX = new RegExp(UUID_SOURCE);

export const FIELDS: Record<string, FieldDef> = {
  instantAppId: {
    id: "instantAppId",
    label: "InstantDB App ID",
    kind: "string",
    required: true,
    placeholder: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
    help: "Create a free app at https://instantdb.com/dash, then copy its App ID.",
    patternSource: UUID_SOURCE,
    patternMessage: "Must be a UUID (8-4-4-4-12 hex characters).",
    validate: (value) => {
      if (typeof value !== "string" || !value.trim()) return "App ID is required.";
      if (!UUID_REGEX.test(value.trim())) return "Must be a UUID (8-4-4-4-12 hex characters).";
      return null;
    },
  },
  instantAdminToken: {
    id: "instantAdminToken",
    label: "InstantDB Admin Token",
    kind: "secret",
    required: true,
    placeholder: "paste the admin token",
    help: "Find this under Admin in your InstantDB dashboard. It will be stored locally and never leaves your Mac.",
    validate: (value) => {
      if (typeof value !== "string" || !value.trim()) return "Admin Token is required.";
      if (value.trim().length < 20) return "That looks too short — double-check you copied the full token.";
      return null;
    },
  },
  bankSenderIds: {
    id: "bankSenderIds",
    label: "Banks to monitor",
    kind: "multiselect",
    required: true,
    default: ["SOLO"],
    options: KNOWN_BANK_OPTIONS,
    minSelections: 1,
    help: "Xarji will only parse SMS from the sender IDs you select. You can add more later in Manage.",
    validate: (value) => {
      if (!Array.isArray(value) || value.length === 0) return "Pick at least one bank.";
      for (const v of value) {
        if (typeof v !== "string" || !v.trim()) return "Bank sender IDs must be non-empty strings.";
      }
      return null;
    },
  },
};

export const STEPS: StepDef[] = [
  {
    id: "instantdb",
    title: "Connect your InstantDB",
    subtitle: "Xarji stores parsed transactions in a database you own. Free tier is plenty.",
    fieldIds: ["instantAppId", "instantAdminToken"],
    kind: "fields",
  },
  {
    id: "banks",
    title: "Pick your banks",
    subtitle: "Only messages from the chosen sender IDs will be parsed.",
    fieldIds: ["bankSenderIds"],
    kind: "fields",
  },
  {
    id: "preview",
    title: "Preview your data",
    subtitle: "A read-only peek at what Xarji will import. Nothing is saved yet.",
    fieldIds: ["bankSenderIds"],
    kind: "preview",
  },
];

/**
 * Validate an entire FieldMap against the schema. Returns a map of
 * `fieldId → error message` for every field that fails (empty object
 * when everything is valid). Used by both the server-side POST handler
 * and the client-side form for live feedback.
 */
export function validateAll(values: FieldMap): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const field of Object.values(FIELDS)) {
    const err = field.validate?.(values[field.id], values);
    if (err) errors[field.id] = err;
  }
  return errors;
}

/**
 * Serializable view of the schema: strips function-valued validators so
 * it can be sent over HTTP as JSON. The client reconstructs live
 * validation from `patternSource` + `required` + `minSelections`.
 */
export interface SerializedField {
  id: string;
  label: string;
  kind: FieldKind;
  required: boolean;
  help?: string;
  placeholder?: string;
  patternSource?: string;
  patternMessage?: string;
  options?: FieldOption[];
  minSelections?: number;
  default?: unknown;
}

export interface SerializedSchema {
  fields: SerializedField[];
  steps: StepDef[];
}

export function serializeSchema(): SerializedSchema {
  return {
    fields: Object.values(FIELDS).map((f) => ({
      id: f.id,
      label: f.label,
      kind: f.kind,
      required: f.required ?? false,
      help: f.help,
      placeholder: f.placeholder,
      patternSource: f.patternSource,
      patternMessage: f.patternMessage,
      options: f.options,
      minSelections: f.minSelections,
      default: f.default,
    })),
    steps: STEPS,
  };
}
