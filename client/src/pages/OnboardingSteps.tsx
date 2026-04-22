import React, { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import { useTheme } from "../ink/theme";

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

export interface BankOption {
  id: string;
  label: string;
  hint?: string;
}

function StepShell({
  heading,
  subhead,
  children,
  primary,
  onBack,
}: {
  heading: React.ReactNode;
  subhead?: React.ReactNode;
  children: React.ReactNode;
  primary: { label: string; disabled?: boolean; loading?: boolean; onClick: () => void };
  onBack?: () => void;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 22 }}>
      <StepHeader heading={heading} subhead={subhead} />
      <div>{children}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 12, alignItems: "center", marginTop: 8 }}>
        <PrimaryButton
          label={primary.label}
          disabled={primary.disabled}
          loading={primary.loading}
          onClick={primary.onClick}
        />
        {onBack && <BackLink onClick={onBack} />}
      </div>
    </div>
  );
}

function StepHeader({
  heading,
  subhead,
}: {
  heading: React.ReactNode;
  subhead?: React.ReactNode;
}) {
  const T = useTheme();

  return (
    <header style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <h1
        style={{
          fontSize: 32,
          fontWeight: 700,
          letterSpacing: -0.8,
          lineHeight: 1.15,
          color: T.text,
          fontFamily: T.sans,
          margin: 0,
        }}
      >
        {heading}
      </h1>
      {subhead && (
        <div
          style={{
            fontSize: 14.5,
            color: T.muted,
            fontFamily: T.sans,
            lineHeight: 1.5,
            maxWidth: 480,
          }}
        >
          {subhead}
        </div>
      )}
    </header>
  );
}

function PrimaryButton({
  label,
  disabled,
  loading,
  onClick,
}: {
  label: string;
  disabled?: boolean;
  loading?: boolean;
  onClick: () => void;
}) {
  const T = useTheme();
  const [pressed, setPressed] = useState(false);
  const ready = !disabled && !loading;

  return (
    <motion.button
      type="button"
      disabled={!ready}
      onClick={onClick}
      onPointerDown={() => ready && setPressed(true)}
      onPointerUp={() => setPressed(false)}
      onPointerLeave={() => setPressed(false)}
      animate={{ scale: pressed ? 0.97 : 1 }}
      transition={{ duration: 0.08, ease: [0.16, 1, 0.3, 1] }}
      style={{
        minWidth: 220,
        maxWidth: 360,
        height: 52,
        padding: "0 40px",
        borderRadius: 14,
        border: "none",
        background: ready ? T.accent : T.panelAlt,
        color: ready ? "#fff" : T.muted,
        fontSize: 15,
        fontWeight: 700,
        letterSpacing: 0.2,
        fontFamily: T.sans,
        cursor: ready ? "pointer" : "not-allowed",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 10,
        boxShadow: ready ? `0 8px 24px ${T.accent}33` : "none",
        transition: "box-shadow 200ms ease-out",
      }}
    >
      {loading && <Spinner />}
      {loading ? "Working…" : label}
    </motion.button>
  );
}

function BackLink({ onClick }: { onClick: () => void }) {
  const T = useTheme();

  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        background: "transparent",
        border: "none",
        cursor: "pointer",
        fontSize: 12.5,
        color: T.dim,
        fontFamily: T.sans,
        padding: 4,
      }}
    >
      ← Back
    </button>
  );
}

function Spinner() {
  return (
    <svg width={14} height={14} viewBox="0 0 24 24" aria-hidden>
      <motion.circle
        cx={12}
        cy={12}
        r={9}
        stroke="currentColor"
        strokeWidth={3}
        strokeLinecap="round"
        fill="none"
        strokeDasharray="40 60"
        animate={{ rotate: 360 }}
        transition={{ duration: 1, ease: "linear", repeat: Infinity }}
        style={{ transformOrigin: "center" }}
      />
    </svg>
  );
}

