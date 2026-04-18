import type { CliConfig } from "./config.js";

type FetchOptions = { method?: string; body?: unknown };

export async function apiCall<T>(
  config: CliConfig,
  path: string,
  { method = "GET", body }: FetchOptions = {}
) {
  const res = await fetch(`${config.url}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${config.key}`,
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${method} ${path} failed (${res.status}): ${text}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}
