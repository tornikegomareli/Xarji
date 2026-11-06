import { useSyncExternalStore } from "react";
import { localApi } from "./local-api";

type Row = { id: string; [key: string]: unknown };
type Operation = { collection: string; id: string; kind: "update" | "delete"; value?: Record<string, unknown>; unset?: string[] };
const listeners = new Set<() => void>();
const EMPTY: Row[] = [];
let data: Record<string, Row[]> = {};
let loading = true;
let error: Error | undefined;
let timer: ReturnType<typeof setInterval> | undefined;
let inFlight: Promise<void> | undefined;
let revision = 0;
let generation = 0;
function notify() { revision++; for (const fn of listeners) fn(); }

export function clearLocalData() { generation++; inFlight = undefined; data = {}; loading = true; error = undefined; notify(); }
export async function refreshLocalData(): Promise<void> {
  if (inFlight) return inFlight;
  const currentGeneration = generation;
  inFlight = (async () => {
    try {
      const result = await localApi<{ data: Record<string, Row[]> }>("/api/snapshot");
      if (generation !== currentGeneration) return;
      data = result.data;
      // Legacy view models accept rawMessage; local records never contain it.
      for (const collection of ["payments", "credits", "failedPayments"]) {
        data[collection] = (data[collection] ?? []).map(row => ({ ...row, rawMessage: "" }));
      }
      error = undefined;
    } catch { if (generation === currentGeneration) error = new Error("Local data could not be refreshed"); }
    finally { if (generation === currentGeneration) { loading = false; inFlight = undefined; notify(); } }
  })();
  return inFlight;
}

function subscribe(fn: () => void) {
  listeners.add(fn);
  if (!timer) { void refreshLocalData(); timer = setInterval(() => void refreshLocalData(), 4000); }
  return () => { listeners.delete(fn); if (!listeners.size) { clearInterval(timer); timer = undefined; } };
}
export function useLocalDataStatus() {
  useSyncExternalStore(subscribe, () => revision);
  return { error, loading };
}

function update(collection: string, id: string, value: Record<string, unknown>): Operation {
  return { collection, id, kind: "update", value: Object.fromEntries(Object.entries(value).filter(([, v]) => v !== undefined)), unset: Object.keys(value).filter(key => value[key] === undefined) };
}

export function makeLocalDb() {
  const tx = new Proxy({}, { get: (_target, collection: string) => new Proxy({}, {
    get: (_inner, id: string) => ({
      update: (value: Record<string, unknown>): Operation => update(collection, id, value),
      merge: (value: Record<string, unknown>): Operation => update(collection, id, value),
      delete: (): Operation => ({ collection, id, kind: "delete" }),
    }),
  }) });
  return {
    tx,
    useQuery(query: Record<string, unknown>) {
      useSyncExternalStore(subscribe, () => revision);
      return { data: Object.fromEntries(Object.keys(query).map(name => [name, data[name] ?? EMPTY])), isLoading: loading, error };
    },
    async transact(input: unknown | unknown[]) {
      await localApi("/api/transact", { method: "POST", body: JSON.stringify({ operations: Array.isArray(input) ? input : [input] }) });
      await refreshLocalData();
      return null;
    },
  };
}
