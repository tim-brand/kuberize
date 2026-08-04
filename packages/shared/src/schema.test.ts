import { describe, it, expect } from "bun:test";
import {
  KuberizeConfigSchema,
  EnvVarSchema,
} from "./schema.js";
import {
  slugify,
  getAppNamespace,
  getSharedNamespace,
  getServiceSecretName,
  getAutoSubdomain,
} from "./utils.js";

describe("environment reference validation", () => {
  const baseApp = {
    name: "api",
    path: "apps/api",
    build: { type: "image", image: "ghcr.io/org/api:latest" },
    expose: { port: 3000 },
  };
  const base = {
    project: "my-app",
    environments: {
      production: { branch: "main" },
      staging: { branch: "develop" },
    },
  };

  it("accepts overrides and env gating that reference declared environments", () => {
    const input = {
      ...base,
      apps: [
        {
          ...baseApp,
          environments: { staging: { branch: "feature/x" } },
          env: [{ name: "DEBUG", value: "1", environments: ["staging"] }],
        },
      ],
    };
    expect(KuberizeConfigSchema.safeParse(input).success).toBe(true);
  });

  it("rejects an app override key that is not a declared environment", () => {
    const input = {
      ...base,
      apps: [{ ...baseApp, environments: { stagin: { branch: "feature/x" } } }],
    };
    const result = KuberizeConfigSchema.safeParse(input);
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find(
        (i) => i.path.join(".") === "apps.0.environments.stagin"
      );
      expect(issue?.message).toContain('Unknown environment "stagin"');
      expect(issue?.message).toContain("production, staging");
    }
  });

  it("rejects an env var gating entry that is not a declared environment", () => {
    const input = {
      ...base,
      apps: [{ ...baseApp, env: [{ name: "DEBUG", value: "1", environments: ["prod"] }] }],
    };
    const result = KuberizeConfigSchema.safeParse(input);
    expect(result.success).toBe(false);
    if (!result.success) {
      const issue = result.error.issues.find(
        (i) => i.path.join(".") === "apps.0.env.0.environments"
      );
      expect(issue?.message).toContain('Unknown environment "prod"');
      expect(issue?.message).toContain("production, staging");
    }
  });
});

