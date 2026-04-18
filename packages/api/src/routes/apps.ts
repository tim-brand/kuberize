import { Hono } from "hono";
import { z } from "zod";
import { customApi } from "../k8s-client.js";
import { GROUP, SYSTEM_NAMESPACE, VERSION, is404 } from "../k8s-helpers.js";

const PLURAL = "kuberizeapps";

const MERGE_HEADERS = {
  headers: { "Content-Type": "application/merge-patch+json" },
};

const CreateAppBody = z.object({
  name: z.string(),
  projectRef: z.string(),
  appName: z.string(),
  environment: z.string(),
  image: z.string(),
  repo: z
    .object({
      url: z.string(),
      branch: z.string(),
      path: z.string(),
      secretRef: z.string(),
    })
    .optional(),
  registry: z.object({ url: z.string(), secretRef: z.string() }).optional(),
  serviceRefs: z
    .array(
      z.object({
        name: z.string(),
        envMappings: z.array(z.object({ envVar: z.string(), key: z.string() })),
      })
    )
    .optional(),
  env: z.array(z.object({ name: z.string(), value: z.string() })).optional(),
  expose: z.object({ port: z.number(), healthCheck: z.string().optional() }),
  domain: z.string(),
  resources: z.object({
    requests: z.object({ cpu: z.string(), memory: z.string() }),
    limits: z.object({ cpu: z.string(), memory: z.string() }),
  }),
  replicas: z.number().default(1),
});

const DeployBody = z.object({
  image: z.string(),
  commit: z
    .object({ sha: z.string(), message: z.string(), author: z.string() })
    .optional(),
});

export const apps = new Hono();

apps.get("/", async (c) => {
  const projectId = c.req.param("projectId");
  const { body } = await customApi.listNamespacedCustomObject(
    GROUP,
    VERSION,
    SYSTEM_NAMESPACE,
    PLURAL
  );
  const items = ((body as { items?: unknown[] }).items ?? []).filter((it) => {
    const spec = (it as { spec?: { projectRef?: string } }).spec;
    return spec?.projectRef === projectId;
  });
  return c.json({ items });
});

apps.get("/:appId", async (c) => {
  const id = c.req.param("appId");
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

apps.post("/", async (c) => {
  const input = CreateAppBody.parse(await c.req.json());
  const { name, ...spec } = input;
  const resource = {
    apiVersion: `${GROUP}/${VERSION}`,
    kind: "KuberizeApp",
    metadata: { name, namespace: SYSTEM_NAMESPACE },
    spec,
  };
  const { body } = await customApi.createNamespacedCustomObject(
    GROUP,
    VERSION,
    SYSTEM_NAMESPACE,
    PLURAL,
    resource
  );
  return c.json(body, 201);
});

apps.post("/:appId/deploy", async (c) => {
  const id = c.req.param("appId");
  const input = DeployBody.parse(await c.req.json());
  const { body } = await customApi.patchNamespacedCustomObject(
    GROUP,
    VERSION,
    SYSTEM_NAMESPACE,
    PLURAL,
    id,
    { spec: { image: input.image } },
    undefined,
    undefined,
    undefined,
    MERGE_HEADERS
  );
  if (input.commit) {
    await customApi.patchNamespacedCustomObjectStatus(
      GROUP,
      VERSION,
      SYSTEM_NAMESPACE,
      PLURAL,
      id,
      { status: { lastCommit: input.commit } },
      undefined,
      undefined,
      undefined,
      MERGE_HEADERS
    );
  }
  return c.json(body);
});

apps.post("/:appId/stop", async (c) => {
  const id = c.req.param("appId");
  const { body } = await customApi.patchNamespacedCustomObject(
    GROUP,
    VERSION,
    SYSTEM_NAMESPACE,
    PLURAL,
    id,
    { spec: { replicas: 0 } },
    undefined,
    undefined,
    undefined,
    MERGE_HEADERS
  );
  return c.json(body);
});

apps.post("/:appId/start", async (c) => {
  const id = c.req.param("appId");
  const { body } = await customApi.patchNamespacedCustomObject(
    GROUP,
    VERSION,
    SYSTEM_NAMESPACE,
    PLURAL,
    id,
    { spec: { replicas: 1 } },
    undefined,
    undefined,
    undefined,
    MERGE_HEADERS
  );
  return c.json(body);
});

apps.delete("/:appId", async (c) => {
  const id = c.req.param("appId");
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
  return c.body(null, 204);
});
