let csrf = "";
export function setLocalCsrf(value: string) { csrf = value; }

export async function localApi<T = unknown>(path: string, init: RequestInit = {}): Promise<T> {
  const method = init.method ?? "GET";
  const headers = new Headers(init.headers);
  if (method !== "GET") {
    headers.set("content-type", "application/json");
    if (csrf) headers.set("x-xarji-csrf", csrf);
  }
  const res = await fetch(path, { ...init, headers, credentials: "same-origin", cache: "no-store" });
  if (res.status === 401 && path !== "/api/session") window.dispatchEvent(new Event("xarji-locked"));
  if (!res.ok) throw new Error(`Local request rejected (${res.status})`);
  return res.json() as Promise<T>;
}
