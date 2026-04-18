import { helmInstall, generatePassword, planResources } from "./base.js";

const CHART = "oci://registry-1.docker.io/bitnamicharts/postgresql";

export async function provisionPostgresql(
  release: string,
  namespace: string,
  version: string | undefined,
  plan: "small" | "medium" | "large",
  existingPassword?: string
) {
  const password = existingPassword ?? generatePassword();
  const values = {
    auth: { username: "kuberize", password, database: "kuberize" },
    primary: { resources: planResources(plan) },
  };

  await helmInstall(release, CHART, namespace, values, version);

  return {
    connectionString: `postgresql://kuberize:${password}@${release}-postgresql.${namespace}.svc.cluster.local:5432/kuberize`,
    host: `${release}-postgresql.${namespace}.svc.cluster.local`,
    port: "5432",
    username: "kuberize",
    password,
    database: "kuberize",
  };
}
