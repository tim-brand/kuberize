export function slugify(name: string) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

export function getAppNamespace(project: string, environment: string) {
  return `kuberize-${slugify(project)}-${slugify(environment)}`;
}

export function getSharedNamespace(project: string) {
  return `kuberize-${slugify(project)}-shared`;
}

export function getServiceSecretName(project: string, service: string) {
  return `kuberize-${slugify(project)}-${slugify(service)}-connection`;
}

export function getAutoSubdomain(app: string, env: string, baseDomain: string) {
  return `${slugify(app)}-${slugify(env)}.${baseDomain}`;
}

// Annotation on a KuberizeProject requesting an immediate config sync. The API
// stamps a timestamp here on GitHub push webhooks; the operator syncs when the
// value differs from status.lastHandledSyncRequest.
export const SYNC_REQUEST_ANNOTATION = "kuberize.io/requested-sync-at";

// Reduces the many equivalent forms of a git repo URL (https, ssh, .git suffix,
// trailing slash, case) to a canonical "host/owner/repo" string for comparison.
export function normalizeRepoUrl(url: string) {
  const trimmed = url.trim().toLowerCase().replace(/\.git$/, "").replace(/\/+$/, "");
  const sshMatch = trimmed.match(/^(?:ssh:\/\/)?git@([^:/]+)[:/](.+)$/);
  if (sshMatch) {
    return `${sshMatch[1]}/${sshMatch[2]}`;
  }
  return trimmed.replace(/^https?:\/\//, "");
}
