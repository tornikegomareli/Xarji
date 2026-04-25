// Mutable in-memory `db` shaped like @instantdb/react's init() return.
// Implements the subset the client actually uses: useQuery, transact, tx.
// Mutations apply to a module-level store and notify subscribers via
// useSyncExternalStore so toggling a bank sender or deleting a category
// re-renders consumers — important for demo recordings to look real.

import { useSyncExternalStore } from "react";
import { buildDemoDataset, type DemoDataset } from "./demoData";

type AnyRecord = { id: string; [k: string]: unknown };
type Collection = keyof DemoDataset;

type Op =
  | { __op: true; collection: Collection; id: string; kind: "update"; value: Record<string, unknown> }
  | { __op: true; collection: Collection; id: string; kind: "delete" };

const store = new Map<Collection, AnyRecord[]>();
const listeners = new Set<() => void>();
const EMPTY: readonly AnyRecord[] = Object.freeze([]);

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

function notify() {
  for (const fn of listeners) fn();
}

function seed(dataset: DemoDataset) {
  store.set("payments", dataset.payments as unknown as AnyRecord[]);
  store.set("failedPayments", dataset.failedPayments as unknown as AnyRecord[]);
  store.set("credits", dataset.credits as unknown as AnyRecord[]);
  store.set("categories", dataset.categories as unknown as AnyRecord[]);
  store.set("bankSenders", dataset.bankSenders as unknown as AnyRecord[]);
}

function getSnapshot(collection: Collection): readonly AnyRecord[] {
  return store.get(collection) ?? EMPTY;
}

function applyOp(op: Op) {
  const current = store.get(op.collection) ?? [];
  if (op.kind === "delete") {
    store.set(op.collection, current.filter((r) => r.id !== op.id));
    return;
  }
  const idx = current.findIndex((r) => r.id === op.id);
  if (idx >= 0) {
    const next = current.slice();
    next[idx] = { ...next[idx], ...op.value };
    store.set(op.collection, next);
  } else {
    store.set(op.collection, [...current, { id: op.id, ...op.value } as AnyRecord]);
  }
}

// Mirrors the chainable shape of `db.tx.<collection>[id].update({...})`
// so existing call sites compile and produce op records `transact` can
// consume.
const tx = new Proxy(
  {},
  {
    get(_target, collectionName: string) {
      return new Proxy(
        {},
        {
          get(_t, recordId: string) {
            return {
              update: (value: Record<string, unknown>): Op => ({
                __op: true,
                collection: collectionName as Collection,
                id: recordId,
                kind: "update",
                value,
              }),
              merge: (value: Record<string, unknown>): Op => ({
                __op: true,
                collection: collectionName as Collection,
                id: recordId,
                kind: "update",
                value,
              }),
              delete: (): Op => ({
                __op: true,
                collection: collectionName as Collection,
                id: recordId,
                kind: "delete",
              }),
            };
          },
        }
      );
    },
  }
);

function isOp(value: unknown): value is Op {
  return typeof value === "object" && value !== null && (value as { __op?: unknown }).__op === true;
}

async function transact(input: unknown | unknown[]): Promise<null> {
  const ops = Array.isArray(input) ? input : [input];
  let mutated = false;
  for (const op of ops) {
    if (isOp(op)) {
      applyOp(op);
      mutated = true;
    }
  }
  if (mutated) notify();
  return null;
}

function useQuery(query: Record<string, unknown>) {
  const collection = Object.keys(query)[0] as Collection;
  const data = useSyncExternalStore(
    subscribe,
    () => getSnapshot(collection),
    () => getSnapshot(collection)
  );
  return { data: { [collection]: data }, isLoading: false, error: undefined };
}

export function makeDemoDb(seedKind: "default" | "empty") {
  store.clear();
  seed(buildDemoDataset(seedKind));
  return { useQuery, transact, tx };
}
