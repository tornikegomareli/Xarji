import { useCallback, useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { useTheme } from "../ink/theme";
import {
  AppIdStep,
  BanksStep,
  PreviewStep,
  TokenStep,
  WelcomeStep,
  type BankOption,
} from "./OnboardingSteps";

export interface SerializedField {
  id: string;
  label: string;
  kind: "string" | "secret" | "multiselect" | "boolean";
  required: boolean;
  help?: string;
  placeholder?: string;
  patternSource?: string;
  patternMessage?: string;
  options?: BankOption[];
  minSelections?: number;
  default?: unknown;
}

interface SetupGetResponse {
  configured: boolean;
  schema: { fields: SerializedField[]; steps: unknown[] };
  currentValues: Record<string, unknown>;
}

export type FieldValues = {
  instantAppId: string;
  instantAdminToken: string;
  bankSenderIds: string[];
};

export const SETUP_TRANSITION_FLAG = "xarji-setup-transition";

type SetupStep = "welcome" | "app-id" | "token" | "banks" | "preview";

const STEP_ORDER: SetupStep[] = ["welcome", "app-id", "token", "banks", "preview"];

const UUID_REGEX =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

const STEP_TRANSITION = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0 },
  exit: { opacity: 0, y: -8 },
  transition: { duration: 0.2, ease: [0.32, 0.72, 0, 1] as [number, number, number, number] },
};

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

/**
 * Poll /api/health until it reports `state: "running"`. Returns when
 * running, or after the timeout — we don't throw, since the reload path
 * still works (Layout will hold the splash for a bit longer if needed).
 */
async function waitForRunning(timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch("/api/health");
      if (res.ok) {
        const body = (await res.json()) as { state?: string };
        if (body.state === "running") return;
      }
    } catch {
      // Network blip during a hot-swap; retry.
    }
    await delay(250);
  }
}

export function readSetupTransitionFlag(): boolean {
  if (typeof window === "undefined") return false;
  return window.sessionStorage.getItem(SETUP_TRANSITION_FLAG) === "1";
}

export function persistSetupTransitionFlag() {
  if (typeof window === "undefined") return;
  window.sessionStorage.setItem(SETUP_TRANSITION_FLAG, "1");
}

export function clearSetupTransitionFlag() {
  if (typeof window === "undefined") return;
  window.sessionStorage.removeItem(SETUP_TRANSITION_FLAG);
}

