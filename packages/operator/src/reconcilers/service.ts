import { watch, coreApi, customApi } from "../k8s-client.js";
import { ReconcileQueue } from "../queue.js";
import { startHealthServer } from "../health.js";
import { type z } from "zod";
import {
  KuberizeServiceSchema,
  getAppNamespace,
  getSharedNamespace,
  getServiceSecretName,
  slugify,
} from "@kuberize/shared";
import { helmUninstall } from "../provisioners/base.js";
import { provisionPostgresql } from "../provisioners/postgresql.js";
import { provisionRedis } from "../provisioners/redis.js";
import { provisionRabbitmq } from "../provisioners/rabbitmq.js";
import { provisionMinio } from "../provisioners/minio.js";

const GROUP = "kuberize.io";
const VERSION = "v1alpha1";
const PLURAL = "kuberizeservices";
const NAMESPACE = "kuberize-system";

const DELETE_PREFIX = "delete:";

// Spec captured at DELETED watch event time — the CR is gone from the API server
// by the time the delete handler runs, so we need this snapshot to know what to clean up.
const pendingDeletes = new Map<string, z.infer<typeof KuberizeServiceSchema>>();

export function startServiceWatcher(health: ReturnType<typeof startHealthServer>) {
  const queue = new ReconcileQueue((key) => reconcileService(key, pendingDeletes));
  health.registerWatcher("kuberizeservices");

  watchLoop();

  async function watchLoop() {
    const path = `/apis/${GROUP}/${VERSION}/namespaces/${NAMESPACE}/${PLURAL}`;

    try {
      await watch.watch(
        path,
        {},
        (type: string, obj: unknown) => {
          if (
            typeof obj === "object" &&
            obj !== null &&
            "metadata" in obj &&
            typeof (obj as Record<string, unknown>).metadata === "object" &&
            (obj as Record<string, unknown>).metadata !== null
          ) {
            const metadata = (obj as Record<string, unknown>).metadata as Record<string, unknown>;
            const name = metadata.name;
            if (typeof name === "string") {
              if (type === "ADDED" || type === "MODIFIED") {
                queue.enqueue(`${NAMESPACE}/${name}`);
              } else if (type === "DELETED") {
                const parsed = KuberizeServiceSchema.safeParse(obj);
                if (parsed.success) {
                  pendingDeletes.set(name, parsed.data);
                  queue.enqueue(`${DELETE_PREFIX}${NAMESPACE}/${name}`);
                } else {
                  console.error(
                    `[ServiceWatcher] Failed to parse DELETED event for "${name}":`,
                    parsed.error
                  );
                }
              } else if (type === "ERROR") {
                console.error("[ServiceWatcher] Watch event error:", obj);
              }
            }
          }
        },
        (err: unknown) => {
          health.markWatcherDisconnected("kuberizeservices");
          if (err) {
            console.error("[ServiceWatcher] Watch stream ended with error:", err);
          } else {
            console.log("[ServiceWatcher] Watch stream ended, reconnecting in 5s...");
          }
          setTimeout(() => watchLoop(), 5000);
        }
      );

      health.markWatcherConnected("kuberizeservices");
    } catch (err) {
      health.markWatcherDisconnected("kuberizeservices");
      console.error("[ServiceWatcher] Failed to start watch, reconnecting in 5s:", err);
      setTimeout(() => watchLoop(), 5000);
    }
  }
}

