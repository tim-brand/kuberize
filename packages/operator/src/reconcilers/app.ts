import { watch, customApi } from "../k8s-client.js";
import { ReconcileQueue } from "../queue.js";
import { startHealthServer } from "../health.js";
import { type z } from "zod";
import { KuberizeAppSchema, KuberizeProjectSchema } from "@kuberize/shared";
import { deployApp, deleteAppResources } from "../deployer.js";

const GROUP = "kuberize.io";
const VERSION = "v1alpha1";
const PLURAL = "kuberizeapps";
const PROJECTS_PLURAL = "kuberizeprojects";
const NAMESPACE = "kuberize-system";

const DELETE_PREFIX = "delete:";

const pendingDeletes = new Map<string, z.infer<typeof KuberizeAppSchema>>();

export function startAppWatcher(health: ReturnType<typeof startHealthServer>) {
  const queue = new ReconcileQueue((key) => reconcileApp(key, pendingDeletes));
  health.registerWatcher("kuberizeapps");

  watchLoop();

  async function watchLoop() {
    const path = `/apis/${GROUP}/${VERSION}/namespaces/${NAMESPACE}/${PLURAL}`;

    try {
      await watch.watch(
        path,
        {},
        (type: string, obj: unknown) => {
          if (
            typeof obj !== "object" ||
            obj === null ||
            !("metadata" in obj) ||
            typeof (obj as Record<string, unknown>).metadata !== "object" ||
            (obj as Record<string, unknown>).metadata === null
          ) {
            return;
          }
          const metadata = (obj as Record<string, unknown>).metadata as Record<
            string,
            unknown
          >;
          const name = metadata.name;
          if (typeof name !== "string") return;

          if (type === "ADDED" || type === "MODIFIED") {
            queue.enqueue(`${NAMESPACE}/${name}`);
          } else if (type === "DELETED") {
            const parsed = KuberizeAppSchema.safeParse(obj);
            if (parsed.success) {
              pendingDeletes.set(name, parsed.data);
              queue.enqueue(`${DELETE_PREFIX}${NAMESPACE}/${name}`);
            } else {
              console.error(
                `[AppWatcher] Failed to parse DELETED event for "${name}":`,
                parsed.error
              );
            }
          } else if (type === "ERROR") {
            console.error("[AppWatcher] Watch event error:", obj);
          }
        },
        (err: unknown) => {
          health.markWatcherDisconnected("kuberizeapps");
          if (err) {
            console.error("[AppWatcher] Watch stream ended with error:", err);
          } else {
            console.log("[AppWatcher] Watch stream ended, reconnecting in 5s...");
          }
          setTimeout(() => watchLoop(), 5000);
        }
      );

      health.markWatcherConnected("kuberizeapps");
    } catch (err) {
      health.markWatcherDisconnected("kuberizeapps");
      console.error("[AppWatcher] Failed to start watch, reconnecting in 5s:", err);
      setTimeout(() => watchLoop(), 5000);
    }
  }
}

async function reconcileApp(
  key: string,
  pendingDeletes: Map<string, z.infer<typeof KuberizeAppSchema>>
) {
  if (key.startsWith(DELETE_PREFIX)) {
    return deleteApp(key.slice(DELETE_PREFIX.length), pendingDeletes);
  }

  const slashIdx = key.indexOf("/");
  const name = slashIdx !== -1 ? key.slice(slashIdx + 1) : undefined;
  if (!name) throw new Error(`Invalid key: ${key}`);

  console.log(`[reconcileApp] Reconciling app "${name}"`);

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
    throw new Error(`[reconcileApp] Failed to fetch app "${name}": ${err}`);
  }

  let app: z.infer<typeof KuberizeAppSchema>;
  try {
    app = KuberizeAppSchema.parse(rawBody);
  } catch (err) {
    throw new Error(`[reconcileApp] Failed to validate app "${name}": ${err}`);
  }

  const { spec, metadata, status } = app;
  const generation = metadata.generation;

  if (
    status?.phase === "Running" &&
    generation !== undefined &&
    status.observedGeneration === generation &&
    status.observedImage === spec.image
  ) {
    console.log(
      `[reconcileApp] App "${name}" already Running for generation ${generation}, skipping`
    );
    return;
  }

  try {
    await customApi.patchNamespacedCustomObjectStatus(
      GROUP,
      VERSION,
      NAMESPACE,
      PLURAL,
      name,
      { status: { phase: "Deploying" } },
      undefined,
      undefined,
      undefined,
      { headers: { "Content-Type": "application/merge-patch+json" } }
    );
  } catch (err) {
    console.warn(`[reconcileApp] Failed to patch Deploying status for "${name}":`, err);
  }

  const clusterIssuer = await resolveClusterIssuer(spec.projectRef);

  let deployed: Awaited<ReturnType<typeof deployApp>>;
  try {
    deployed = await deployApp(app, clusterIssuer);
  } catch (err) {
    throw new Error(`[reconcileApp] Failed to deploy "${name}": ${err}`);
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
          phase: "Running",
          observedGeneration: generation,
          observedImage: spec.image,
          currentImage: spec.image,
          lastDeployedAt: new Date().toISOString(),
          url: deployed.url,
        },
      },
      undefined,
      undefined,
      undefined,
      { headers: { "Content-Type": "application/merge-patch+json" } }
    );
  } catch (err) {
    console.error(`[reconcileApp] Failed to patch Running status for "${name}":`, err);
    throw err;
  }

  console.log(`[reconcileApp] App "${name}" deployed successfully at ${deployed.url}`);
}

async function deleteApp(
  key: string,
  pendingDeletes: Map<string, z.infer<typeof KuberizeAppSchema>>
) {
  const slashIdx = key.indexOf("/");
  const name = slashIdx !== -1 ? key.slice(slashIdx + 1) : undefined;
  if (!name) throw new Error(`Invalid delete key: ${key}`);

  const app = pendingDeletes.get(name);
  if (!app) {
    console.warn(`[reconcileApp] No pending delete snapshot for "${name}", skipping cleanup`);
    return;
  }

  console.log(`[reconcileApp] Deleting app "${name}"`);
  await deleteAppResources(app);
  pendingDeletes.delete(name);
  console.log(`[reconcileApp] App "${name}" cleaned up`);
}

async function resolveClusterIssuer(projectRef: string) {
  try {
    const result = await customApi.getNamespacedCustomObject(
      GROUP,
      VERSION,
      NAMESPACE,
      PROJECTS_PLURAL,
      projectRef
    );
    const parsed = KuberizeProjectSchema.safeParse(result.body);
    if (parsed.success) return parsed.data.spec.clusterIssuer;
    return undefined;
  } catch {
    return undefined;
  }
}
