import { useEffect, useMemo, useState } from "react";
import { useTheme, useViewport } from "../ink/theme";
import { Card, CardLabel, CardTitle, LiveDot, Pill } from "../ink/primitives";

/**
 * Mirror of the serialized shape emitted by service/src/setup/schema.ts.
 * Kept intentionally loose — the server is the source of truth; this
 * interface exists so the component can render sensibly while waiting
 * for the live schema from /api/setup.
 */
interface SerializedField {
  id: string;
  label: string;
  kind: "string" | "secret" | "multiselect" | "boolean";
  required: boolean;
  help?: string;
  placeholder?: string;
  patternSource?: string;
  patternMessage?: string;
  options?: { id: string; label: string; hint?: string }[];
  minSelections?: number;
  default?: unknown;
}

interface SerializedStep {
  id: string;
  title: string;
  subtitle?: string;
  fieldIds: string[];
  /** "fields" (default) = form inputs. "preview" = live data sampler. */
  kind?: "fields" | "preview";
}

interface PreviewSample {
  merchant: string | null;
  amount: number | null;
  currency: string;
  direction: "in" | "out";
  transactionDate: string;
  kind: string;
}

interface PreviewBank {
  senderId: string;
  messageCount: number;
  parsedCount: number;
  failedCount: number;
  samples: PreviewSample[];
}

interface PreviewResult {
  ok: boolean;
  banks: PreviewBank[];
  error?: string;
  errorKind?: "full-disk-access" | "messages-db-missing" | "internal";
}

interface SerializedSchema {
  fields: SerializedField[];
  steps: SerializedStep[];
}

interface SetupGetResponse {
  configured: boolean;
  schema: SerializedSchema;
  currentValues: Record<string, unknown>;
}

type FieldValues = Record<string, unknown>;

/** Reconstruct a validator from the serialized field's metadata. */
function validateField(field: SerializedField, value: unknown): string | null {
  if (field.kind === "multiselect") {
    if (!Array.isArray(value) || value.length < (field.minSelections ?? 1)) {
      return `Pick at least ${field.minSelections ?? 1}.`;
    }
    return null;
  }
  if (field.kind === "boolean") return null;
  if (field.required && (typeof value !== "string" || !value.trim())) {
    return `${field.label} is required.`;
  }
  if (field.patternSource && typeof value === "string") {
    if (!new RegExp(field.patternSource).test(value.trim())) {
      return field.patternMessage ?? "Invalid format.";
    }
  }
  return null;
}

function fieldById(schema: SerializedSchema, id: string): SerializedField | undefined {
  return schema.fields.find((f) => f.id === id);
}

