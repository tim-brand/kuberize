import { z } from "zod";

export const K8sConditionSchema = z.object({
  type: z.string(),
  status: z.enum(["True", "False", "Unknown"]),
  lastTransitionTime: z.string().optional(),
  reason: z.string().optional(),
  message: z.string().optional(),
});

export const K8sMetadataSchema = z.object({
  name: z.string(),
  namespace: z.string(),
  resourceVersion: z.string().optional(),
  generation: z.number().optional(),
  uid: z.string().optional(),
  creationTimestamp: z.string().optional(),
  labels: z.record(z.string(), z.string()).optional(),
  annotations: z.record(z.string(), z.string()).optional(),
});

export const k8sResource = <TSpec extends z.ZodTypeAny, TStatus extends z.ZodTypeAny>(
  specSchema: TSpec,
  statusSchema: TStatus
) =>
  z.object({
    apiVersion: z.string(),
    kind: z.string(),
    metadata: K8sMetadataSchema,
    spec: specSchema,
    status: statusSchema.optional(),
  });

// ─── KuberizeProject ──────────────────────────────────────────────────────────

export const KuberizeProjectSpecSchema = z.object({
  displayName: z.string(),
  repo: z.object({
    url: z.string(),
    branch: z.string(),
    secretRef: z.string(),
  }),
  registry: z.object({
    url: z.string(),
    secretRef: z.string(),
  }),
  baseDomain: z.string(),
  clusterIssuer: z.string(),
  // Optional on the CRD — the CRD may be created manually without environments.
  // The .kuberize.yaml schema (KuberizeConfigSchema) requires at least one environment;
  // the asymmetry is intentional.
  environments: z.record(z.string(), z.object({ branch: z.string() })).optional(),
});

export const KuberizeProjectStatusSchema = z.object({
  phase: z.enum(["Pending", "Ready", "Error"]),
  observedGeneration: z.number().optional(),
  lastSyncedAt: z.string().optional(),
  // Last value of the sync-request annotation that has been fully processed.
  lastHandledSyncRequest: z.string().optional(),
  // HEAD commit SHA of the clone the last successful sync read config from.
  lastSyncedSha: z.string().optional(),
  conditions: z.array(K8sConditionSchema).optional(),
});

export const KuberizeProjectSchema = k8sResource(
  KuberizeProjectSpecSchema,
  KuberizeProjectStatusSchema
);

export type KuberizeProject = z.infer<typeof KuberizeProjectSchema>;

// ─── KuberizeApp ──────────────────────────────────────────────────────────────

export const KuberizeAppSpecSchema = z.object({
  projectRef: z.string(),
  appName: z.string(),
  environment: z.string(),
  repo: z
    .object({
      url: z.string(),
      branch: z.string(),
      path: z.string(),
      secretRef: z.string(),
    })
    .optional(),
  image: z.string(),
  registry: z
    .object({
      url: z.string(),
      secretRef: z.string(),
    })
    .optional(),
  serviceRefs: z
    .array(
      z.object({
        name: z.string(),
        envMappings: z.array(
          z.object({
            envVar: z.string(),
            key: z.string(),
          })
        ),
      })
    )
    .optional(),
  env: z
    .array(
      z.object({
        name: z.string(),
        value: z.string(),
      })
    )
    .optional(),
  expose: z.object({
    port: z.number(),
    healthCheck: z.string().optional(),
  }),
  domain: z.string(),
  resources: z.object({
    requests: z.object({ cpu: z.string(), memory: z.string() }),
    limits: z.object({ cpu: z.string(), memory: z.string() }),
  }),
  replicas: z.number(),
});

export const KuberizeAppStatusSchema = z.object({
  phase: z.enum(["Pending", "Deploying", "Running", "Error", "Stopped"]),
  observedGeneration: z.number().optional(),
  observedImage: z.string().optional(),
  currentImage: z.string().optional(),
  lastDeployedAt: z.string().optional(),
  lastCommit: z
    .object({
      sha: z.string(),
      message: z.string(),
      author: z.string(),
    })
    .optional(),
  url: z.string().optional(),
  conditions: z.array(K8sConditionSchema).optional(),
});

export const KuberizeAppSchema = k8sResource(
  KuberizeAppSpecSchema,
  KuberizeAppStatusSchema
);

export type KuberizeApp = z.infer<typeof KuberizeAppSchema>;

// ─── KuberizeService ─────────────────────────────────────────────────────────

export const KuberizeServiceSpecSchema = z.object({
  projectRef: z.string(),
  serviceName: z.string(),
  type: z.enum(["postgresql", "redis", "rabbitmq", "minio"]),
  version: z.string().optional(),
  plan: z.enum(["small", "medium", "large"]),
  scope: z.enum(["project", "app"]),
  appName: z.string().optional(),
  environment: z.string().optional(),
});

export const KuberizeServiceStatusSchema = z.object({
  phase: z.enum(["Pending", "Provisioning", "Ready", "Error"]),
  observedGeneration: z.number().optional(),
  connectionSecretRef: z.string().optional(),
  namespace: z.string().optional(),
  conditions: z.array(K8sConditionSchema).optional(),
});

export const KuberizeServiceSchema = k8sResource(
  KuberizeServiceSpecSchema,
  KuberizeServiceStatusSchema
);

export type KuberizeService = z.infer<typeof KuberizeServiceSchema>;
