import { helmInstall, generatePassword, planResources } from "./base.js";

const CHART = "oci://registry-1.docker.io/bitnamicharts/redis";

export async function provisionRedis(
  release: string,
  namespace: string,
  version: string | undefined,
  plan: "small" | "medium" | "large",
  existingPassword?: string
) {
  const password = existingPassword ?? generatePassword();
  const values = {
    auth: { password },
    master: { resources: planResources(plan) },
    architecture: "standalone",
  };

  await helmInstall(release, CHART, namespace, values, version);

  return {
    connectionString: `redis://:${password}@${release}-redis-master.${namespace}.svc.cluster.local:6379`,
    host: `${release}-redis-master.${namespace}.svc.cluster.local`,
    port: "6379",
    password,
  };
}
