import { watch, coreApi, customApi } from "../k8s-client.js";
import { ReconcileQueue } from "../queue.js";
import { startHealthServer } from "../health.js";
import { type z } from "zod";
import { KuberizeProjectSchema, getAppNamespace, getSharedNamespace } from "@kuberize/shared";

const GROUP = "kuberize.io";
const VERSION = "v1alpha1";
const PLURAL = "kuberizeprojects";
const NAMESPACE = "kuberize-system";

export function startProjectWatcher(health: ReturnType<typeof startHealthServer>) {
  const queue = new ReconcileQueue(reconcileProject);
  health.registerWatcher("kuberizeprojects");

  watchLoop();

  async function watchLoop() {
    const path = `/apis/${GROUP}/${VERSION}/namespaces/${NAMESPACE}/${PLURAL}`;

    try {
      await watch.watch(
        path,
        {},
        (type: string, obj: unknown) => {
          if (type === "ADDED" || type === "MODIFIED") {
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
                queue.enqueue(`${NAMESPACE}/${name}`);
              }
            }
          } else if (type === "ERROR") {
            console.error("[ProjectWatcher] Watch event error:", obj);
          }
        },
        (err: unknown) => {
          health.markWatcherDisconnected("kuberizeprojects");
          if (err) {
            console.error("[ProjectWatcher] Watch stream ended with error:", err);
          } else {
            console.log("[ProjectWatcher] Watch stream ended, reconnecting in 5s...");
          }
          setTimeout(() => watchLoop(), 5000);
        }
      );

      health.markWatcherConnected("kuberizeprojects");
    } catch (err) {
      health.markWatcherDisconnected("kuberizeprojects");
      console.error("[ProjectWatcher] Failed to start watch, reconnecting in 5s:", err);
      setTimeout(() => watchLoop(), 5000);
    }
  }
}

async function reconcileProject(key: string) {
  const slashIdx = key.indexOf("/");
  const name = slashIdx !== -1 ? key.slice(slashIdx + 1) : undefined;
  if (!name) throw new Error(`Invalid key: ${key}`);

  console.log(`[reconcileProject] Reconciling project "${name}"`);

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
    throw new Error(`[reconcileProject] Failed to fetch project "${name}": ${err}`);
  }

  let project: z.infer<typeof KuberizeProjectSchema>;
  try {
    project = KuberizeProjectSchema.parse(rawBody);
  } catch (err) {
    throw new Error(`[reconcileProject] Failed to validate project "${name}": ${err}`);
  }

  const projectName = project.metadata.name;
  const environments = project.spec.environments ?? {};
  const envNamespaces = Object.keys(environments).map((envName) =>
    getAppNamespace(projectName, envName)
  );
  const sharedNs = getSharedNamespace(projectName);
  const namespacesToEnsure = [...envNamespaces, sharedNs];

  try {
    for (const nsName of namespacesToEnsure) {
      await ensureNamespace(nsName);
    }

    console.log(`[reconcileProject] Patching status to Ready for "${name}"`);
    await customApi.patchNamespacedCustomObjectStatus(
      GROUP,
      VERSION,
      NAMESPACE,
      PLURAL,
      name,
      { status: { phase: "Ready", lastSyncedAt: new Date().toISOString() } },
      undefined,
      undefined,
      undefined,
      { headers: { "Content-Type": "application/merge-patch+json" } }
    );
  } catch (err) {
    console.error(`[reconcileProject] Error reconciling "${name}", patching status to Error:`, err);
    try {
      await customApi.patchNamespacedCustomObjectStatus(
        GROUP,
        VERSION,
        NAMESPACE,
        PLURAL,
        name,
        { status: { phase: "Error", lastSyncedAt: new Date().toISOString() } },
        undefined,
        undefined,
        undefined,
        { headers: { "Content-Type": "application/merge-patch+json" } }
      );
    } catch (patchErr) {
      console.error(`[reconcileProject] Failed to patch error status for "${name}":`, patchErr);
    }
    throw err;
  }
}

async function ensureNamespace(nsName: string) {
  try {
    await coreApi.readNamespace(nsName);
    console.log(`[reconcileProject] Namespace "${nsName}" already exists`);
  } catch (err) {
    if (
      typeof err === "object" &&
      err !== null &&
      "statusCode" in err &&
      err.statusCode === 404
    ) {
      console.log(`[reconcileProject] Creating namespace "${nsName}"`);
      try {
        await coreApi.createNamespace({ metadata: { name: nsName } });
      } catch (createErr) {
        if (
          typeof createErr === "object" &&
          createErr !== null &&
          "statusCode" in createErr &&
          createErr.statusCode === 409
        ) {
          console.log(`[reconcileProject] Namespace "${nsName}" already exists (409), skipping`);
        } else {
          throw createErr;
        }
      }
    } else {
      throw err;
    }
  }
}
