import { Hono } from "hono";
import { coreApi, customApi } from "../k8s-client.js";
import { GROUP, SYSTEM_NAMESPACE, VERSION, is404 } from "../k8s-helpers.js";
import { normalizeRepoUrl } from "@kuberize/shared";

const PROJECTS_PLURAL = "kuberizeprojects";
const GITHUB_API = "https://api.github.com";

function parseGithubRepo(url: string) {
  const match = normalizeRepoUrl(url).match(/^github\.com\/([^/]+)\/([^/]+)$/);
  const owner = match?.[1];
  const repo = match?.[2];
  if (!owner || !repo) return undefined;
  return { owner, repo };
}

function githubHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "kuberize-api",
    "Content-Type": "application/json",
  };
}

type GithubHook = {
  id: number;
  active: boolean;
  events: string[];
  config?: { url?: string };
  updated_at?: string;
  last_response?: { code: number | null; status: string };
};

function hookSummary(hook: GithubHook) {
  return {
    id: hook.id,
    active: hook.active,
    events: hook.events,
    updatedAt: hook.updated_at,
    lastResponse: hook.last_response,
  };
}

async function loadContext(projectId: string) {
  let rawProject: unknown;
  try {
    const result = await customApi.getNamespacedCustomObject(
      GROUP,
      VERSION,
      SYSTEM_NAMESPACE,
      PROJECTS_PLURAL,
      projectId
    );
    rawProject = result.body;
  } catch (err) {
    if (is404(err)) return { error: "project_not_found" as const };
    throw err;
  }

  const repo = (rawProject as { spec?: { repo?: { url?: string; secretRef?: string } } }).spec
    ?.repo;
  if (typeof repo?.url !== "string" || typeof repo.secretRef !== "string") {
    return { error: "project_not_found" as const };
  }

  const target = parseGithubRepo(repo.url);
  if (!target) return { error: "not_github" as const };

  const publicUrl = process.env.KUBERIZE_API_PUBLIC_URL;
  const webhookSecret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!publicUrl || !webhookSecret) {
    return { error: "not_configured" as const };
  }

  const secretResult = await coreApi.readNamespacedSecret(repo.secretRef, SYSTEM_NAMESPACE);
  const tokenB64 = ((secretResult.body as { data?: Record<string, string> }).data ?? {}).token;
  if (!tokenB64) return { error: "token_missing" as const };
  const token = Buffer.from(tokenB64, "base64").toString("utf8");

  const payloadUrl = `${publicUrl.replace(/\/+$/, "")}/webhooks/github`;
  const manual = { payloadUrl, contentType: "application/json", secret: webhookSecret };

  return { target, token, payloadUrl, manual };
}

async function listHooks(ctx: { target: { owner: string; repo: string }; token: string }) {
  const res = await fetch(`${GITHUB_API}/repos/${ctx.target.owner}/${ctx.target.repo}/hooks`, {
    headers: githubHeaders(ctx.token),
  });
  // GitHub answers 404 (or 403) when the token can't administer hooks on the repo.
  if (res.status === 401 || res.status === 403 || res.status === 404) {
    return { denied: true as const };
  }
  if (!res.ok) {
    throw new Error(`GitHub hook listing failed: ${res.status} ${await res.text()}`);
  }
  return { hooks: (await res.json()) as GithubHook[] };
}

export const projectWebhook = new Hono();

projectWebhook.get("/", async (c) => {
  const projectId = c.req.param("projectId") ?? "";
  const ctx = await loadContext(projectId);
  if ("error" in ctx) {
    if (ctx.error === "project_not_found") return c.json({ error: ctx.error }, 404);
    return c.json({ configured: false, canCreate: false, error: ctx.error });
  }

  const listed = await listHooks(ctx);
  if ("denied" in listed) {
    return c.json({
      payloadUrl: ctx.payloadUrl,
      configured: false,
      canCreate: false,
      error: "token_scope",
      manual: ctx.manual,
    });
  }

  const existing = listed.hooks.find((h) => h.config?.url === ctx.payloadUrl);
  if (existing) {
    return c.json({
      payloadUrl: ctx.payloadUrl,
      configured: true,
      canCreate: true,
      hook: hookSummary(existing),
    });
  }
  return c.json({
    payloadUrl: ctx.payloadUrl,
    configured: false,
    canCreate: true,
    manual: ctx.manual,
  });
});

projectWebhook.post("/", async (c) => {
  const projectId = c.req.param("projectId") ?? "";
  const ctx = await loadContext(projectId);
  if ("error" in ctx) {
    if (ctx.error === "project_not_found") return c.json({ error: ctx.error }, 404);
    return c.json({ error: ctx.error }, 422);
  }

  const listed = await listHooks(ctx);
  if ("denied" in listed) {
    return c.json({ error: "token_scope", manual: ctx.manual }, 422);
  }

  const existing = listed.hooks.find((h) => h.config?.url === ctx.payloadUrl);
  if (existing) {
    return c.json({ created: false, configured: true, hook: hookSummary(existing) });
  }

  const res = await fetch(`${GITHUB_API}/repos/${ctx.target.owner}/${ctx.target.repo}/hooks`, {
    method: "POST",
    headers: githubHeaders(ctx.token),
    body: JSON.stringify({
      name: "web",
      active: true,
      events: ["push"],
      config: {
        url: ctx.payloadUrl,
        content_type: "json",
        secret: ctx.manual.secret,
      },
    }),
  });
  if (res.status === 401 || res.status === 403 || res.status === 404) {
    return c.json({ error: "token_scope", manual: ctx.manual }, 422);
  }
  if (!res.ok) {
    throw new Error(`GitHub hook creation failed: ${res.status} ${await res.text()}`);
  }
  const hook = (await res.json()) as GithubHook;
  console.log(
    `[project-webhook] created push webhook ${hook.id} on ${ctx.target.owner}/${ctx.target.repo} for project "${projectId}"`
  );
  return c.json({ created: true, configured: true, hook: hookSummary(hook) }, 201);
});
