import { helmInstall, generatePassword, planResources } from "./base.js";

const CHART = "oci://registry-1.docker.io/bitnamicharts/rabbitmq";

export async function provisionRabbitmq(
  release: string,
  namespace: string,
  version: string | undefined,
  plan: "small" | "medium" | "large",
  existingPassword?: string
) {
  const password = existingPassword ?? generatePassword();
  const values = {
    auth: { username: "kuberize", password },
    resources: planResources(plan),
  };

  await helmInstall(release, CHART, namespace, values, version);

  return {
    connectionString: `amqp://kuberize:${password}@${release}-rabbitmq.${namespace}.svc.cluster.local:5672`,
    host: `${release}-rabbitmq.${namespace}.svc.cluster.local`,
    port: "5672",
    username: "kuberize",
    password,
  };
}
