import * as k8s from "@kubernetes/client-node";

const kc = new k8s.KubeConfig();
kc.loadFromDefault();

export const coreApi = kc.makeApiClient(k8s.CoreV1Api);
export const appsApi = kc.makeApiClient(k8s.AppsV1Api);
export const networkingApi = kc.makeApiClient(k8s.NetworkingV1Api);
export const customApi = kc.makeApiClient(k8s.CustomObjectsApi);
export const batchApi = kc.makeApiClient(k8s.BatchV1Api);
export const watch = new k8s.Watch(kc);
