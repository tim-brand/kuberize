import { helmInstall, generatePassword, planResources } from "./base.js";

const CHART = "oci://registry-1.docker.io/bitnamicharts/minio";

export async function provisionMinio(
  release: string,
  namespace: string,
  version: string | undefined,
  plan: "small" | "medium" | "large",
  existingSecretKey?: string
) {
  const secretKey = existingSecretKey ?? generatePassword();
  const values = {
    auth: { rootUser: "kuberize", rootPassword: secretKey },
    resources: planResources(plan),
  };

  await helmInstall(release, CHART, namespace, values, version);

  return {
    endpoint: `http://${release}-minio.${namespace}.svc.cluster.local:9000`,
    host: `${release}-minio.${namespace}.svc.cluster.local`,
    port: "9000",
    accessKey: "kuberize",
    secretKey,
  };
}
