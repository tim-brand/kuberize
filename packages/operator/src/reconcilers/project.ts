import { watch, coreApi, customApi } from "../k8s-client.js";
import { ReconcileQueue } from "../queue.js";
import { startHealthServer } from "../health.js";
import { type z } from "zod";
import { KuberizeProjectSchema, getAppNamespace, getSharedNamespace } from "@kuberize/shared";
import { syncProjectFromConfig, SyncError } from "../syncers/project-sync.js";
import { pendingSyncRequest } from "../sync-request.js";

const GROUP = "kuberize.io";
const VERSION = "v1alpha1";
const PLURAL = "kuberizeprojects";
const NAMESPACE = "kuberize-system";

const POLL_PREFIX = "poll:";
const POLL_INTERVAL_MS = Number(process.env.KUBERIZE_SYNC_INTERVAL_MS ?? 60_000);

export function startProjectWatcher(health: ReturnType<typeof startHealthServer>) {
  const queue = new ReconcileQueue((key) => reconcileProject(key, queue));
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

async function reconcileProject(key: string, queue: ReconcileQueue) {
  const isPoll = key.startsWith(POLL_PREFIX);
  const cleanKey = isPoll ? key.slice(POLL_PREFIX.length) : key;
  const slashIdx = cleanKey.indexOf("/");
  const name = slashIdx !== -1 ? cleanKey.slice(slashIdx + 1) : undefined;
  if (!name) throw new Error(`Invalid key: ${key}`);

  const pollKey = `${POLL_PREFIX}${NAMESPACE}/${name}`;

  console.log(`[reconcileProject] Reconciling project "${name}"${isPoll ? " (poll)" : ""}`);

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
    // If the project was deleted while polling, stop. Don't reschedule.
    if (
      isPoll &&
      typeof err === "object" &&
      err !== null &&
      "statusCode" in err &&
      (err as { statusCode?: number }).statusCode === 404
    ) {
      console.log(`[reconcileProject] Project "${name}" gone, stopping polls`);
      return;
    }
    throw new Error(`[reconcileProject] Failed to fetch project "${name}": ${err}`);
  }

  let project: z.infer<typeof KuberizeProjectSchema>;
  try {
    project = KuberizeProjectSchema.parse(rawBody);
  } catch (err) {
    throw new Error(`[reconcileProject] Failed to validate project "${name}": ${err}`);
  }

  // Generation guard — only short-circuits watch-driven events. Poll events always
  // run a full sync so we pick up upstream .kuberize.yaml changes, and a pending
  // sync-request annotation (stamped by the webhook handler) forces one too.
  const generation = project.metadata.generation;
  const syncRequest = pendingSyncRequest(project);
  if (syncRequest !== undefined) {
    console.log(`[reconcileProject] Sync requested at ${syncRequest} for "${name}"`);
  }
  if (
    !isPoll &&
    syncRequest === undefined &&
    project.status?.phase === "Ready" &&
    generation !== undefined &&
    project.status.observedGeneration === generation
  ) {
    console.log(
      `[reconcileProject] Project "${name}" already Ready for generation ${generation}, scheduling next poll`
    );
    queue.requeueAfter(pollKey, POLL_INTERVAL_MS);
    return;
  }

  // Ensure namespaces (this handles the case before .kuberize.yaml is reachable too).
  const projectName = project.metadata.name;
  const environments = project.spec.environments ?? {};
  const namespacesToEnsure = [
    ...Object.keys(environments).map((envName) => getAppNamespace(projectName, envName)),
    getSharedNamespace(projectName),
  ];
  for (const ns of namespacesToEnsure) {
    await ensureNamespace(ns);
  }

  // Sync from .kuberize.yaml. Best-effort: failures become a status condition,
  // not a thrown error, so the queue's retry-with-backoff doesn't kick in. The poll
  // re-runs sync at the regular cadence.
  let condition: {
    type: string;
    status: "True" | "False";
    reason?: string;
    message?: string;
    lastTransitionTime: string;
  };
  try {
    const summary = await syncProjectFromConfig(project);
    console.log(`[reconcileProject] sync ok for "${name}": ${summary}`);
    condition = {
      type: "ConfigSynced",
      status: "True",
      reason: "Synced",
      message: summary,
      lastTransitionTime: new Date().toISOString(),
    };
  } catch (err) {
    const reason = err instanceof SyncError ? err.reason : "ApplyFailed";
    const message = err instanceof Error ? err.message : String(err);
    console.warn(
      `[reconcileProject] sync failed for "${name}": ${reason} - ${message}`
    );
    condition = {
      type: "ConfigSynced",
      status: "False",
      reason,
      message,
      lastTransitionTime: new Date().toISOString(),
    };
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
          lastSyncedAt: new Date().toISOString(),
          ...(syncRequest !== undefined ? { lastHandledSyncRequest: syncRequest } : {}),
          conditions: [condition],
        },
      },
      undefined,
      undefined,
      undefined,
      { headers: { "Content-Type": "application/merge-patch+json" } }
    );
  } catch (err) {
    console.error(`[reconcileProject] Failed to patch status for "${name}":`, err);
  }

  // Schedule the next poll regardless of sync outcome.
  queue.requeueAfter(pollKey, POLL_INTERVAL_MS);
}

async function ensureNamespace(nsName: string) {
  try {
    await coreApi.readNamespace(nsName);
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
          // Race — already exists, fine.
          return;
        }
        throw createErr;
      }
    } else {
      throw err;
    }
  }
}