describe("KuberizeConfigSchema", () => {
  it("parses a valid minimal config", () => {
    const input = {
      project: "my-app",
      environments: {
        production: { branch: "main" },
      },
      apps: [
        {
          name: "api",
          path: "apps/api",
          build: { type: "image", image: "ghcr.io/org/api:latest" },
          expose: { port: 3000 },
        },
      ],
    };
    const result = KuberizeConfigSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.project).toBe("my-app");
    }
  });

  it("parses a valid full config", () => {
    const input = {
      project: "my-monorepo",
      environments: {
        production: { branch: "main" },
        staging: { branch: "develop" },
      },
      services: [
        { name: "db", type: "postgresql", version: "16", plan: "small", scope: "project" },
        { name: "cache", type: "redis", plan: "medium", scope: "app" },
      ],
      apps: [
        {
          name: "api",
          path: "apps/api",
          build: { type: "image", image: "ghcr.io/org/api:latest" },
          expose: { port: 3000, healthCheck: "/health" },
          services: ["db", "cache"],
          env: [
            { name: "DATABASE_URL", fromService: "db.connectionString" },
            { name: "NODE_ENV", value: "production", environments: ["production"] },
          ],
          triggerOn: ["packages/shared/"],
          environments: {
            production: { domain: "api.myapp.com" },
            staging: { branch: "feat/new-api" },
          },
        },
        {
          name: "worker",
          path: "apps/worker",
          build: { type: "image", image: "ghcr.io/org/worker:latest" },
          expose: { port: 8080 },
        },
      ],
    };
    const result = KuberizeConfigSchema.safeParse(input);
    expect(result.success).toBe(true);
  });

  it("fails when project is missing", () => {
    const input = {
      environments: {
        production: { branch: "main" },
      },
      apps: [
        {
          name: "api",
          path: "apps/api",
          build: { type: "image", image: "ghcr.io/org/api:latest" },
          expose: { port: 3000 },
        },
      ],
    };
    const result = KuberizeConfigSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it("fails with an invalid service type", () => {
    const input = {
      project: "my-app",
      environments: { production: { branch: "main" } },
      services: [
        { name: "db", type: "mysql", plan: "small", scope: "project" },
      ],
      apps: [
        {
          name: "api",
          path: "apps/api",
          build: { type: "image", image: "ghcr.io/org/api:latest" },
          expose: { port: 3000 },
        },
      ],
    };
    const result = KuberizeConfigSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it("fails with an invalid plan", () => {
    const input = {
      project: "my-app",
      environments: { production: { branch: "main" } },
      services: [
        { name: "db", type: "postgresql", plan: "xlarge", scope: "project" },
      ],
      apps: [
        {
          name: "api",
          path: "apps/api",
          build: { type: "image", image: "ghcr.io/org/api:latest" },
          expose: { port: 3000 },
        },
      ],
    };
    const result = KuberizeConfigSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it("fails when environments is an empty object", () => {
    const input = {
      project: "my-app",
      environments: {},
      apps: [
        {
          name: "api",
          path: "apps/api",
          build: { type: "image", image: "ghcr.io/org/api:latest" },
          expose: { port: 3000 },
        },
      ],
    };
    const result = KuberizeConfigSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it("parses app with triggerOn paths", () => {
    const input = {
      project: "my-app",
      environments: { production: { branch: "main" } },
      apps: [
        {
          name: "api",
          path: "apps/api",
          build: { type: "image", image: "ghcr.io/org/api:latest" },
          expose: { port: 3000 },
          triggerOn: ["packages/shared/", "packages/db-client/"],
        },
      ],
    };
    const result = KuberizeConfigSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.apps[0]?.triggerOn).toEqual([
        "packages/shared/",
        "packages/db-client/",
      ]);
    }
  });

  it("parses app with per-app environment overrides (domain + branch)", () => {
    const input = {
      project: "my-app",
      environments: {
        production: { branch: "main" },
        staging: { branch: "develop" },
      },
      apps: [
        {
          name: "api",
          path: "apps/api",
          build: { type: "image", image: "ghcr.io/org/api:latest" },
          expose: { port: 3000 },
          environments: {
            production: { domain: "api.myapp.com" },
            staging: { branch: "feat/new-api" },
          },
        },
      ],
    };
    const result = KuberizeConfigSchema.safeParse(input);
    expect(result.success).toBe(true);
    if (result.success) {
      const appEnvs = result.data.apps[0]?.environments;
      expect(appEnvs?.["production"]?.domain).toBe("api.myapp.com");
      expect(appEnvs?.["staging"]?.branch).toBe("feat/new-api");
    }
  });

  // fromService references (format: "serviceName.key") are not validated against
  // declared services at parse time — referential integrity is enforced by the
  // operator at reconciliation time.
  it("parses valid fromService format and treats it as optional", () => {
    const withFromService = EnvVarSchema.safeParse({
      name: "DATABASE_URL",
      fromService: "db.connectionString",
    });
    expect(withFromService.success).toBe(true);

    const withoutFromService = EnvVarSchema.safeParse({
      name: "NODE_ENV",
      value: "production",
    });
    expect(withoutFromService.success).toBe(true);
    if (withoutFromService.success) {
      expect(withoutFromService.data.fromService).toBeUndefined();
    }
  });
});

describe("slugify", () => {
  it('converts "My Project!" to "my-project"', () => {
    expect(slugify("My Project!")).toBe("my-project");
  });

  it('converts "foo__bar" to "foo-bar"', () => {
    expect(slugify("foo__bar")).toBe("foo-bar");
  });

  it('converts "--hello--" to "hello"', () => {
    expect(slugify("--hello--")).toBe("hello");
  });

  it('leaves "already-slug" unchanged', () => {
    expect(slugify("already-slug")).toBe("already-slug");
  });
});

describe("getAppNamespace", () => {
  it('returns "kuberize-my-project-production"', () => {
    expect(getAppNamespace("my-project", "production")).toBe(
      "kuberize-my-project-production"
    );
  });
});

describe("getSharedNamespace", () => {
  it('returns "kuberize-my-project-shared"', () => {
    expect(getSharedNamespace("my-project")).toBe("kuberize-my-project-shared");
  });
});

describe("getServiceSecretName", () => {
  it('returns "kuberize-my-project-db-connection"', () => {
    expect(getServiceSecretName("my-project", "db")).toBe(
      "kuberize-my-project-db-connection"
    );
  });
});

describe("getAutoSubdomain", () => {
  it('returns "api-production.kuberize.example.com"', () => {
    expect(getAutoSubdomain("api", "production", "kuberize.example.com")).toBe(
      "api-production.kuberize.example.com"
    );
  });
});