function ErrorBlock({ text }: { text: string }) {
  const T = useTheme();

  return (
    <motion.div
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.15 }}
      style={{
        marginTop: 12,
        padding: "10px 14px",
        borderRadius: 10,
        background: T.accentSoft,
        border: `1px solid ${T.accent}33`,
        color: T.accent,
        fontSize: 12.5,
        fontFamily: T.sans,
        fontWeight: 600,
      }}
    >
      {text}
    </motion.div>
  );
}

export function WelcomeStep({ onNext }: { onNext: () => void }) {
  const T = useTheme();

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 22,
        textAlign: "center",
        paddingTop: 12,
      }}
    >
      <motion.div
        initial={{ opacity: 0, y: 12, scale: 0.92 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
      >
        <XarjiMark size={84} />
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.24, delay: 0.05, ease: [0.16, 1, 0.3, 1] }}
      >
        <h1
          style={{
            fontSize: 42,
            fontWeight: 700,
            letterSpacing: -1,
            lineHeight: 1.05,
            color: T.text,
            fontFamily: T.sans,
            margin: 0,
          }}
        >
          Welcome to Xarji
        </h1>
        <div
          style={{
            marginTop: 6,
            fontSize: 13,
            color: T.dim,
            fontFamily: T.mono,
            letterSpacing: 0.6,
          }}
          lang="ka"
        >
          ხარჯი
        </div>
      </motion.div>

      <motion.p
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.24, delay: 0.1, ease: [0.16, 1, 0.3, 1] }}
        style={{
          fontSize: 15,
          color: T.muted,
          lineHeight: 1.55,
          fontFamily: T.sans,
          maxWidth: 440,
          margin: 0,
        }}
      >
        Parses your bank SMS locally. Writes to a database you own. Nothing leaves your Mac.
      </motion.p>

      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.24, delay: 0.15, ease: [0.16, 1, 0.3, 1] }}
        style={{ marginTop: 10 }}
      >
        <PrimaryButton label="Get started" onClick={onNext} />
      </motion.div>
    </div>
  );
}

function XarjiMark({ size = 72 }: { size?: number }) {
  const T = useTheme();

  return (
    <div
      style={{
        width: size,
        height: size,
        borderRadius: size * 0.26,
        background: `linear-gradient(160deg, ${T.panelHi} 0%, ${T.panel} 100%)`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        boxShadow: `0 20px 50px ${T.accent}22, 0 0 0 1px ${T.line}`,
        position: "relative",
        overflow: "hidden",
      }}
    >
      <div
        aria-hidden
        style={{
          position: "absolute",
          inset: 0,
          background: `radial-gradient(120% 80% at 30% 20%, ${T.accent}33 0%, transparent 60%)`,
        }}
      />
      <span
        style={{
          position: "relative",
          color: T.accent,
          fontWeight: 800,
          fontFamily: T.sans,
          fontSize: size * 0.5,
          letterSpacing: -1,
        }}
      >
        ხ
      </span>
    </div>
  );
}

export function AppIdStep({
  value,
  onChange,
  canAdvance,
  onBack,
  onNext,
  fieldMeta,
  submitError,
}: {
  value: string;
  onChange: (value: string) => void;
  canAdvance: boolean;
  onBack: () => void;
  onNext: () => void;
  fieldMeta?: { placeholder?: string; patternMessage?: string };
  submitError: string | null;
}) {
  const T = useTheme();
  const [touched, setTouched] = useState(false);
  const showError = touched && value.trim().length > 0 && !canAdvance;

  return (
    <StepShell
      heading={<>Paste your InstantDB App ID</>}
      subhead={
        <>
          Xarji writes your parsed transactions to an InstantDB app you own. Create one free at{" "}
          <a
            href="https://instantdb.com/dash"
            target="_blank"
            rel="noreferrer"
            style={{ color: T.accent, fontWeight: 600, textDecoration: "none" }}
          >
            instantdb.com/dash ↗
          </a>{" "}
          — takes 30 seconds — then paste its App ID below.
        </>
      }
      primary={{ label: "Continue", disabled: !canAdvance, onClick: onNext }}
      onBack={onBack}
    >
      <SecretField
        value={value}
        onChange={onChange}
        onBlur={() => setTouched(true)}
        onEnter={() => canAdvance && onNext()}
        placeholder={fieldMeta?.placeholder ?? "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"}
        invalid={showError}
        valid={touched && canAdvance}
      />
      {showError && (
        <FieldError
          text={fieldMeta?.patternMessage ?? "Must be a UUID (8-4-4-4-12 hex characters)."}
        />
      )}
      {submitError && !showError && <ErrorBlock text={submitError} />}
    </StepShell>
  );
}

