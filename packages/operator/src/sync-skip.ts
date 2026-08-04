import { type KuberizeProject } from "@kuberize/shared";

/**
 * Whether a poll-driven reconcile may consult `git ls-remote` and skip the
 * full sync when the branch HEAD is unchanged. Anything that could invalidate
 * the recorded state — a pending sync request, an unobserved spec change, a
 * failed or missing previous sync — forces the full sync path.
 */
export function canSkipSync(
  project: KuberizeProject,
  isPoll: boolean,
  syncRequest: string | undefined
) {
  if (!isPoll || syncRequest !== undefined) return false;

  const generation = project.metadata.generation;
  const status = project.status;
  if (generation === undefined || status?.observedGeneration !== generation) return false;

  const synced = status.conditions?.find((c) => c.type === "ConfigSynced");
  if (synced?.status !== "True") return false;

  return typeof status.lastSyncedSha === "string" && status.lastSyncedSha.length > 0;
}
