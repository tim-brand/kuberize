import { describe, expect, test } from "bun:test";
import type { KuberizeConfig, KuberizeProject } from "@kuberize/shared";
import { computeDesired } from "./desired-state.js";

function makeProject(): KuberizeProject {
  return {
    apiVersion: "kuberize.io/v1alpha1",
    kind: "KuberizeProject",
    metadata: { name: "demo", namespace: "kuberize-system" },
    spec: {
      displayName: "Demo",
      repo: { url: "https://github.com/acme/demo", branch: "main", secretRef: "gh" },
      registry: { url: "ghcr.io/acme", secretRef: "reg" },
      baseDomain: "demo.example.com",
      clusterIssuer: "letsencrypt",
    },
  };
}

function makeConfig(
  appOverrides?: KuberizeConfig["apps"][number]["environments"]
): KuberizeConfig {
  return {
    project: "demo",
    environments: {
      production: { branch: "main" },
      staging: { branch: "develop" },
    },
    apps: [
      {
        name: "web",
        path: ".",
        build: { type: "image", image: "nginx:1.27" },
        expose: { port: 80 },
        ...(appOverrides ? { environments: appOverrides } : {}),
      },
    ],
  };
}

function branchOf(result: ReturnType<typeof computeDesired>, appName: string) {
  const app = result.apps.find((a) => a.name === appName);
  const repo = app?.spec.repo as { branch?: string } | undefined;
  return repo?.branch;
}

describe("computeDesired branch resolution", () => {
  test("uses the environment's branch mapping, not the project config branch", () => {
    const result = computeDesired(makeProject(), makeConfig());
    expect(branchOf(result, "demo-web-production")).toBe("main");
    expect(branchOf(result, "demo-web-staging")).toBe("develop");
  });

  test("a per-app override wins over the environment branch", () => {
    const result = computeDesired(
      makeProject(),
      makeConfig({ staging: { branch: "feature/redesign" } })
    );
    expect(branchOf(result, "demo-web-staging")).toBe("feature/redesign");
  });

  test("overriding one environment leaves the others untouched", () => {
    const result = computeDesired(
      makeProject(),
      makeConfig({ staging: { branch: "feature/redesign" } })
    );
    expect(branchOf(result, "demo-web-production")).toBe("main");
  });

  test("branch overrides do not affect domain resolution", () => {
    const result = computeDesired(
      makeProject(),
      makeConfig({ staging: { branch: "feature/redesign" } })
    );
    const app = result.apps.find((a) => a.name === "demo-web-staging");
    expect(app?.spec.domain).toBe("web-staging.demo.example.com");
  });

  test("a domain override still works alongside a branch override", () => {
    const result = computeDesired(
      makeProject(),
      makeConfig({ staging: { branch: "feature/redesign", domain: "preview.demo.example.com" } })
    );
    const app = result.apps.find((a) => a.name === "demo-web-staging");
    expect(app?.spec.domain).toBe("preview.demo.example.com");
    expect(branchOf(result, "demo-web-staging")).toBe("feature/redesign");
  });

  test("branch overrides do not affect desired services", () => {
    const withService = (config: KuberizeConfig): KuberizeConfig => ({
      ...config,
      services: [{ name: "db", type: "postgresql", plan: "small", scope: "project" }],
      apps: config.apps.map((a) => ({ ...a, services: ["db"] })),
    });
    const plain = computeDesired(makeProject(), withService(makeConfig()));
    const overridden = computeDesired(
      makeProject(),
      withService(makeConfig({ staging: { branch: "feature/redesign" } }))
    );
    expect(overridden.services).toEqual(plain.services);
  });
});
