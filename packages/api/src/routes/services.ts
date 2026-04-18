import { Hono } from "hono";
import { z } from "zod";
import { customApi } from "../k8s-client.js";
import { GROUP, SYSTEM_NAMESPACE, VERSION, is404 } from "../k8s-helpers.js";

const PLURAL = "kuberizeservices";

const CreateServiceBody = z.object({
  name: z.string(),
  projectRef: z.string(),
  serviceName: z.string(),
  type: z.enum(["postgresql", "redis", "rabbitmq", "minio"]),
  version: z.string().optional(),
  plan: z.enum(["small", "medium", "large"]),
  scope: z.enum(["project", "app"]),
  appName: z.string().optional(),
  environment: z.string().optional(),
});

export const services = new Hono();

services.get("/", async (c) => {
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

services.get("/:serviceId", async (c) => {
  const id = c.req.param("serviceId");
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

services.post("/", async (c) => {
  const input = CreateServiceBody.parse(await c.req.json());
  const { name, ...spec } = input;
  const resource = {
    apiVersion: `${GROUP}/${VERSION}`,
    kind: "KuberizeService",
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

services.delete("/:serviceId", async (c) => {
  const id = c.req.param("serviceId");
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