export function TokenStep({
  value,
  onChange,
  canAdvance,
  onBack,
  onNext,
  fieldMeta,
  submitError,
}: {
  value: string;
  onChange: (value: string) => void;
  canAdvance: boolean;
  onBack: () => void;
  onNext: () => void;
  fieldMeta?: { placeholder?: string };
  submitError: string | null;
}) {
  const T = useTheme();
  const [touched, setTouched] = useState(false);
  const showError = touched && value.trim().length > 0 && !canAdvance;

  return (
    <StepShell
      heading={<>Paste your Admin Token</>}
      subhead={
        <>
          Find it in your InstantDB dashboard under <strong style={{ color: T.text }}>Admin</strong>.
          It's stored locally on this Mac and never sent anywhere else.
        </>
      }
      primary={{ label: "Continue", disabled: !canAdvance, onClick: onNext }}
      onBack={onBack}
    >
      <SecretField
        value={value}
        onChange={onChange}
        onBlur={() => setTouched(true)}
        onEnter={() => canAdvance && onNext()}
        placeholder={fieldMeta?.placeholder ?? "paste the admin token"}
        invalid={showError}
        valid={touched && canAdvance}
      />
      <div style={{ marginTop: 10, display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span
          style={{
            padding: "4px 10px",
            borderRadius: 999,
            background: "rgba(106,163,255,0.12)",
            color: T.blue,
            fontSize: 10.5,
            fontWeight: 700,
            letterSpacing: 0.4,
            fontFamily: T.sans,
            textTransform: "uppercase",
          }}
        >
          Stored locally
        </span>
        <span style={{ fontSize: 11.5, color: T.dim, fontFamily: T.mono }}>
          ~/.xarji/config.json on this Mac only
        </span>
      </div>
      {showError && <FieldError text="That looks too short — double-check you copied the full token." />}
      {submitError && !showError && <ErrorBlock text={submitError} />}
    </StepShell>
  );
}

const DEFAULT_BANK_OPTIONS: BankOption[] = [
  { id: "SOLO", label: "Bank of Georgia — Solo", hint: "sender id: SOLO" },
  { id: "BOG", label: "Bank of Georgia (main)", hint: "sender id: BOG" },
  { id: "TBC SMS", label: "TBC Bank", hint: 'sender id: "TBC SMS" — with the space' },
  { id: "LIBERTY", label: "Liberty Bank", hint: "sender id: LIBERTY" },
  { id: "CREDO", label: "Credo Bank", hint: "sender id: CREDO" },
  { id: "BASISBANK", label: "Basis Bank", hint: "sender id: BASISBANK" },
  { id: "TERABANK", label: "Tera Bank", hint: "sender id: TERABANK" },
];

export function BanksStep({
  selected,
  onChange,
  canAdvance,
  onBack,
  onNext,
  fieldMeta,
}: {
  selected: string[];
  onChange: (value: string[]) => void;
  canAdvance: boolean;
  onBack: () => void;
  onNext: () => void;
  fieldMeta?: { options?: BankOption[] };
}) {
  const options = fieldMeta?.options ?? DEFAULT_BANK_OPTIONS;

  const toggle = (id: string) => {
    onChange(selected.includes(id) ? selected.filter((senderId) => senderId !== id) : [...selected, id]);
  };

  return (
    <StepShell
      heading={<>Which banks should Xarji watch?</>}
      subhead={<>Xarji will only parse SMS from the sender IDs you pick. You can change this later.</>}
      primary={{ label: "Continue", disabled: !canAdvance, onClick: onNext }}
      onBack={onBack}
    >
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {options.map((option, index) => (
          <BankRow
            key={option.id}
            option={option}
            selected={selected.includes(option.id)}
            onToggle={() => toggle(option.id)}
            stagger={index}
          />
        ))}
      </div>
    </StepShell>
  );
}

function BankRow({
  option,
  selected,
  onToggle,
  stagger,
}: {
  option: BankOption;
  selected: boolean;
  onToggle: () => void;
  stagger: number;
}) {
  const T = useTheme();

  return (
    <motion.button
      type="button"
      onClick={onToggle}
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2, delay: stagger * 0.02, ease: [0.16, 1, 0.3, 1] }}
      whileTap={{ scale: 0.99 }}
      style={{
        textAlign: "left",
        padding: "12px 14px",
        borderRadius: 12,
        background: selected ? T.accentSoft : T.panelAlt,
        color: selected ? T.accent : T.text,
        border: `1px solid ${selected ? `${T.accent}55` : T.line}`,
        cursor: "pointer",
        fontFamily: T.sans,
        display: "flex",
        alignItems: "center",
        gap: 14,
      }}
    >
      <span
        style={{
          width: 20,
          height: 20,
          borderRadius: 6,
          border: `1px solid ${selected ? T.accent : T.lineStrong}`,
          background: selected ? T.accent : "transparent",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#fff",
          fontSize: 12,
          fontWeight: 800,
          transition: "background 150ms ease-out, border-color 150ms ease-out",
        }}
      >
        {selected ? "✓" : ""}
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span
          style={{
            display: "block",
            fontSize: 14,
            fontWeight: 600,
            color: selected ? T.accent : T.text,
          }}
        >
          {option.label}
        </span>
        {option.hint && (
          <span style={{ display: "block", fontSize: 11, color: T.muted, fontFamily: T.mono, marginTop: 2 }}>
            {option.hint}
          </span>
        )}
      </span>
    </motion.button>
  );
}

