import "server-only";
import type {
  KuberizeProject,
  KuberizeApp,
  KuberizeService,
} from "@kuberize/shared";

const BASE_URL = process.env.KUBERIZE_API_URL ?? "http://localhost:3001";
const API_KEY = process.env.KUBERIZE_API_KEY ?? "dev-key";

type FetchOptions = { method?: string; body?: unknown };

async function call<T>(path: string, { method = "GET", body }: FetchOptions = {}) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    cache: "no-store",
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${method} ${path} → ${res.status}: ${text}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export const api = {
  listProjects: () =>
    call<{ items: KuberizeProject[] }>("/api/v1/projects"),

  getProject: (id: string) =>
    call<KuberizeProject>(`/api/v1/projects/${id}`),

  createProject: (body: {
    name: string;
    displayName?: string;
    repoUrl: string;
    repoBranch?: string;
    githubToken: string;
    registry: { url: string; username: string; password: string };
    baseDomain: string;
    clusterIssuer?: string;
  }) => call<KuberizeProject>("/api/v1/projects", { method: "POST", body }),

  deleteProject: (id: string) =>
    call<void>(`/api/v1/projects/${id}`, { method: "DELETE" }),

  listApps: (projectId: string) =>
    call<{ items: KuberizeApp[] }>(`/api/v1/projects/${projectId}/apps`),

  listServices: (projectId: string) =>
    call<{ items: KuberizeService[] }>(`/api/v1/projects/${projectId}/services`),
};
