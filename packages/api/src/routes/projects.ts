import { Hono } from "hono";
import { z } from "zod";
import { coreApi, customApi } from "../k8s-client.js";
import { GROUP, SYSTEM_NAMESPACE, VERSION, is404 } from "../k8s-helpers.js";

const PLURAL = "kuberizeprojects";

const CreateProjectBody = z.object({
  name: z.string().regex(/^[a-z0-9][a-z0-9-]{0,61}[a-z0-9]$/, {
    message: "name must be a valid k8s slug",
  }),
  displayName: z.string().optional(),
  repoUrl: z.string().url(),
  repoBranch: z.string().default("main"),
  githubToken: z.string().min(1),
  registry: z.object({
    url: z.string().min(1),
    username: z.string().min(1),
    password: z.string().min(1),
  }),
  baseDomain: z.string().min(1),
  clusterIssuer: z.string().default("letsencrypt-prod"),
  environments: z.record(z.string(), z.object({ branch: z.string() })).optional(),
});

function buildDockerConfigJson(reg: { url: string; username: string; password: string }) {
  const auth = Buffer.from(`${reg.username}:${reg.password}`).toString("base64");
  // Extract just the registry host from the URL (first path segment stripped)
  const host = reg.url.replace(/^https?:\/\//, "").split("/")[0] ?? reg.url;
  const config = { auths: { [host]: { username: reg.username, password: reg.password, auth } } };
  return Buffer.from(JSON.stringify(config)).toString("base64");
}

async function upsertSecret(name: string, type: string, data: Record<string, string>) {
  const encoded: Record<string, string> = {};
  for (const [k, v] of Object.entries(data)) {
    encoded[k] = Buffer.from(v).toString("base64");
  }
  const body = {
    apiVersion: "v1",
    kind: "Secret",
    metadata: { name, namespace: SYSTEM_NAMESPACE },
    type,
    data: encoded,
  };
  try {
    await coreApi.readNamespacedSecret(name, SYSTEM_NAMESPACE);
    await coreApi.replaceNamespacedSecret(name, SYSTEM_NAMESPACE, body);
  } catch (err) {
    if (!is404(err)) throw err;
    await coreApi.createNamespacedSecret(SYSTEM_NAMESPACE, body);
  }
}

async function upsertSecretRaw(name: string, type: string, data: Record<string, string>) {
  // Same as upsertSecret but data is already base64-encoded
  const body = {
    apiVersion: "v1",
    kind: "Secret",
    metadata: { name, namespace: SYSTEM_NAMESPACE },
    type,
    data,
  };
  try {
    await coreApi.readNamespacedSecret(name, SYSTEM_NAMESPACE);
    await coreApi.replaceNamespacedSecret(name, SYSTEM_NAMESPACE, body);
  } catch (err) {
    if (!is404(err)) throw err;
    await coreApi.createNamespacedSecret(SYSTEM_NAMESPACE, body);
  }
}

export const projects = new Hono();

projects.get("/", async (c) => {
  const { body } = await customApi.listNamespacedCustomObject(
    GROUP,
    VERSION,
    SYSTEM_NAMESPACE,
    PLURAL
  );
  const items = (body as { items?: unknown[] }).items ?? [];
  return c.json({ items });
});

projects.get("/:projectId", async (c) => {
  const id = c.req.param("projectId");
  try {
    const { body } = await customApi.getNamespacedCustomObject(
      GROUP,
      VERSION,
      SYSTEM_NAMESPACE,
      PLURAL,
      id
    );
    return c.json(body);
  } catch (err) {
    if (is404(err)) return c.json({ error: "not_found" }, 404);
    throw err;
  }
});

projects.post("/", async (c) => {
  const input = CreateProjectBody.parse(await c.req.json());

  const githubSecretName = `${input.name}-github`;
  const registrySecretName = `${input.name}-registry`;

  await upsertSecret(githubSecretName, "Opaque", { token: input.githubToken });
  await upsertSecretRaw(registrySecretName, "kubernetes.io/dockerconfigjson", {
    ".dockerconfigjson": buildDockerConfigJson(input.registry),
  });

  const project = {
    apiVersion: `${GROUP}/${VERSION}`,
    kind: "KuberizeProject",
    metadata: { name: input.name, namespace: SYSTEM_NAMESPACE },
    spec: {
      displayName: input.displayName ?? input.name,
      repo: {
        url: input.repoUrl,
        branch: input.repoBranch,
        secretRef: githubSecretName,
      },
      registry: {
        url: input.registry.url,
        secretRef: registrySecretName,
      },
      baseDomain: input.baseDomain,
      clusterIssuer: input.clusterIssuer,
      ...(input.environments ? { environments: input.environments } : {}),
    },
  };

  try {
    const { body } = await customApi.createNamespacedCustomObject(
      GROUP,
      VERSION,
      SYSTEM_NAMESPACE,
      PLURAL,
      project
    );
    return c.json(body, 201);
  } catch (err) {
    if (
      typeof err === "object" &&
      err !== null &&
      "statusCode" in err &&
      (err as { statusCode?: number }).statusCode === 409
    ) {
      return c.json({ error: "already_exists" }, 409);
    }
    throw err;
  }
});

projects.delete("/:projectId", async (c) => {
  const id = c.req.param("projectId");
  try {
    await customApi.deleteNamespacedCustomObject(
      GROUP,
      VERSION,
      SYSTEM_NAMESPACE,
      PLURAL,
      id
    );
  } catch (err) {
    if (!is404(err)) throw err;
  }
  // Best-effort secret cleanup
  for (const name of [`${id}-github`, `${id}-registry`]) {
    try {
      await coreApi.deleteNamespacedSecret(name, SYSTEM_NAMESPACE);
    } catch (err) {
      if (!is404(err)) throw err;
    }
  }
  return c.body(null, 204);
});