export function Onboarding() {
  const T = useTheme();
  const [step, setStep] = useState<SetupStep>("welcome");
  const [values, setValues] = useState<FieldValues>({
    instantAppId: "",
    instantAdminToken: "",
    bankSenderIds: ["SOLO"],
  });
  const [fieldMeta, setFieldMeta] = useState<Record<string, SerializedField>>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [previewReady, setPreviewReady] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch("/api/setup");
        if (!res.ok) return;
        const body = (await res.json()) as SetupGetResponse;
        if (cancelled) return;

        const meta: Record<string, SerializedField> = {};
        for (const field of body.schema.fields) meta[field.id] = field;
        setFieldMeta(meta);

        setValues((current) => {
          const next = { ...current };

          if (typeof body.currentValues.instantAppId === "string" && body.currentValues.instantAppId) {
            next.instantAppId = body.currentValues.instantAppId;
          }

          if (
            Array.isArray(body.currentValues.bankSenderIds) &&
            body.currentValues.bankSenderIds.length > 0
          ) {
            next.bankSenderIds = body.currentValues.bankSenderIds as string[];
          }

          return next;
        });
      } catch {
        // Keep the bundled defaults when schema fetch is unavailable.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, []);

  const stepIndex = STEP_ORDER.indexOf(step);

  const canContinue = useMemo<Record<SetupStep, boolean>>(
    () => ({
      welcome: true,
      "app-id": UUID_REGEX.test(values.instantAppId.trim()),
      token: values.instantAdminToken.trim().length >= 20,
      banks: values.bankSenderIds.length > 0,
      preview: previewReady,
    }),
    [previewReady, values]
  );

  const goTo = useCallback((target: SetupStep) => {
    setSubmitError(null);
    setStep(target);
  }, []);

  const setValue = useCallback(
    <K extends keyof FieldValues>(key: K, value: FieldValues[K]) => {
      setSubmitError(null);
      setValues((current) => ({ ...current, [key]: value }));
    },
    []
  );

  const submit = useCallback(async () => {
    setSubmitting(true);
    setSubmitError(null);
    persistSetupTransitionFlag();

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
        // Real validation failures: clear the flag so Layout drops the
        // splash and the user can read the inline error on the right step.
        clearSetupTransitionFlag();
        setSubmitting(false);

        if (body.fieldErrors?.instantAppId) {
          setSubmitError(body.fieldErrors.instantAppId);
          setStep("app-id");
          return;
        }

        if (body.fieldErrors?.instantAdminToken) {
          setSubmitError(body.fieldErrors.instantAdminToken);
          setStep("token");
          return;
        }

        if (body.fieldErrors?.bankSenderIds) {
          setSubmitError(body.fieldErrors.bankSenderIds);
          setStep("banks");
          return;
        }

        setSubmitError(body.error ?? "Setup failed");
        setStep("preview");
        return;
      }

      if (body.warning) {
        clearSetupTransitionFlag();
        setSubmitting(false);
        setSubmitError(body.warning);
        setStep("preview");
        return;
      }

      // Wait for /api/health to confirm the service is fully running
      // before reloading. With this guarantee in place, the post-reload
      // first poll resolves to "running" almost immediately and Layout
      // never has a window where it could fall through to Welcome.
      await waitForRunning(15000);
      await delay(120);
      window.location.reload();
    } catch (error) {
      // Network errors here are most likely transient (a `bun --watch`
      // restart killed the in-flight POST when service/.env was rewritten,
      // or similar). DO NOT clear the flag — Layout will keep showing the
      // setup splash and only dismiss it once /api/health flips to
      // "running" or "paused". After 12s, the splash exposes a Refresh
      // button as a manual escape hatch for genuinely-broken installs.
      setSubmitting(false);
      setSubmitError(error instanceof Error ? error.message : String(error));
      setStep("preview");
    }
  }, [values]);

  return (
    <div
      style={{
        minHeight: "100vh",
        background: T.bg,
        color: T.text,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "36px 24px 56px",
        position: "relative",
        overflow: "hidden",
      }}
    >
      <div
        aria-hidden
        style={{
          position: "absolute",
          top: -180,
          right: -160,
          width: 460,
          height: 460,
          borderRadius: "50%",
          background: T.accent,
          opacity: 0.08,
          filter: "blur(100px)",
          pointerEvents: "none",
        }}
      />

      <ProgressDots
        current={stepIndex}
        total={STEP_ORDER.length}
        onJump={(targetIndex) => {
          if (submitting || targetIndex >= stepIndex) return;
          goTo(STEP_ORDER[targetIndex]);
        }}
      />

      <div
        style={{
          width: "100%",
          maxWidth: 560,
          flex: 1,
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          alignItems: "stretch",
          position: "relative",
          zIndex: 1,
          minHeight: 480,
        }}
      >
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={step}
            initial={STEP_TRANSITION.initial}
            animate={STEP_TRANSITION.animate}
            exit={STEP_TRANSITION.exit}
            transition={STEP_TRANSITION.transition}
            style={{ width: "100%" }}
          >
            {step === "welcome" && <WelcomeStep onNext={() => goTo("app-id")} />}

            {step === "app-id" && (
              <AppIdStep
                value={values.instantAppId}
                onChange={(value) => setValue("instantAppId", value)}
                canAdvance={canContinue["app-id"]}
                onBack={() => goTo("welcome")}
                onNext={() => goTo("token")}
                fieldMeta={fieldMeta.instantAppId}
                submitError={submitError}
              />
            )}

            {step === "token" && (
              <TokenStep
                value={values.instantAdminToken}
                onChange={(value) => setValue("instantAdminToken", value)}
                canAdvance={canContinue.token}
                onBack={() => goTo("app-id")}
                onNext={() => goTo("banks")}
                fieldMeta={fieldMeta.instantAdminToken}
                submitError={submitError}
              />
            )}

            {step === "banks" && (
              <BanksStep
                selected={values.bankSenderIds}
                onChange={(value) => setValue("bankSenderIds", value)}
                canAdvance={canContinue.banks}
                onBack={() => goTo("token")}
                onNext={() => goTo("preview")}
                fieldMeta={fieldMeta.bankSenderIds}
              />
            )}

            {step === "preview" && (
              <PreviewStep
                senders={values.bankSenderIds}
                onBack={() => goTo("banks")}
                onFinish={() => void submit()}
                submitError={submitError}
                onReadyChange={setPreviewReady}
                submitting={submitting}
              />
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

function ProgressDots({
  current,
  total,
  onJump,
}: {
  current: number;
  total: number;
  onJump: (targetIndex: number) => void;
}) {
  const T = useTheme();

  return (
    <div
      style={{
        display: "flex",
        gap: 10,
        marginBottom: 40,
        minHeight: 10,
      }}
    >
      {Array.from({ length: total }, (_, index) => {
        const isActive = index === current;
        const isDone = index < current;

        return (
          <button
            key={index}
            type="button"
            aria-label={`Jump to step ${index + 1}`}
            disabled={!isDone}
            onClick={() => onJump(index)}
            style={{
              padding: 0,
              border: "none",
              background: "transparent",
              cursor: isDone ? "pointer" : "default",
              height: 6,
              display: "flex",
              alignItems: "center",
            }}
          >
            <motion.span
              layout
              initial={false}
              animate={{
                width: isActive ? 24 : 6,
                backgroundColor: isActive
                  ? T.accent
                  : isDone
                    ? `${T.accent}99`
                    : T.faint,
              }}
              transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
              style={{
                height: 6,
                borderRadius: 3,
                display: "block",
              }}
            />
          </button>
        );
      })}
    </div>
  );
}
