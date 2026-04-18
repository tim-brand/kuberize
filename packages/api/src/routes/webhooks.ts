import { Hono } from "hono";
import { z } from "zod";
import { createHmac, timingSafeEqual } from "node:crypto";
import { customApi } from "../k8s-client.js";
import { GROUP, SYSTEM_NAMESPACE, VERSION, is404 } from "../k8s-helpers.js";
import { slugify } from "@kuberize/shared";

const APPS_PLURAL = "kuberizeapps";

const DeployBody = z.object({
  project: z.string(),
  app: z.string(),
  environment: z.string().optional(),
  image: z.string(),
  commit: z
    .object({ sha: z.string(), message: z.string(), author: z.string() })
    .optional(),
});

const deploy = new Hono();

deploy.post("/", async (c) => {
  const input = DeployBody.parse(await c.req.json());

  // Derive target app CRD name(s): <project>-<app>-<env>
  const project = slugify(input.project);
  const app = slugify(input.app);

  let targetNames: string[];
  if (input.environment) {
    targetNames = [`${project}-${app}-${slugify(input.environment)}`];
  } else {
    // No env specified — find all KuberizeApps for this project+app and deploy to each
    const { body } = await customApi.listNamespacedCustomObject(
      GROUP,
      VERSION,
      SYSTEM_NAMESPACE,
      APPS_PLURAL
    );
    const items = (body as { items?: unknown[] }).items ?? [];
    targetNames = items
      .filter((it) => {
        const spec = (it as { spec?: { projectRef?: string; appName?: string } }).spec;
        return spec?.projectRef === project && spec?.appName === app;
      })
      .map((it) => {
        const name = (it as { metadata?: { name?: string } }).metadata?.name;
        return typeof name === "string" ? name : "";
      })
      .filter(Boolean);
  }

  const patched: string[] = [];
  const missing: string[] = [];

  for (const name of targetNames) {
    try {
      await customApi.patchNamespacedCustomObject(
        GROUP,
        VERSION,
        SYSTEM_NAMESPACE,
        APPS_PLURAL,
        name,
        { spec: { image: input.image } },
        undefined,
        undefined,
        undefined,
        { headers: { "Content-Type": "application/merge-patch+json" } }
      );
      if (input.commit) {
        await customApi.patchNamespacedCustomObjectStatus(
          GROUP,
          VERSION,
          SYSTEM_NAMESPACE,
          APPS_PLURAL,
          name,
          { status: { lastCommit: input.commit } },
          undefined,
          undefined,
          undefined,
          { headers: { "Content-Type": "application/merge-patch+json" } }
        );
      }
      patched.push(name);
    } catch (err) {
      if (is404(err)) {
        missing.push(name);
        continue;
      }
      throw err;
    }
  }

  return c.json({ patched, missing });
});

const github = new Hono();

github.post("/", async (c) => {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret) {
    return c.json({ error: "GITHUB_WEBHOOK_SECRET not configured" }, 500);
  }

  const signature = c.req.header("X-Hub-Signature-256");
  if (!signature?.startsWith("sha256=")) {
    return c.json({ error: "missing or invalid signature" }, 401);
  }

  const rawBody = await c.req.text();
  const expected = "sha256=" + createHmac("sha256", secret).update(rawBody).digest("hex");

  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) {
    return c.json({ error: "invalid signature" }, 401);
  }

  const event = c.req.header("X-GitHub-Event");
  console.log(`[github webhook] verified ${event} event`);

  // Full push event → CRD sync is deferred. Acknowledge for now.
  return c.json({ ok: true, event, processed: false });
});

export const webhooks = { deploy, github };
