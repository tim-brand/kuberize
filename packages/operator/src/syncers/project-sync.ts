import { coreApi, customApi } from "../k8s-client.js";
import { parseKuberizeConfig } from "../config-parser.js";
import {
  type KuberizeProject,
  type KuberizeConfig,
  slugify,
  getAutoSubdomain,
} from "@kuberize/shared";

const GROUP = "kuberize.io";
const VERSION = "v1alpha1";
const NAMESPACE = "kuberize-system";
const APPS_PLURAL = "kuberizeapps";
const SERVICES_PLURAL = "kuberizeservices";

const DEFAULT_APP_RESOURCES = {
  requests: { cpu: "100m", memory: "256Mi" },
  limits: { cpu: "500m", memory: "512Mi" },
};

export type SyncFailureReason =
  | "RepoUnreachable"
  | "ConfigMissing"
  | "ValidationFailed"
  | "ApplyFailed";

export class SyncError extends Error {
  constructor(public reason: SyncFailureReason, message: string) {
    super(message);
  }
}

type DesiredService = { name: string; spec: Record<string, unknown> };
type DesiredApp = { name: string; spec: Record<string, unknown> };

/**
 * Clones the project's repo, parses .kuberize.yaml, computes the desired set of
 * KuberizeApp + KuberizeService CRDs, then creates / updates / deletes to converge.
 *
 * Returns a one-line summary on success. Throws SyncError on failure with a typed reason.
 */
export async function syncProjectFromConfig(project: KuberizeProject) {
  const projectName = project.metadata.name;

  const token = await readGithubToken(project.spec.repo.secretRef);

  let config: KuberizeConfig;
  try {
    config = await parseKuberizeConfig(
      project.spec.repo.url,
      project.spec.repo.branch,
      token
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("No .kuberize.yaml")) {
      throw new SyncError("ConfigMissing", message);
    }
    if (
      typeof err === "object" &&
      err !== null &&
      "issues" in err &&
      Array.isArray((err as { issues: unknown[] }).issues)
    ) {
      throw new SyncError("ValidationFailed", message);
    }
    throw new SyncError("RepoUnreachable", message);
  }

  const desired = computeDesired(project, config);

  try {
    const [existingApps, existingServices] = await Promise.all([
      listExisting(APPS_PLURAL, projectName),
      listExisting(SERVICES_PLURAL, projectName),
    ]);

    // Apply services first so that app reconciliation sees them.
    const svcSummary = await reconcileSet(
      existingServices,
      desired.services,
      SERVICES_PLURAL,
      "KuberizeService"
    );
    const appSummary = await reconcileSet(
      existingApps,
      desired.apps,
      APPS_PLURAL,
      "KuberizeApp"
    );

    return `services ${svcSummary}; apps ${appSummary}`;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new SyncError("ApplyFailed", message);
  }
}

async function readGithubToken(secretName: string) {
  try {
    const result = await coreApi.readNamespacedSecret(secretName, NAMESPACE);
    const data = (result.body as { data?: Record<string, string> }).data ?? {};
    const token = data.token;
    if (!token) {
      throw new SyncError(
        "RepoUnreachable",
        `Secret "${secretName}" has no "token" key`
      );
    }
    return Buffer.from(token, "base64").toString("utf8");
  } catch (err) {
    if (err instanceof SyncError) throw err;
    throw new SyncError(
      "RepoUnreachable",
      `Failed to read secret "${secretName}": ${err}`
    );
  }
}

function computeDesired(project: KuberizeProject, config: KuberizeConfig) {
  const projectName = project.metadata.name;
  const baseDomain = project.spec.baseDomain;
  const services: DesiredService[] = [];
  const apps: DesiredApp[] = [];

  const declaredServices = config.services ?? [];
  const projectScopeServices = declaredServices.filter((s) => s.scope === "project");
  const appScopeServices = declaredServices.filter((s) => s.scope === "app");

  // Project-scoped services exist once per project.
  for (const svc of projectScopeServices) {
    services.push({
      name: `${projectName}-${slugify(svc.name)}-shared`,
      spec: serviceSpec(projectName, svc, "project"),
    });
  }

  for (const envName of Object.keys(config.environments)) {
    for (const app of config.apps) {
      // For each app-scoped service this app uses, instantiate one CRD per env.
      const usedAppScope = appScopeServices.filter((s) =>
        (app.services ?? []).includes(s.name)
      );
      for (const svc of usedAppScope) {
        services.push({
          name: `${projectName}-${slugify(svc.name)}-${slugify(app.name)}-${slugify(envName)}`,
          spec: serviceSpec(projectName, svc, "app", app.name, envName),
        });
      }

      apps.push({
        name: `${projectName}-${slugify(app.name)}-${slugify(envName)}`,
        spec: appSpec(project, config, app, envName),
      });
    }
  }

  return { services, apps };
}

