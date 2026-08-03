import {
  type KuberizeProject,
  type KuberizeConfig,
  slugify,
  getAutoSubdomain,
} from "@kuberize/shared";

const DEFAULT_APP_RESOURCES = {
  requests: { cpu: "100m", memory: "256Mi" },
  limits: { cpu: "500m", memory: "512Mi" },
};

export type DesiredService = { name: string; spec: Record<string, unknown> };
export type DesiredApp = { name: string; spec: Record<string, unknown> };

export function computeDesired(project: KuberizeProject, config: KuberizeConfig) {
  const projectName = project.metadata.name;
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
