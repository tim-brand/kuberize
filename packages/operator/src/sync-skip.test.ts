import { describe, expect, it } from "bun:test";
import { KuberizeProjectSchema } from "@kuberize/shared";
import { canSkipSync } from "./sync-skip.js";

const eligibleProject = () =>
  KuberizeProjectSchema.parse({
    apiVersion: "kuberize.io/v1alpha1",
    kind: "KuberizeProject",
    metadata: { name: "demo", namespace: "kuberize-system", generation: 3 },
    spec: {
      displayName: "Demo Project",
      repo: { url: "https://github.com/acme/demo", branch: "main", secretRef: "gh" },
      registry: { url: "ghcr.io/acme", secretRef: "reg" },
      baseDomain: "demo.example.com",
      clusterIssuer: "letsencrypt",
    },
    status: {
      phase: "Ready",
      observedGeneration: 3,
      lastSyncedSha: "abc1234def",
      conditions: [
        {
          type: "ConfigSynced",
          status: "True",
          reason: "Synced",
          lastTransitionTime: "2026-08-04T00:00:00Z",
        },
      ],
    },
  });

describe("canSkipSync", () => {
  it("allows skipping for a quiet, successfully synced poll", () => {
    expect(canSkipSync(eligibleProject(), true, undefined)).toBe(true);
  });

  it("never skips watch-driven reconciles", () => {
    expect(canSkipSync(eligibleProject(), false, undefined)).toBe(false);
  });

  it("never skips when a sync request is pending", () => {
    expect(canSkipSync(eligibleProject(), true, "2026-08-04T12:00:00Z")).toBe(false);
  });

  it("never skips when the spec generation is unobserved", () => {
    const project = eligibleProject();
    project.metadata.generation = 4;
    expect(canSkipSync(project, true, undefined)).toBe(false);
  });

  it("never skips when generation is missing", () => {
    const project = eligibleProject();
    delete project.metadata.generation;
    expect(canSkipSync(project, true, undefined)).toBe(false);
  });

  it("never skips after a failed sync", () => {
    const project = eligibleProject();
    const condition = project.status?.conditions?.[0];
    if (condition) condition.status = "False";
    expect(canSkipSync(project, true, undefined)).toBe(false);
  });

  it("never skips without a ConfigSynced condition", () => {
    const project = eligibleProject();
    if (project.status) project.status.conditions = [];
    expect(canSkipSync(project, true, undefined)).toBe(false);
  });

  it("never skips without a recorded lastSyncedSha", () => {
    const project = eligibleProject();
    if (project.status) delete project.status.lastSyncedSha;
    expect(canSkipSync(project, true, undefined)).toBe(false);
  });

  it("never skips when the project has no status at all", () => {
    const project = eligibleProject();
    delete project.status;
    expect(canSkipSync(project, true, undefined)).toBe(false);
  });
});
