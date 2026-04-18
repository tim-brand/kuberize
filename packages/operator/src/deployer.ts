import { appsApi, coreApi, networkingApi } from "./k8s-client.js";
import { getAppNamespace, type KuberizeApp } from "@kuberize/shared";

function resourceName(app: KuberizeApp) {
  return `kuberize-${app.spec.appName}-${app.spec.environment}`;
}

function labels(app: KuberizeApp) {
  return {
    "app.kubernetes.io/name": app.spec.appName,
    "app.kubernetes.io/instance": resourceName(app),
    "app.kubernetes.io/managed-by": "kuberize",
    "kuberize.io/project": app.spec.projectRef,
    "kuberize.io/app": app.spec.appName,
    "kuberize.io/environment": app.spec.environment,
  };
}

function buildDeployment(app: KuberizeApp) {
  const name = resourceName(app);
  const lbl = labels(app);
  const { spec } = app;

  const envVars = (spec.env ?? []).map((e) => ({ name: e.name, value: e.value }));

  const probe = spec.expose.healthCheck
    ? {
        httpGet: { path: spec.expose.healthCheck, port: spec.expose.port },
        initialDelaySeconds: 5,
        periodSeconds: 10,
      }
    : undefined;

  return {
    apiVersion: "apps/v1",
    kind: "Deployment",
    metadata: { name, labels: lbl },
    spec: {
      replicas: spec.replicas,
      selector: { matchLabels: { "app.kubernetes.io/instance": name } },
      template: {
        metadata: { labels: lbl },
        spec: {
          containers: [
            {
              name: "app",
              image: spec.image,
              ports: [{ containerPort: spec.expose.port }],
              env: envVars,
              resources: spec.resources,
              ...(probe ? { readinessProbe: probe } : {}),
            },
          ],
          ...(spec.registry?.secretRef
            ? { imagePullSecrets: [{ name: spec.registry.secretRef }] }
            : {}),
        },
      },
    },
  };
}

function buildService(app: KuberizeApp) {
  const name = resourceName(app);
  const lbl = labels(app);
  return {
    apiVersion: "v1",
    kind: "Service",
    metadata: { name, labels: lbl },
    spec: {
      type: "ClusterIP",
      selector: { "app.kubernetes.io/instance": name },
      ports: [
        {
          port: app.spec.expose.port,
          targetPort: app.spec.expose.port,
          protocol: "TCP",
        },
      ],
    },
  };
}

function buildIngress(app: KuberizeApp, clusterIssuer?: string) {
  const name = resourceName(app);
  const lbl = labels(app);
  const annotations: Record<string, string> = {};
  const tls = clusterIssuer
    ? [{ hosts: [app.spec.domain], secretName: `${name}-tls` }]
    : undefined;
  if (clusterIssuer) {
    annotations["cert-manager.io/cluster-issuer"] = clusterIssuer;
  }

  return {
    apiVersion: "networking.k8s.io/v1",
    kind: "Ingress",
    metadata: {
      name,
      labels: lbl,
      ...(Object.keys(annotations).length > 0 ? { annotations } : {}),
    },
    spec: {
      ingressClassName: "nginx",
      ...(tls ? { tls } : {}),
      rules: [
        {
          host: app.spec.domain,
          http: {
            paths: [
              {
                path: "/",
                pathType: "Prefix",
                backend: {
                  service: { name, port: { number: app.spec.expose.port } },
                },
              },
            ],
          },
        },
      ],
    },
  };
}

function is404(err: unknown) {
  return (
    typeof err === "object" &&
    err !== null &&
    "statusCode" in err &&
    (err as { statusCode?: number }).statusCode === 404
  );
}

async function ensureNamespace(namespace: string) {
  try {
    await coreApi.readNamespace(namespace);
  } catch (err) {
    if (!is404(err)) throw err;
    try {
      await coreApi.createNamespace({ metadata: { name: namespace } });
    } catch (createErr) {
      if (
        typeof createErr === "object" &&
        createErr !== null &&
        "statusCode" in createErr &&
        (createErr as { statusCode?: number }).statusCode === 409
      ) {
        return;
      }
      throw createErr;
    }
  }
}

export async function deployApp(app: KuberizeApp, clusterIssuer?: string) {
  const namespace = getAppNamespace(app.spec.projectRef, app.spec.environment);
  await ensureNamespace(namespace);

  const name = resourceName(app);
  const deployment = buildDeployment(app);
  const service = buildService(app);
  const ingress = buildIngress(app, clusterIssuer);

  // Deployment
  try {
    await appsApi.readNamespacedDeployment(name, namespace);
    await appsApi.replaceNamespacedDeployment(name, namespace, deployment);
  } catch (err) {
    if (!is404(err)) throw err;
    await appsApi.createNamespacedDeployment(namespace, deployment);
  }

  // Service
  try {
    const existing = await coreApi.readNamespacedService(name, namespace);
    const svcWithVersion = {
      ...service,
      metadata: {
        ...service.metadata,
        resourceVersion: (existing.body as { metadata?: { resourceVersion?: string } })
          .metadata?.resourceVersion,
      },
      spec: {
        ...service.spec,
        clusterIP: (existing.body as { spec?: { clusterIP?: string } }).spec?.clusterIP,
      },
    };
    await coreApi.replaceNamespacedService(name, namespace, svcWithVersion);
  } catch (err) {
    if (!is404(err)) throw err;
    await coreApi.createNamespacedService(namespace, service);
  }

  // Ingress
  try {
    await networkingApi.readNamespacedIngress(name, namespace);
    await networkingApi.replaceNamespacedIngress(name, namespace, ingress);
  } catch (err) {
    if (!is404(err)) throw err;
    await networkingApi.createNamespacedIngress(namespace, ingress);
  }

  return { namespace, resourceName: name, url: `https://${app.spec.domain}` };
}

export async function deleteAppResources(app: KuberizeApp) {
  const namespace = getAppNamespace(app.spec.projectRef, app.spec.environment);
  const name = resourceName(app);

  for (const op of [
    () => networkingApi.deleteNamespacedIngress(name, namespace),
    () => coreApi.deleteNamespacedService(name, namespace),
    () => appsApi.deleteNamespacedDeployment(name, namespace),
  ]) {
    try {
      await op();
    } catch (err) {
      if (!is404(err)) throw err;
    }
  }
}