export function Onboarding({ onComplete }: { onComplete?: () => void }) {
  const T = useTheme();
  const vp = useViewport();

  const [schema, setSchema] = useState<SerializedSchema | null>(null);
  const [values, setValues] = useState<FieldValues>({});
  const [fetching, setFetching] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // Pull the live schema + current values from the server.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/setup");
        if (!res.ok) throw new Error(`setup responded ${res.status}`);
        const body = (await res.json()) as SetupGetResponse;
        if (cancelled) return;
        setSchema(body.schema);
        // Pre-populate values: defaults from schema, overridden by any
        // current values the server already has.
        const initial: FieldValues = {};
        for (const f of body.schema.fields) {
          if (body.currentValues[f.id] !== undefined && body.currentValues[f.id] !== "") {
            initial[f.id] = body.currentValues[f.id];
          } else if (f.default !== undefined) {
            initial[f.id] = f.default;
          } else if (f.kind === "multiselect") {
            initial[f.id] = [];
          } else {
            initial[f.id] = "";
          }
        }
        setValues(initial);
      } catch (err) {
        if (!cancelled) setSubmitError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setFetching(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const totalErrors = useMemo(() => {
    if (!schema) return {} as Record<string, string>;
    const out: Record<string, string> = {};
    for (const f of schema.fields) {
      const err = validateField(f, values[f.id]);
      if (err) out[f.id] = err;
    }
    return out;
  }, [schema, values]);

  const allValid = Object.keys(totalErrors).length === 0;

  async function submit() {
    if (!schema) return;
    setFieldErrors(totalErrors);
    if (!allValid) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const res = await fetch("/api/setup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(values),
      });
      const body = (await res.json()) as {
        ok: boolean;
        error?: string;
        fieldErrors?: Record<string, string>;
        warning?: string;
      };
      if (!body.ok) {
        setSubmitError(body.error ?? "Setup failed");
        if (body.fieldErrors) setFieldErrors(body.fieldErrors);
        return;
      }
      // A `warning` with ok=true means config was saved but the
      // parser failed to start in-process (for example Full Disk
      // Access not granted yet). Reloading now would land the user
      // back on this wizard with no explanation — surface the
      // warning inline instead and let them recover before retrying.
      if (body.warning) {
        setSubmitError(body.warning);
        return;
      }
      // Clean success: the service swaps itself into the configured
      // state in place; a full reload reconnects the dashboard
      // against the now-populated InstantDB and the Layout is
      // rendered normally.
      onComplete?.();
      window.location.reload();
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  }

  if (fetching) {
    return (
      <Container>
        <Card>
          <CardLabel>Loading setup…</CardLabel>
        </Card>
      </Container>
    );
  }

  if (!schema) {
    return (
      <Container>
        <Card>
          <CardTitle>Couldn't load setup schema</CardTitle>
          <div style={{ color: T.muted, marginTop: 8, fontSize: 13, fontFamily: T.sans }}>
            {submitError ?? "Unknown error"}
          </div>
        </Card>
      </Container>
    );
  }

  const narrow = vp.narrow;

  return (
    <Container>
      <header style={{ marginBottom: 28 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 14 }}>
          <div
            style={{
              width: 44,
              height: 44,
              borderRadius: 12,
              background: T.accent,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              color: "#fff",
              fontWeight: 800,
              fontSize: 22,
              fontFamily: T.sans,
            }}
          >
            X
          </div>
          <div>
            <div style={{ fontSize: 22, fontWeight: 700, letterSpacing: -0.5, color: T.text, fontFamily: T.sans }}>
              Xarji
            </div>
            <div style={{ fontSize: 11, color: T.dim, fontFamily: T.mono }} lang="ka">
              ხარჯი
            </div>
          </div>
        </div>
        <div style={{ fontSize: 26, fontWeight: 700, letterSpacing: -0.6, color: T.text, fontFamily: T.sans }}>
          Welcome — let's get you set up.
        </div>
        <div style={{ marginTop: 8, fontSize: 14, color: T.muted, fontFamily: T.sans, lineHeight: 1.5 }}>
          Xarji parses your bank SMS locally on this Mac and stores the results in an InstantDB
          instance you own. Nothing ever leaves your machine except writes to the database you
          point it at.
        </div>
      </header>

      <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
        {schema.steps.map((step, i) => (
          <Card key={step.id} pad="22px 24px">
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
              <div
                style={{
                  width: 22,
                  height: 22,
                  borderRadius: 11,
                  background: T.accentSoft,
                  color: T.accent,
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 12,
                  fontWeight: 700,
                  fontFamily: T.sans,
                }}
              >
                {i + 1}
              </div>
              <CardTitle size={16}>{step.title}</CardTitle>
            </div>
            {step.subtitle && (
              <div
                style={{
                  fontSize: 12.5,
                  color: T.muted,
                  marginBottom: 16,
                  fontFamily: T.sans,
                  lineHeight: 1.5,
                }}
              >
                {step.subtitle}
              </div>
            )}
            {step.kind === "preview" ? (
              <PreviewStep
                senders={(values.bankSenderIds as string[] | undefined) ?? []}
              />
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
                {step.fieldIds.map((id) => {
                  const field = fieldById(schema, id);
                  if (!field) return null;
                  return (
                    <FieldRow
                      key={id}
                      field={field}
                      value={values[id]}
                      onChange={(v) => setValues((prev) => ({ ...prev, [id]: v }))}
                      error={fieldErrors[id]}
                    />
                  );
                })}
              </div>
            )}
          </Card>
        ))}

        <Card pad="22px 24px">
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
            <LiveDot color={T.amber} />
            <CardTitle size={14}>macOS permissions</CardTitle>
          </div>
          <div
            style={{
              fontSize: 12.5,
              color: T.muted,
              fontFamily: T.sans,
              lineHeight: 1.5,
            }}
          >
            Xarji needs Full Disk Access so it can read your Messages database. Open System
            Settings → Privacy &amp; Security → Full Disk Access and add the Xarji app (or your
            terminal if you're running from source). You can continue setup now; if the parser
            can't read <code>~/Library/Messages/chat.db</code> it will tell you after startup.
          </div>
        </Card>

        {submitError && (
          <Card pad="16px 20px" accent>
            <div style={{ color: T.accent, fontSize: 13, fontWeight: 600, fontFamily: T.sans }}>
              {submitError}
            </div>
          </Card>
        )}

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            marginTop: 4,
            flexDirection: narrow ? "column" : "row",
            gap: 12,
          }}
        >
          <div style={{ fontSize: 11, color: T.dim, fontFamily: T.mono }}>
            {allValid ? "Ready to continue" : `${Object.keys(totalErrors).length} field(s) need attention`}
          </div>
          <button
            type="button"
            disabled={!allValid || submitting}
            onClick={() => void submit()}
            style={{
              padding: "12px 22px",
              borderRadius: 12,
              border: "none",
              background: !allValid || submitting ? T.panelAlt : T.accent,
              color: !allValid || submitting ? T.muted : "#fff",
              fontSize: 14,
              fontWeight: 700,
              fontFamily: T.sans,
              cursor: !allValid || submitting ? "not-allowed" : "pointer",
              letterSpacing: 0.2,
            }}
          >
            {submitting ? "Applying…" : "Finish setup"}
          </button>
        </div>
      </div>
    </Container>
  );
}