export function PreviewStep({
  senders,
  onBack,
  onFinish,
  onReadyChange,
  submitError,
  submitting,
}: {
  senders: string[];
  onBack: () => void;
  onFinish: () => void;
  onReadyChange: (ready: boolean) => void;
  submitError: string | null;
  submitting: boolean;
}) {
  const [loading, setLoading] = useState(true);
  const [result, setResult] = useState<PreviewResult | null>(null);
  const [autoRetrying, setAutoRetrying] = useState(false);
  const key = senders.slice().sort().join("|");

  useEffect(() => {
    if (senders.length === 0) {
      setLoading(false);
      setResult(null);
      onReadyChange(false);
      return;
    }

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function probe(isRetry: boolean) {
      if (!isRetry) {
        setLoading(true);
        onReadyChange(false);
      } else {
        setAutoRetrying(true);
      }

      try {
        const res = await fetch("/api/preview", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ senders }),
        });
        const body = (await res.json()) as PreviewResult;
        if (cancelled) return;

        setResult(body);
        onReadyChange(body.ok);

        if (!body.ok) {
          timer = setTimeout(() => void probe(true), 4000);
        }
      } catch (error) {
        if (cancelled) return;

        setResult({
          ok: false,
          banks: [],
          error: error instanceof Error ? error.message : String(error),
          errorKind: "internal",
        });
        onReadyChange(false);
        timer = setTimeout(() => void probe(true), 4000);
      } finally {
        if (!cancelled) {
          setLoading(false);
          setAutoRetrying(false);
        }
      }
    }

    void probe(false);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [key, onReadyChange, senders]);

  const canContinue = !loading && !!result?.ok;

  return (
    <StepShell
      heading={<>Here's what we found</>}
      subhead={<>A read-only peek at what Xarji will import. Nothing is saved yet.</>}
      primary={{
        label: "Finish setup",
        disabled: !canContinue,
        loading: submitting,
        onClick: onFinish,
      }}
      onBack={submitting ? undefined : onBack}
    >
      {loading && <PreviewLoading />}
      {!loading && result && !result.ok && <PreviewErrorBlock result={result} autoRetrying={autoRetrying} />}
      {!loading && result?.ok && (
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          {result.banks.map((bank) => (
            <PreviewBankCard key={bank.senderId} bank={bank} />
          ))}
        </div>
      )}
      {submitError && <ErrorBlock text={submitError} />}
    </StepShell>
  );
}

