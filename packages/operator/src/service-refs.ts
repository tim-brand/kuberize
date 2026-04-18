import { coreApi, customApi } from "./k8s-client.js";
import { KuberizeServiceSchema, type KuberizeApp } from "@kuberize/shared";

const GROUP = "kuberize.io";
const VERSION = "v1alpha1";
const SERVICES_PLURAL = "kuberizeservices";
const SYSTEM_NAMESPACE = "kuberize-system";

export type EnvFromSecret = {
  envVar: string;
  secretName: string;
  key: string;
};

function is404(err: unknown) {
  return (
    typeof err === "object" &&
    err !== null &&
    "statusCode" in err &&
    (err as { statusCode?: number }).statusCode === 404
  );
}

async function fetchService(name: string) {
  try {
    const result = await customApi.getNamespacedCustomObject(
      GROUP,
      VERSION,
      SYSTEM_NAMESPACE,
      SERVICES_PLURAL,
      name
    );
    const parsed = KuberizeServiceSchema.safeParse(result.body);
    return parsed.success ? parsed.data : null;
  } catch (err) {
    if (is404(err)) return null;
    throw err;
  }
}

/**
 * Resolves all serviceRefs on a KuberizeApp.
 * Returns either:
 * - { waitingFor: "<service>" } if any referenced service is missing or not Ready
 * - { resolved: [...] } with the env var mapping info needed to render secretKeyRef
 *
 * Does NOT mirror secrets — call mirrorConnectionSecrets with the resolved list.
 */
export async function resolveServiceRefs(app: KuberizeApp) {
  const refs = app.spec.serviceRefs ?? [];
  const resolved: EnvFromSecret[] = [];

  for (const ref of refs) {
    const service = await fetchService(ref.name);
    if (!service) {
      return { waitingFor: ref.name, reason: "not found" };
    }
    if (service.status?.phase !== "Ready") {
      return {
        waitingFor: ref.name,
        reason: `phase ${service.status?.phase ?? "unknown"}`,
      };
    }
    const secretName = service.status.connectionSecretRef;
    if (!secretName) {
      return { waitingFor: ref.name, reason: "no connectionSecretRef on status" };
    }

    for (const mapping of ref.envMappings) {
      resolved.push({ envVar: mapping.envVar, secretName, key: mapping.key });
    }
  }

  return { resolved };
}

/**
 * Copies each unique connection secret from kuberize-system into the target namespace,
 * so Deployments can reference them via secretKeyRef (cross-namespace refs are not allowed).
 */
export async function mirrorConnectionSecrets(
  resolved: EnvFromSecret[],
  targetNamespace: string
) {
  const uniqueSecretNames = [...new Set(resolved.map((r) => r.secretName))];

  for (const secretName of uniqueSecretNames) {
    const source = await coreApi.readNamespacedSecret(secretName, SYSTEM_NAMESPACE);
    const sourceBody = source.body as {
      data?: Record<string, string>;
      type?: string;
    };

    const body = {
      apiVersion: "v1",
      kind: "Secret",
      metadata: {
        name: secretName,
        namespace: targetNamespace,
        labels: { "app.kubernetes.io/managed-by": "kuberize" },
      },
      type: sourceBody.type ?? "Opaque",
      data: sourceBody.data ?? {},
    };

    try {
      await coreApi.readNamespacedSecret(secretName, targetNamespace);
      await coreApi.replaceNamespacedSecret(secretName, targetNamespace, body);
    } catch (err) {
      if (!is404(err)) throw err;
      await coreApi.createNamespacedSecret(targetNamespace, body);
    }
  }
}
