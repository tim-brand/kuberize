import { describe, expect, test } from "bun:test";
import { SYNC_REQUEST_ANNOTATION, type KuberizeProject } from "@kuberize/shared";
import { pendingSyncRequest } from "./sync-request.js";

function makeProject(overrides: {
  annotations?: Record<string, string>;
  lastHandledSyncRequest?: string;
}): KuberizeProject {
  return {
    apiVersion: "kuberize.io/v1alpha1",
    kind: "KuberizeProject",
    metadata: {
      name: "demo",
      namespace: "kuberize-system",
      annotations: overrides.annotations,
    },
    spec: {
      displayName: "Demo",
      repo: { url: "https://github.com/acme/demo", branch: "main", secretRef: "gh" },
      registry: { url: "ghcr.io/acme", secretRef: "reg" },
      baseDomain: "demo.example.com",
      clusterIssuer: "letsencrypt",
    },
    status: {
      phase: "Ready",
      lastHandledSyncRequest: overrides.lastHandledSyncRequest,
    },
  };
}

describe("pendingSyncRequest", () => {
  test("returns undefined when the annotation is absent", () => {
    expect(pendingSyncRequest(makeProject({}))).toBeUndefined();
  });

  test("returns the annotation value when never handled", () => {
    const project = makeProject({
      annotations: { [SYNC_REQUEST_ANNOTATION]: "2026-07-30T10:00:00Z" },
    });
    expect(pendingSyncRequest(project)).toBe("2026-07-30T10:00:00Z");
  });

  test("returns undefined when the request was already handled", () => {
    const project = makeProject({
      annotations: { [SYNC_REQUEST_ANNOTATION]: "2026-07-30T10:00:00Z" },
      lastHandledSyncRequest: "2026-07-30T10:00:00Z",
    });
    expect(pendingSyncRequest(project)).toBeUndefined();
  });

  test("returns the new value when a newer request supersedes a handled one", () => {
    const project = makeProject({
      annotations: { [SYNC_REQUEST_ANNOTATION]: "2026-07-30T11:00:00Z" },
      lastHandledSyncRequest: "2026-07-30T10:00:00Z",
    });
    expect(pendingSyncRequest(project)).toBe("2026-07-30T11:00:00Z");
  });
});