function PreviewLoading() {
  const T = useTheme();

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {[0, 1].map((index) => (
        <motion.div
          key={index}
          initial={{ opacity: 0.4 }}
          animate={{ opacity: [0.4, 0.75, 0.4] }}
          transition={{ duration: 1.4, repeat: Infinity, delay: index * 0.12 }}
          style={{
            height: 70,
            borderRadius: 12,
            background: T.panelAlt,
            border: `1px solid ${T.line}`,
          }}
        />
      ))}
      <div style={{ fontSize: 12, color: T.muted, fontFamily: T.sans, marginTop: 4 }}>
        Scanning Messages.app…
      </div>
    </div>
  );
}

function PreviewErrorBlock({
  result,
  autoRetrying,
}: {
  result: PreviewResult;
  autoRetrying: boolean;
}) {
  const T = useTheme();
  const isDiskAccess = result.errorKind === "full-disk-access";
  const fdaDeepLink =
    "x-apple.systempreferences:com.apple.settings.PrivacySecurity.extension?Privacy_AllFiles";

  return (
    <div
      style={{
        padding: "16px 18px",
        borderRadius: 12,
        border: `1px solid ${T.accent}55`,
        background: T.accentSoft,
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, justifyContent: "space-between" }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: T.accent, fontFamily: T.sans }}>
          {isDiskAccess ? "Xarji needs Full Disk Access" : "Couldn't read Messages"}
        </div>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            fontSize: 10.5,
            fontWeight: 600,
            color: T.accent,
            fontFamily: T.mono,
            letterSpacing: 0.3,
            textTransform: "uppercase",
            opacity: autoRetrying ? 1 : 0.6,
            transition: "opacity 200ms ease-out",
          }}
        >
          <motion.span
            animate={{ rotate: autoRetrying ? 360 : 0 }}
            transition={{ duration: 1, ease: "linear", repeat: autoRetrying ? Infinity : 0 }}
            style={{
              display: "inline-block",
              width: 10,
              height: 10,
              borderRadius: 5,
              border: `1.5px solid ${T.accent}`,
              borderTopColor: "transparent",
            }}
          />
          {autoRetrying ? "checking" : "auto-retry"}
        </span>
      </div>
      <div style={{ fontSize: 13, color: T.text, fontFamily: T.sans, lineHeight: 1.5 }}>
        {result.error}
      </div>
      {isDiskAccess && (
        <>
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
            <li>Open Full Disk Access in System Settings.</li>
            <li>Enable <strong style={{ color: T.text }}>Xarji</strong>.</li>
            <li>Come back — this page refreshes on its own.</li>
          </ol>
          <a
            href={fdaDeepLink}
            style={{
              alignSelf: "flex-start",
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "8px 14px",
              borderRadius: 10,
              background: T.accent,
              color: "#fff",
              fontSize: 13,
              fontWeight: 700,
              fontFamily: T.sans,
              textDecoration: "none",
              letterSpacing: 0.2,
            }}
          >
            Open System Settings ↗
          </a>
        </>
      )}
    </div>
  );
}

