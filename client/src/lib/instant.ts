import { LOCAL_ONLY } from "./local-mode";

export type * from "./cloud-db";

type CloudDb = typeof import("./cloud-db").db;
export const db: CloudDb = LOCAL_ONLY
  ? (await import("./local-db")).makeLocalDb() as unknown as CloudDb
  : (await import("./cloud-db")).db;