async function reconcileService(
  key: string,
  pendingDeletes: Map<string, z.infer<typeof KuberizeServiceSchema>>
) {
  if (key.startsWith(DELETE_PREFIX)) {
    return deleteService(key.slice(DELETE_PREFIX.length), pendingDeletes);
  }

  const slashIdx = key.indexOf("/");
  const name = slashIdx !== -1 ? key.slice(slashIdx + 1) : undefined;
  if (!name) throw new Error(`Invalid key: ${key}`);

  console.log(`[reconcileService] Reconciling service "${name}"`);

  let rawBody: unknown;
  try {
    const result = await customApi.getNamespacedCustomObject(
      GROUP,
      VERSION,
      NAMESPACE,
      PLURAL,
      name
    );
    rawBody = result.body;
  } catch (err) {
    throw new Error(`[reconcileService] Failed to fetch service "${name}": ${err}`);
  }

  let service: z.infer<typeof KuberizeServiceSchema>;
  try {
    service = KuberizeServiceSchema.parse(rawBody);
  } catch (err) {
    throw new Error(`[reconcileService] Failed to validate service "${name}": ${err}`);
  }

  const { spec, metadata, status } = service;
  const generation = metadata.generation;

  if (
    status?.phase === "Ready" &&
    generation !== undefined &&
    status.observedGeneration === generation
  ) {
    console.log(
      `[reconcileService] Service "${name}" already Ready for generation ${generation}, skipping`
    );
    return;
  }

  const secretName = getServiceSecretName(spec.projectRef, spec.serviceName);
  const existingSecrets = await readExistingSecrets(secretName);

  try {
    await customApi.patchNamespacedCustomObjectStatus(
      GROUP,
      VERSION,
      NAMESPACE,
      PLURAL,
      name,
      { status: { phase: "Provisioning" } },
      undefined,
      undefined,
      undefined,
      { headers: { "Content-Type": "application/merge-patch+json" } }
    );
  } catch (err) {
    console.warn(`[reconcileService] Failed to patch Provisioning status for "${name}":`, err);
  }

  const targetNamespace =
    spec.scope === "project"
      ? getSharedNamespace(spec.projectRef)
      : getAppNamespace(spec.projectRef, spec.environment ?? "");

  const release = `kz-${slugify(spec.serviceName)}`;

  let connectionDetails: Record<string, string>;

  try {
    if (spec.type === "postgresql") {
      connectionDetails = await provisionPostgresql(release, targetNamespace, spec.version, spec.plan, existingSecrets?.password);
    } else if (spec.type === "redis") {
      connectionDetails = await provisionRedis(release, targetNamespace, spec.version, spec.plan, existingSecrets?.password);
    } else if (spec.type === "rabbitmq") {
      connectionDetails = await provisionRabbitmq(release, targetNamespace, spec.version, spec.plan, existingSecrets?.password);
    } else {
      connectionDetails = await provisionMinio(release, targetNamespace, spec.version, spec.plan, existingSecrets?.secretKey);
    }
  } catch (err) {
    throw new Error(`[reconcileService] Failed to provision "${name}" (${spec.type}): ${err}`);
  }

  try {
    await upsertConnectionSecret(secretName, connectionDetails);
  } catch (err) {
    throw new Error(`[reconcileService] Failed to create connection secret for "${name}": ${err}`);
  }

  try {
    await customApi.patchNamespacedCustomObjectStatus(
      GROUP,
      VERSION,
      NAMESPACE,
      PLURAL,
      name,
      {
        status: {
          phase: "Ready",
          observedGeneration: generation,
          connectionSecretRef: secretName,
          namespace: targetNamespace,
        },
      },
      undefined,
      undefined,
      undefined,
      { headers: { "Content-Type": "application/merge-patch+json" } }
    );
  } catch (err) {
    console.error(`[reconcileService] Failed to patch Ready status for "${name}":`, err);
    throw err;
  }

  console.log(`[reconcileService] Service "${name}" provisioned successfully`);
}

async function deleteService(
  key: string,
  pendingDeletes: Map<string, z.infer<typeof KuberizeServiceSchema>>
) {
  const slashIdx = key.indexOf("/");
  const name = slashIdx !== -1 ? key.slice(slashIdx + 1) : undefined;
  if (!name) throw new Error(`Invalid delete key: ${key}`);

  const service = pendingDeletes.get(name);
  if (!service) {
    console.warn(`[reconcileService] No pending delete snapshot for "${name}", skipping cleanup`);
    return;
  }

  console.log(`[reconcileService] Deleting service "${name}"`);

  const { spec } = service;

  const targetNamespace =
    spec.scope === "project"
      ? getSharedNamespace(spec.projectRef)
      : getAppNamespace(spec.projectRef, spec.environment ?? "");

  const release = `kz-${slugify(spec.serviceName)}`;

  await helmUninstall(release, targetNamespace);

  const secretName = getServiceSecretName(spec.projectRef, spec.serviceName);
  try {
    await coreApi.deleteNamespacedSecret(secretName, NAMESPACE);
    console.log(`[reconcileService] Deleted connection secret "${secretName}"`);
  } catch (err) {
    if (
      typeof err === "object" &&
      err !== null &&
      "statusCode" in err &&
      err.statusCode === 404
    ) {
      console.log(`[reconcileService] Connection secret "${secretName}" already gone`);
    } else {
      throw err;
    }
  }

  pendingDeletes.delete(name);
  console.log(`[reconcileService] Service "${name}" cleaned up`);
}

async function readExistingSecrets(secretName: string) {
  try {
    const result = await coreApi.readNamespacedSecret(secretName, NAMESPACE);
    const data = (result.body as { data?: Record<string, string> }).data;
    if (!data) return undefined;
    const decoded: Record<string, string> = {};
    for (const [k, v] of Object.entries(data)) {
      decoded[k] = Buffer.from(v, "base64").toString("utf8");
    }
    return decoded;
  } catch (err) {
    if (
      typeof err === "object" &&
      err !== null &&
      "statusCode" in err &&
      err.statusCode === 404
    ) {
      return undefined;
    }
    throw err;
  }
}

async function upsertConnectionSecret(
  name: string,
  data: Record<string, string>
) {
  const encodedData: Record<string, string> = {};
  for (const [k, v] of Object.entries(data)) {
    encodedData[k] = Buffer.from(v).toString("base64");
  }

  const body = {
    apiVersion: "v1",
    kind: "Secret",
    metadata: { name, namespace: NAMESPACE },
    type: "Opaque",
    data: encodedData,
  };

  try {
    await coreApi.readNamespacedSecret(name, NAMESPACE);
    // Secret exists — replace it
    await coreApi.replaceNamespacedSecret(name, NAMESPACE, body);
    console.log(`[reconcileService] Updated connection secret "${name}"`);
  } catch (err) {
    if (
      typeof err === "object" &&
      err !== null &&
      "statusCode" in err &&
      err.statusCode === 404
    ) {
      await coreApi.createNamespacedSecret(NAMESPACE, body);
      console.log(`[reconcileService] Created connection secret "${name}"`);
    } else {
      throw err;
    }
  }
}