function Container({ children }: { children: React.ReactNode }) {
  const T = useTheme();
  return (
    <div style={{ minHeight: "100vh", background: T.bg, padding: "48px 32px", display: "flex", justifyContent: "center" }}>
      <div style={{ maxWidth: 720, width: "100%" }}>{children}</div>
    </div>
  );
}

function FieldRow({
  field,
  value,
  onChange,
  error,
}: {
  field: SerializedField;
  value: unknown;
  onChange: (v: unknown) => void;
  error: string | undefined;
}) {
  const T = useTheme();

  if (field.kind === "multiselect") {
    const selected = (value as string[]) ?? [];
    return (
      <div>
        <Label text={field.label} help={field.help} />
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {(field.options ?? []).map((opt) => {
            const on = selected.includes(opt.id);
            return (
              <button
                type="button"
                key={opt.id}
                onClick={() =>
                  onChange(
                    on ? selected.filter((s) => s !== opt.id) : [...selected, opt.id]
                  )
                }
                style={{
                  textAlign: "left",
                  padding: "12px 14px",
                  borderRadius: 10,
                  background: on ? T.accentSoft : T.panelAlt,
                  color: on ? T.accent : T.text,
                  border: `1px solid ${on ? T.accent + "55" : T.line}`,
                  cursor: "pointer",
                  fontFamily: T.sans,
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                }}
              >
                <span
                  style={{
                    width: 18,
                    height: 18,
                    borderRadius: 5,
                    border: `1px solid ${on ? T.accent : T.lineStrong}`,
                    background: on ? T.accent : "transparent",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color: "#fff",
                    fontSize: 12,
                    fontWeight: 800,
                  }}
                >
                  {on ? "✓" : ""}
                </span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ fontSize: 13.5, fontWeight: 600 }}>{opt.label}</span>
                  {opt.hint && (
                    <span style={{ display: "block", fontSize: 11, color: T.muted, fontFamily: T.mono, marginTop: 2 }}>
                      {opt.hint}
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
        {error && <FieldError text={error} />}
      </div>
    );
  }

  const isSecret = field.kind === "secret";

  return (
    <div>
      <Label text={field.label} help={field.help} required={field.required} />
      <input
        type={isSecret ? "password" : "text"}
        value={typeof value === "string" ? value : ""}
        placeholder={field.placeholder}
        onChange={(e) => onChange(e.target.value)}
        spellCheck={false}
        autoCapitalize="off"
        autoComplete={isSecret ? "off" : "off"}
        style={{
          width: "100%",
          padding: "10px 14px",
          borderRadius: 10,
          border: `1px solid ${error ? T.accent + "66" : T.line}`,
          background: T.panelAlt,
          color: T.text,
          fontSize: 13.5,
          fontFamily: isSecret ? T.mono : T.sans,
          outline: "none",
          boxSizing: "border-box",
        }}
      />
      {error && <FieldError text={error} />}
      {isSecret && (
        <div style={{ marginTop: 6, display: "flex", alignItems: "center", gap: 6 }}>
          <Pill bg="rgba(106,163,255,0.12)" color={T.blue}>
            Stored locally
          </Pill>
          <span style={{ fontSize: 11, color: T.dim, fontFamily: T.sans }}>
            written to ~/.xarji/config.json on this Mac only
          </span>
        </div>
      )}
    </div>
  );
}

function Label({ text, help, required }: { text: string; help?: string; required?: boolean }) {
  const T = useTheme();
  return (
    <div style={{ marginBottom: 6 }}>
      <label
        style={{
          fontSize: 12.5,
          fontWeight: 600,
          color: T.text,
          fontFamily: T.sans,
          letterSpacing: 0.1,
        }}
      >
        {text}
        {required && <span style={{ color: T.accent, marginLeft: 4 }}>*</span>}
      </label>
      {help && (
        <div
          style={{
            fontSize: 11.5,
            color: T.muted,
            marginTop: 4,
            fontFamily: T.sans,
            lineHeight: 1.5,
          }}
        >
          {help}
        </div>
      )}
    </div>
  );
}

function FieldError({ text }: { text: string }) {
  const T = useTheme();
  return (
    <div
      style={{
        marginTop: 6,
        fontSize: 11.5,
        color: T.accent,
        fontFamily: T.sans,
      }}
    >
      {text}
    </div>
  );
}

/**
 * Live preview step: takes the currently-selected bank senders, hits
 * /api/preview, and renders per-bank counts + a handful of sample
 * transactions so the user sees their own real data before committing.
 * Re-fetches automatically when the sender list changes.
 */
function PreviewStep({ senders }: { senders: string[] }) {
  const T = useTheme();
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<PreviewResult | null>(null);
  const key = senders.slice().sort().join("|");

  useEffect(() => {
    if (senders.length === 0) {
      setResult(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    (async () => {
      try {
        const res = await fetch("/api/preview", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ senders }),
        });
        const body = (await res.json()) as PreviewResult;
        if (!cancelled) setResult(body);
      } catch (err) {
        if (!cancelled) {
          setResult({
            ok: false,
            banks: [],
            error: err instanceof Error ? err.message : String(err),
            errorKind: "internal",
          });
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // `key` is the stable dependency (serialised + sorted senders).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  if (senders.length === 0) {
    return (
      <div style={{ color: T.muted, fontSize: 12.5, fontFamily: T.sans }}>
        Pick at least one bank in the step above to see a preview.
      </div>
    );
  }

  if (loading && !result) {
    return (
      <div style={{ color: T.muted, fontSize: 12.5, fontFamily: T.sans }}>
        Scanning Messages.app…
      </div>
    );
  }

  if (result && !result.ok) {
    return <PreviewError result={result} />;
  }

  if (!result) return null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {result.banks.map((bank) => (
        <PreviewBankCard key={bank.senderId} bank={bank} />
      ))}
      <div
        style={{
          fontSize: 11,
          color: T.dim,
          fontFamily: T.mono,
          marginTop: 4,
          letterSpacing: 0.3,
        }}
      >
        Nothing is saved yet. Hit "Finish setup" below to write your config and start syncing.
      </div>
    </div>
  );
}

function PreviewError({ result }: { result: PreviewResult }) {
  const T = useTheme();
  const isDiskAccess = result.errorKind === "full-disk-access";
  return (
    <div
      style={{
        padding: "14px 16px",
        borderRadius: 10,
        border: `1px solid ${T.accent}55`,
        background: T.accentSoft,
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 700, color: T.accent, fontFamily: T.sans }}>
        {isDiskAccess ? "Xarji needs Full Disk Access" : "Couldn't read Messages"}
      </div>
      <div style={{ fontSize: 12.5, color: T.text, fontFamily: T.sans, lineHeight: 1.5 }}>
        {result.error}
      </div>
      {isDiskAccess && (
        <ol
          style={{
            margin: 0,
            paddingLeft: 18,
            fontSize: 12.5,
            color: T.muted,
            fontFamily: T.sans,
            lineHeight: 1.6,
          }}
        >
          <li>Open System Settings → Privacy &amp; Security → Full Disk Access.</li>
          <li>Enable Xarji (or your terminal, if running from source).</li>
          <li>Quit and re-launch Xarji, then reload this page.</li>
        </ol>
      )}
    </div>
  );
}

function PreviewBankCard({ bank }: { bank: PreviewBank }) {
  const T = useTheme();
  const hasData = bank.parsedCount > 0;
  return (
    <div
      style={{
        padding: "14px 16px",
        borderRadius: 12,
        background: T.panelAlt,
        border: `1px solid ${T.line}`,
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, justifyContent: "space-between", flexWrap: "wrap" }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: T.text, fontFamily: T.sans }}>
          {bank.senderId}
        </div>
        <div
          style={{
            fontSize: 11,
            color: T.muted,
            fontFamily: T.mono,
            letterSpacing: 0.3,
          }}
        >
          {bank.messageCount.toLocaleString("en-US")} SMS ·{" "}
          <span style={{ color: hasData ? T.green : T.muted }}>
            {bank.parsedCount.toLocaleString("en-US")} parsed
          </span>
          {bank.failedCount > 0 ? ` · ${bank.failedCount.toLocaleString("en-US")} skipped` : ""}
        </div>
      </div>
      {hasData ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {bank.samples.map((sample, i) => (
            <PreviewSampleRow key={i} sample={sample} />
          ))}
        </div>
      ) : (
        <div style={{ color: T.muted, fontSize: 12, fontFamily: T.sans, lineHeight: 1.4 }}>
          {bank.messageCount === 0
            ? "No SMS from this sender in Messages.app. If this is wrong, double-check the exact sender id (TBC uses \"TBC SMS\" with a space)."
            : "Messages present but nothing recognised yet — usually means the SMS are promos or notices rather than transactions."}
        </div>
      )}
    </div>
  );
}

function PreviewSampleRow({ sample }: { sample: PreviewSample }) {
  const T = useTheme();
  const inbound = sample.direction === "in";
  const amount = sample.amount;
  const symbol = sample.currency === "GEL" ? "₾" : sample.currency === "USD" ? "$" : sample.currency === "EUR" ? "€" : `${sample.currency} `;
  const amountText =
    amount == null
      ? "—"
      : `${inbound ? "+" : "−"}${symbol}${amount.toFixed(2)}`;

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 90px",
        alignItems: "baseline",
        gap: 12,
        fontSize: 12,
        fontFamily: T.sans,
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div
          style={{
            color: T.text,
            fontWeight: 600,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {sample.merchant || "—"}
        </div>
        <div style={{ fontSize: 10.5, color: T.dim, fontFamily: T.mono, marginTop: 2 }}>
          {sample.kind} · {formatPreviewDate(sample.transactionDate)}
        </div>
      </div>
      <div
        style={{
          textAlign: "right",
          fontVariantNumeric: "tabular-nums",
          color: inbound ? T.green : T.text,
          fontWeight: 700,
        }}
      >
        {amountText}
      </div>
    </div>
  );
}

function formatPreviewDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  } catch {
    return iso;
  }
}