function serviceSpec(
  projectName: string,
  svc: KuberizeConfig["services"] extends (infer S)[] | undefined ? S : never,
  scope: "project" | "app",
  appName?: string,
  environment?: string
) {
  const base: Record<string, unknown> = {
    projectRef: projectName,
    serviceName: svc.name,
    type: svc.type,
    plan: svc.plan,
    scope,
  };
  if (svc.version) base.version = svc.version;
  if (scope === "app") {
    if (appName) base.appName = appName;
    if (environment) base.environment = environment;
  }
  return base;
}

function appSpec(
  project: KuberizeProject,
  config: KuberizeConfig,
  app: KuberizeConfig["apps"][number],
  envName: string
) {
  const projectName = project.metadata.name;
  const declaredServices = config.services ?? [];

  // serviceRefs: walk app.services[] and resolve each to a CRD name + envMappings
  const serviceRefs = (app.services ?? []).map((svcName) => {
    const svc = declaredServices.find((s) => s.name === svcName);
    const refName =
      svc?.scope === "app"
        ? `${projectName}-${slugify(svcName)}-${slugify(app.name)}-${slugify(envName)}`
        : `${projectName}-${slugify(svcName)}-shared`;

    const envMappings = (app.env ?? [])
      .filter((e) => e.fromService?.startsWith(`${svcName}.`))
      .map((e) => ({
        envVar: e.name,
        key: e.fromService?.split(".")[1] ?? "",
      }));

    return { name: refName, envMappings };
  });

  // Static env vars: filter out fromService entries; honour environments[] gating
  const staticEnv = (app.env ?? [])
    .filter((e) => !e.fromService)
    .filter((e) => !e.environments || e.environments.includes(envName))
    .map((e) => ({ name: e.name, value: e.value ?? "" }));

  const envOverride = app.environments?.[envName];
  const domain =
    envOverride?.domain ?? getAutoSubdomain(app.name, envName, project.spec.baseDomain);

  const spec: Record<string, unknown> = {
    projectRef: projectName,
    appName: app.name,
    environment: envName,
    image: app.build.image,
    expose: {
      port: app.expose.port,
      ...(app.expose.healthCheck ? { healthCheck: app.expose.healthCheck } : {}),
    },
    domain,
    resources: DEFAULT_APP_RESOURCES,
    replicas: 1,
  };

  if (project.spec.registry) {
    spec.registry = {
      url: project.spec.registry.url,
      secretRef: project.spec.registry.secretRef,
    };
  }
  if (project.spec.repo) {
    spec.repo = {
      url: project.spec.repo.url,
      branch: project.spec.repo.branch,
      path: app.path,
      secretRef: project.spec.repo.secretRef,
    };
  }
  if (serviceRefs.length > 0) spec.serviceRefs = serviceRefs;
  if (staticEnv.length > 0) spec.env = staticEnv;

  return spec;
}

async function listExisting(plural: string, projectName: string) {
  const { body } = await customApi.listNamespacedCustomObject(
    GROUP,
    VERSION,
    NAMESPACE,
    plural
  );
  const items = (body as { items?: unknown[] }).items ?? [];
  return items.filter((it) => {
    const spec = (it as { spec?: { projectRef?: string } }).spec;
    return spec?.projectRef === projectName;
  });
}

async function reconcileSet(
  existing: unknown[],
  desired: { name: string; spec: Record<string, unknown> }[],
  plural: string,
  kind: string
) {
  const desiredByName = new Map(desired.map((d) => [d.name, d]));
  const existingByName = new Map<string, { spec?: Record<string, unknown> }>();
  for (const e of existing) {
    const name = (e as { metadata?: { name?: string } }).metadata?.name;
    if (typeof name === "string") {
      existingByName.set(name, e as { spec?: Record<string, unknown> });
    }
  }

  let created = 0;
  let updated = 0;
  let deleted = 0;

  for (const [name, d] of desiredByName) {
    const existingItem = existingByName.get(name);
    if (!existingItem) {
      await customApi.createNamespacedCustomObject(
        GROUP,
        VERSION,
        NAMESPACE,
        plural,
        {
          apiVersion: `${GROUP}/${VERSION}`,
          kind,
          metadata: { name, namespace: NAMESPACE },
          spec: d.spec,
        }
      );
      created++;
      continue;
    }
    if (!Bun.deepEquals(existingItem.spec, d.spec)) {
      await customApi.patchNamespacedCustomObject(
        GROUP,
        VERSION,
        NAMESPACE,
        plural,
        name,
        { spec: d.spec },
        undefined,
        undefined,
        undefined,
        { headers: { "Content-Type": "application/merge-patch+json" } }
      );
      updated++;
    }
  }

  for (const name of existingByName.keys()) {
    if (!desiredByName.has(name)) {
      await customApi.deleteNamespacedCustomObject(
        GROUP,
        VERSION,
        NAMESPACE,
        plural,
        name
      );
      deleted++;
    }
  }

  return `+${created}/~${updated}/-${deleted}`;
}