function PreviewBankCard({ bank }: { bank: PreviewBank }) {
  const T = useTheme();
  const hasData = bank.parsedCount > 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.22, ease: [0.16, 1, 0.3, 1] }}
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
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 12,
          justifyContent: "space-between",
          flexWrap: "wrap",
        }}
      >
        <div style={{ fontSize: 14, fontWeight: 700, color: T.text, fontFamily: T.sans }}>
          {bank.senderId}
        </div>
        <div style={{ fontSize: 11, color: T.muted, fontFamily: T.mono, letterSpacing: 0.3 }}>
          {bank.messageCount.toLocaleString("en-US")} SMS ·{" "}
          <span style={{ color: hasData ? T.green : T.muted }}>
            {bank.parsedCount.toLocaleString("en-US")} parsed
          </span>
          {bank.failedCount > 0 ? ` · ${bank.failedCount.toLocaleString("en-US")} skipped` : ""}
        </div>
      </div>
      {hasData ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {bank.samples.map((sample, index) => (
            <PreviewSampleRow key={`${bank.senderId}-${index}`} sample={sample} />
          ))}
        </div>
      ) : (
        <div style={{ color: T.muted, fontSize: 12, fontFamily: T.sans, lineHeight: 1.4 }}>
          {bank.messageCount === 0
            ? 'No SMS from this sender in Messages.app. If this is wrong, double-check the exact sender id (TBC uses "TBC SMS" with a space).'
            : "Messages present but nothing recognised yet — usually means the SMS are promos or notices rather than transactions."}
        </div>
      )}
    </motion.div>
  );
}

