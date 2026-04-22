import { describe, test, expect } from "bun:test";
import {
  FIELDS,
  STEPS,
  KNOWN_BANK_OPTIONS,
  validateAll,
  serializeSchema,
} from "../schema";

const VALID_UUID = "12345678-1234-1234-1234-123456789abc";
const VALID_TOKEN = "a".repeat(30);

describe("FIELDS — instantAppId validation", () => {
  const v = FIELDS.instantAppId.validate!;

  test("accepts a UUID", () => {
    expect(v(VALID_UUID, {})).toBeNull();
  });
  test("accepts a UUID with surrounding whitespace", () => {
    expect(v(`  ${VALID_UUID}  `, {})).toBeNull();
  });
  test("rejects empty string", () => {
    expect(v("", {})).not.toBeNull();
  });
  test("rejects missing (non-string)", () => {
    expect(v(undefined, {})).not.toBeNull();
    expect(v(null, {})).not.toBeNull();
    expect(v(123, {})).not.toBeNull();
  });
  test("rejects non-UUID strings", () => {
    expect(v("hello", {})).not.toBeNull();
    expect(v("1234", {})).not.toBeNull();
    expect(v("not-a-real-uuid-at-all", {})).not.toBeNull();
  });
});

describe("FIELDS — instantAdminToken validation", () => {
  const v = FIELDS.instantAdminToken.validate!;

  test("accepts a 30-char token", () => {
    expect(v(VALID_TOKEN, {})).toBeNull();
  });
  test("rejects strings shorter than 20 chars", () => {
    expect(v("too-short", {})).not.toBeNull();
    expect(v("a".repeat(19), {})).not.toBeNull();
  });
  test("rejects empty and non-string values", () => {
    expect(v("", {})).not.toBeNull();
    expect(v(undefined, {})).not.toBeNull();
  });
});

describe("FIELDS — bankSenderIds validation", () => {
  const v = FIELDS.bankSenderIds.validate!;

  test("accepts a non-empty list of strings", () => {
    expect(v(["SOLO"], {})).toBeNull();
    expect(v(["SOLO", "TBC SMS"], {})).toBeNull();
  });
  test("rejects non-arrays", () => {
    expect(v("SOLO", {})).not.toBeNull();
    expect(v(undefined, {})).not.toBeNull();
  });
  test("rejects empty array", () => {
    expect(v([], {})).not.toBeNull();
  });
  test("rejects entries that are non-strings or empty strings", () => {
    expect(v([""], {})).not.toBeNull();
    expect(v(["SOLO", ""], {})).not.toBeNull();
    expect(v([123, "SOLO"], {})).not.toBeNull();
  });
});

describe("KNOWN_BANK_OPTIONS includes 'TBC SMS' (the real sender id)", () => {
  test("has TBC SMS with the space", () => {
    const tbc = KNOWN_BANK_OPTIONS.find((o) => o.id === "TBC SMS");
    expect(tbc).toBeDefined();
    expect(tbc!.hint).toContain("space");
  });
  test("has SOLO", () => {
    expect(KNOWN_BANK_OPTIONS.find((o) => o.id === "SOLO")).toBeDefined();
  });
});

describe("validateAll", () => {
  test("returns an empty object when every field is valid", () => {
    const errors = validateAll({
      instantAppId: VALID_UUID,
      instantAdminToken: VALID_TOKEN,
      bankSenderIds: ["SOLO"],
    });
    expect(errors).toEqual({});
  });

  test("returns a map keyed by field id, one entry per failing field", () => {
    const errors = validateAll({
      instantAppId: "not-a-uuid",
      instantAdminToken: "short",
      bankSenderIds: [],
    });
    expect(Object.keys(errors).sort()).toEqual([
      "bankSenderIds",
      "instantAdminToken",
      "instantAppId",
    ]);
  });

  test("a mix of valid and invalid fields reports only the invalid ones", () => {
    const errors = validateAll({
      instantAppId: VALID_UUID,
      instantAdminToken: "short",
      bankSenderIds: ["SOLO"],
    });
    expect(Object.keys(errors)).toEqual(["instantAdminToken"]);
  });
});

describe("STEPS structure", () => {
  test("every step references existing field ids", () => {
    for (const step of STEPS) {
      for (const fid of step.fieldIds) {
        expect(FIELDS[fid]).toBeDefined();
      }
    }
  });
  test("the instantdb step comes before banks", () => {
    const idx = (id: string) => STEPS.findIndex((s) => s.id === id);
    expect(idx("instantdb")).toBeGreaterThan(-1);
    expect(idx("banks")).toBeGreaterThan(-1);
    expect(idx("instantdb")).toBeLessThan(idx("banks"));
  });
  test("the preview step comes after banks and is marked as a preview", () => {
    const idx = (id: string) => STEPS.findIndex((s) => s.id === id);
    expect(idx("preview")).toBeGreaterThan(idx("banks"));
    expect(STEPS[idx("preview")].kind).toBe("preview");
    // Preview must reference the bank selector so the UI knows which
    // senders to forward to /api/preview.
    expect(STEPS[idx("preview")].fieldIds).toContain("bankSenderIds");
  });
});

describe("serializeSchema — safe to send over HTTP", () => {
  const ser = serializeSchema();

  test("fields have JSON-safe shape (no functions)", () => {
    for (const f of ser.fields) {
      expect(typeof f.id).toBe("string");
      expect(typeof f.label).toBe("string");
      expect(["string", "secret", "multiselect", "boolean"]).toContain(f.kind);
      expect(typeof f.required).toBe("boolean");
      // No function-valued validator should leak into the serialised form.
      expect((f as unknown as Record<string, unknown>).validate).toBeUndefined();
    }
  });

  test("patternSource is present for the UUID field so client can echo it", () => {
    const appId = ser.fields.find((f) => f.id === "instantAppId")!;
    expect(appId.patternSource).toBeDefined();
    expect(new RegExp(appId.patternSource!).test("12345678-1234-1234-1234-123456789abc")).toBe(true);
  });

  test("steps round-trip", () => {
    expect(ser.steps.length).toBe(STEPS.length);
    expect(ser.steps.map((s) => s.id)).toEqual(STEPS.map((s) => s.id));
  });
});
