export const LOCAL_ONLY = import.meta.env.VITE_XARJI_LOCAL_ONLY === "true";

export const id = LOCAL_ONLY
  ? () => crypto.randomUUID()
  : (await import("@instantdb/react")).id;
