import { coreApi, customApi } from "../k8s-client.js";
import { parseKuberizeConfig } from "../config-parser.js";
import { type KuberizeProject, type KuberizeConfig } from "@kuberize/shared";
import { computeDesired } from "./desired-state.js";

const GROUP = "kuberize.io";
const VERSION = "v1alpha1";
const NAMESPACE = "kuberize-system";
const APPS_PLURAL = "kuberizeapps";
const SERVICES_PLURAL = "kuberizeservices";

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