function PreviewSampleRow({ sample }: { sample: PreviewSample }) {
  const T = useTheme();
  const inbound = sample.direction === "in";
  const amount = sample.amount;
  const symbol =
    sample.currency === "GEL"
      ? "₾"
      : sample.currency === "USD"
        ? "$"
        : sample.currency === "EUR"
          ? "€"
          : `${sample.currency} `;
  const amountText = amount == null ? "—" : `${inbound ? "+" : "−"}${symbol}${amount.toFixed(2)}`;

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
          {sample.kind} · {formatSampleDate(sample.transactionDate)}
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

function formatSampleDate(iso: string): string {
  try {
    const date = new Date(iso);
    return date.toLocaleString(undefined, {
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

function TextField({
  value,
  onChange,
  onFocus,
  onBlur,
  onEnter,
  placeholder,
  invalid,
  valid,
  mono,
  autoFocus,
  paddingRight,
  masked,
}: {
  value: string;
  onChange: (value: string) => void;
  onFocus?: () => void;
  onBlur?: () => void;
  onEnter?: () => void;
  placeholder?: string;
  invalid?: boolean;
  valid?: boolean;
  mono?: boolean;
  autoFocus?: boolean;
  paddingRight?: number;
  masked?: boolean;
}) {
  const T = useTheme();
  const ref = useRef<HTMLInputElement | null>(null);
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    if (!autoFocus || !ref.current) return;

    const id = setTimeout(() => ref.current?.focus(), 180);
    return () => clearTimeout(id);
  }, [autoFocus]);

  const borderColor = invalid ? `${T.accent}88` : focused ? T.accent : T.line;

  return (
    <div style={{ position: "relative" }}>
      <input
        ref={ref}
        type="text"
        value={value}
        spellCheck={false}
        autoCapitalize="off"
        autoComplete="off"
        autoCorrect="off"
        name="xarji-sensitive"
        data-1p-ignore
        data-lpignore="true"
        data-form-type="other"
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        onFocus={() => {
          setFocused(true);
          onFocus?.();
        }}
        onBlur={() => {
          setFocused(false);
          onBlur?.();
        }}
        onKeyDown={(event) => {
          if (event.key !== "Enter") return;
          event.preventDefault();
          onEnter?.();
        }}
        style={{
          width: "100%",
          height: 48,
          padding: `0 ${paddingRight ?? 40}px 0 16px`,
          borderRadius: 12,
          border: `1px solid ${borderColor}`,
          background: T.panelAlt,
          color: T.text,
          fontSize: 14,
          fontFamily: mono ? T.mono : T.sans,
          outline: "none",
          boxSizing: "border-box",
          transition: "border-color 150ms ease-out, box-shadow 150ms ease-out",
          boxShadow: focused ? `0 0 0 4px ${T.accent}22` : "none",
          ...(masked ? ({ WebkitTextSecurity: "disc" } as React.CSSProperties) : {}),
        }}
      />
      {valid && !invalid && (
        <div
          style={{
            position: "absolute",
            right: paddingRight ? paddingRight - 20 : 14,
            top: "50%",
            transform: "translateY(-50%)",
            color: T.green,
            fontSize: 16,
            lineHeight: 1,
            pointerEvents: "none",
          }}
          aria-hidden
        >
          ✓
        </div>
      )}
    </div>
  );
}

function SecretField({
  value,
  onChange,
  onBlur,
  onEnter,
  placeholder,
  invalid,
  valid,
}: {
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  onEnter?: () => void;
  placeholder?: string;
  invalid?: boolean;
  valid?: boolean;
}) {
  const [revealed, setRevealed] = useState(false);

  async function pasteFromClipboard() {
    try {
      const text = await navigator.clipboard.readText();
      if (text) onChange(text.trim());
    } catch {
      // The native paste shortcut is still available when clipboard access is denied.
    }
  }

  return (
    <div style={{ position: "relative" }}>
      <TextField
        masked={!revealed}
        value={value}
        onChange={onChange}
        onBlur={onBlur}
        onEnter={onEnter}
        placeholder={placeholder}
        invalid={invalid}
        valid={valid}
        mono
        autoFocus
        paddingRight={92}
      />
      <div
        style={{
          position: "absolute",
          right: 8,
          top: 0,
          height: "100%",
          display: "flex",
          alignItems: "center",
          gap: 4,
        }}
      >
        <IconButton
          title={revealed ? "Hide" : "Hold to reveal"}
          onPointerDown={() => setRevealed(true)}
          onPointerUp={() => setRevealed(false)}
          onPointerLeave={() => setRevealed(false)}
        >
          {revealed ? <EyeOffIcon /> : <EyeIcon />}
        </IconButton>
        <IconButton title="Paste from clipboard" onClick={() => void pasteFromClipboard()}>
          <PasteIcon />
        </IconButton>
      </div>
    </div>
  );
}

function IconButton({
  children,
  title,
  onClick,
  onPointerDown,
  onPointerUp,
  onPointerLeave,
}: {
  children: React.ReactNode;
  title: string;
  onClick?: () => void;
  onPointerDown?: () => void;
  onPointerUp?: () => void;
  onPointerLeave?: () => void;
}) {
  const T = useTheme();

  return (
    <button
      type="button"
      aria-label={title}
      title={title}
      onClick={onClick}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onPointerLeave={onPointerLeave}
      style={{
        width: 34,
        height: 34,
        borderRadius: 8,
        border: "none",
        background: "transparent",
        color: T.dim,
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        transition: "background 120ms ease-out, color 120ms ease-out",
      }}
      onMouseEnter={(event) => {
        event.currentTarget.style.background = T.panelHi;
        event.currentTarget.style.color = T.text;
      }}
      onMouseLeave={(event) => {
        event.currentTarget.style.background = "transparent";
        event.currentTarget.style.color = T.dim;
      }}
    >
      {children}
    </button>
  );
}

function FieldError({ text }: { text: string }) {
  const T = useTheme();

  return (
    <motion.div
      initial={{ opacity: 0, y: -4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.15 }}
      style={{
        marginTop: 8,
        fontSize: 12.5,
        color: T.accent,
        fontFamily: T.sans,
        fontWeight: 500,
      }}
    >
      {text}
    </motion.div>
  );
}

function EyeIcon() {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
      <circle cx={12} cy={12} r={3} />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 3l18 18" />
      <path d="M10.58 10.58a3 3 0 0 0 4.24 4.24" />
      <path d="M9.88 5.09A10.94 10.94 0 0 1 12 5c6.5 0 10 7 10 7a17.55 17.55 0 0 1-3.17 4.19" />
      <path d="M6.61 6.61A17.78 17.78 0 0 0 2 12s3.5 7 10 7a10.9 10.9 0 0 0 5.39-1.44" />
    </svg>
  );
}

function PasteIcon() {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <rect x={8} y={3} width={8} height={4} rx={1} />
      <path d="M16 5h2a2 2 0 0 1 2 2v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h2" />
    </svg>
  );
}
