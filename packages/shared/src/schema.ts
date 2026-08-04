import { z } from "zod";

export const ServiceTypeSchema = z.enum([
  "postgresql",
  "redis",
  "rabbitmq",
  "minio",
]);

export const PlanSchema = z.enum(["small", "medium", "large"]);

export const ScopeSchema = z.enum(["project", "app"]);

export const EnvVarSchema = z.object({
  name: z.string(),
  value: z.string().optional(),
  fromService: z.string().optional(),
  environments: z.array(z.string()).optional(),
});

export const ServiceSchema = z.object({
  name: z.string(),
  type: ServiceTypeSchema,
  version: z.string().optional(),
  plan: PlanSchema,
  scope: ScopeSchema,
});

export const AppBuildSchema = z.object({
  type: z.literal("image"),
  image: z.string(),
});

export const AppExposeSchema = z.object({
  port: z.number(),
  healthCheck: z.string().optional(),
});

export const AppEnvironmentOverrideSchema = z.object({
  domain: z.string().optional(),
  branch: z.string().optional(),
});

export const AppSchema = z.object({
  name: z.string(),
  path: z.string(),
  build: AppBuildSchema,
  expose: AppExposeSchema,
  services: z.array(z.string()).optional(),
  env: z.array(EnvVarSchema).optional(),
  triggerOn: z.array(z.string()).optional(),
  environments: z.record(z.string(), AppEnvironmentOverrideSchema).optional(),
});

export const EnvironmentSchema = z.object({
  branch: z.string(),
});

export const KuberizeConfigSchema = z
  .object({
    project: z.string(),
    environments: z
      .record(z.string(), EnvironmentSchema)
      .refine((r) => Object.keys(r).length > 0, {
        message: "At least one environment is required",
      }),
    services: z.array(ServiceSchema).optional(),
    apps: z.array(AppSchema),
  })
  .superRefine((config, ctx) => {
    // Every environment reference must point at a declared environment —
    // a typo would otherwise be silently ignored by the syncer.
    const declared = Object.keys(config.environments);
    const known = new Set(declared);
    const hint = `declared environments: ${declared.join(", ")}`;

    config.apps.forEach((app, appIdx) => {
      for (const key of Object.keys(app.environments ?? {})) {
        if (!known.has(key)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["apps", appIdx, "environments", key],
            message: `Unknown environment "${key}" — ${hint}`,
          });
        }
      }
      (app.env ?? []).forEach((envVar, envIdx) => {
        for (const name of envVar.environments ?? []) {
          if (!known.has(name)) {
            ctx.addIssue({
              code: z.ZodIssueCode.custom,
              path: ["apps", appIdx, "env", envIdx, "environments"],
              message: `Unknown environment "${name}" — ${hint}`,
            });
          }
        }
      });
    });
  });

// Note: service references in env[].fromService (format: "serviceName.key") are not
// validated against declared services at parse time — referential integrity is enforced
// by the operator at reconciliation time, not here.

export type ServiceType = z.infer<typeof ServiceTypeSchema>;
export type Plan = z.infer<typeof PlanSchema>;
export type Scope = z.infer<typeof ScopeSchema>;
export type EnvVar = z.infer<typeof EnvVarSchema>;
export type Service = z.infer<typeof ServiceSchema>;
export type AppBuild = z.infer<typeof AppBuildSchema>;
export type AppExpose = z.infer<typeof AppExposeSchema>;
export type AppEnvironmentOverride = z.infer<typeof AppEnvironmentOverrideSchema>;
export type App = z.infer<typeof AppSchema>;
export type Environment = z.infer<typeof EnvironmentSchema>;
export type KuberizeConfig = z.infer<typeof KuberizeConfigSchema>;
