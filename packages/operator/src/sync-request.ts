import { SYNC_REQUEST_ANNOTATION, type KuberizeProject } from "@kuberize/shared";

/**
 * Returns the value of the sync-request annotation if it hasn't been handled
 * yet (i.e. differs from status.lastHandledSyncRequest), or undefined when
 * there is nothing pending. A pending request forces a full config sync even
 * when the generation guard would otherwise short-circuit the reconcile.
 */
export function pendingSyncRequest(project: KuberizeProject) {
  const requested = project.metadata.annotations?.[SYNC_REQUEST_ANNOTATION];
  if (requested === undefined) return undefined;
  if (project.status?.lastHandledSyncRequest === requested) return undefined;
  return requested;
}
