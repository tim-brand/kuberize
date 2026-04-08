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
