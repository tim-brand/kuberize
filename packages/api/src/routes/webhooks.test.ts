import { beforeEach, describe, expect, mock, test } from "bun:test";
import { createHmac } from "node:crypto";
import { SYNC_REQUEST_ANNOTATION } from "@kuberize/shared";

const SECRET = "test-webhook-secret";
process.env.GITHUB_WEBHOOK_SECRET = SECRET;

const listNamespacedCustomObject = mock();
const patchNamespacedCustomObject = mock();
const patchNamespacedCustomObjectStatus = mock();

mock.module("../k8s-client.js", () => ({
  customApi: {
    listNamespacedCustomObject,
    patchNamespacedCustomObject,
    patchNamespacedCustomObjectStatus,
  },
  coreApi: {},
}));

const { webhooks } = await import("./webhooks.js");

function sign(body: string) {
  return "sha256=" + createHmac("sha256", SECRET).update(body).digest("hex");
}

async function readJson(res: Response) {
  return (await res.json()) as {
    processed?: boolean;
    requested?: string[];
    skipped?: string[];
  };
}

function githubRequest(event: string, payload: unknown, signature?: string) {
  const body = JSON.stringify(payload);
  return webhooks.github.request("/", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-GitHub-Event": event,
      "X-Hub-Signature-256": signature ?? sign(body),
    },
    body,
  });
}

const project = (name: string, repoUrl: string, branch: string) => ({
  metadata: { name, namespace: "kuberize-system" },
  spec: { repo: { url: repoUrl, branch, secretRef: "gh" } },
});

const pushPayload = {
  ref: "refs/heads/master",
  repository: {
    html_url: "https://github.com/tim-brand/archon-demo",
    clone_url: "https://github.com/tim-brand/archon-demo.git",
    ssh_url: "git@github.com:tim-brand/archon-demo.git",
  },
};

beforeEach(() => {
  listNamespacedCustomObject.mockReset();
  patchNamespacedCustomObject.mockReset();
  listNamespacedCustomObject.mockResolvedValue({
    body: {
      items: [
        project("arcade-games", "https://github.com/tim-brand/archon-demo", "master"),
        project("other-branch", "https://github.com/tim-brand/archon-demo", "develop"),
        project("other-repo", "https://github.com/tim-brand/unrelated", "master"),
      ],
    },
  });
  patchNamespacedCustomObject.mockResolvedValue({ body: {} });
});

describe("github webhook", () => {
  test("rejects an invalid signature", async () => {
    const res = await githubRequest("push", pushPayload, "sha256=" + "0".repeat(64));
    expect(res.status).toBe(401);
    expect(patchNamespacedCustomObject).not.toHaveBeenCalled();
  });

  test("acknowledges non-push events without syncing", async () => {
    const res = await githubRequest("ping", { zen: "Keep it logically awesome." });
    expect(res.status).toBe(200);
    const json = await readJson(res);
    expect(json.processed).toBe(false);
    expect(patchNamespacedCustomObject).not.toHaveBeenCalled();
  });

  test("stamps a sync-request annotation on projects matching repo and branch", async () => {
    const res = await githubRequest("push", pushPayload);
    expect(res.status).toBe(200);
    const json = await readJson(res);
    expect(json.processed).toBe(true);
    expect(json.requested).toEqual(["arcade-games"]);

    expect(patchNamespacedCustomObject).toHaveBeenCalledTimes(1);
    const args = patchNamespacedCustomObject.mock.calls[0] ?? [];
    expect(args[4]).toBe("arcade-games");
    const patch = args[5] as {
      metadata: { annotations: Record<string, string> };
    };
    expect(patch.metadata.annotations[SYNC_REQUEST_ANNOTATION]).toBeString();
  });

  test("matches when the project uses the ssh form of the repo url", async () => {
    listNamespacedCustomObject.mockResolvedValue({
      body: {
        items: [project("ssh-project", "git@github.com:tim-brand/archon-demo.git", "master")],
      },
    });
    const res = await githubRequest("push", pushPayload);
    const json = await readJson(res);
    expect(json.requested).toEqual(["ssh-project"]);
  });

  test("ignores pushes to branches no project reads config from", async () => {
    const res = await githubRequest("push", {
      ...pushPayload,
      ref: "refs/heads/feature/foo",
    });
    const json = await readJson(res);
    expect(json.processed).toBe(true);
    expect(json.requested).toEqual([]);
    expect(patchNamespacedCustomObject).not.toHaveBeenCalled();
  });

  test("ignores tag pushes", async () => {
    const res = await githubRequest("push", { ...pushPayload, ref: "refs/tags/v1.0.0" });
    const json = await readJson(res);
    expect(json.processed).toBe(false);
    expect(patchNamespacedCustomObject).not.toHaveBeenCalled();
  });

  test("rejects a malformed push payload", async () => {
    const res = await githubRequest("push", { nope: true });
    expect(res.status).toBe(400);
  });

  test("skips sync for a code-only push and reports the project as skipped", async () => {
    const res = await githubRequest("push", {
      ...pushPayload,
      commits: [{ added: ["src/new.ts"], modified: ["README.md"], removed: [] }],
    });
    expect(res.status).toBe(200);
    const json = await readJson(res);
    expect(json.processed).toBe(true);
    expect(json.requested).toEqual([]);
    expect(json.skipped).toEqual(["arcade-games"]);
    expect(patchNamespacedCustomObject).not.toHaveBeenCalled();
  });

  test("requests sync when a push touches .kuberize.yaml", async () => {
    const res = await githubRequest("push", {
      ...pushPayload,
      commits: [{ modified: [".kuberize.yaml"] }],
    });
    const json = await readJson(res);
    expect(json.requested).toEqual(["arcade-games"]);
    expect(json.skipped).toEqual([]);
    expect(patchNamespacedCustomObject).toHaveBeenCalledTimes(1);
  });

  test("requests sync on a force push even without .kuberize.yaml in commits", async () => {
    const res = await githubRequest("push", {
      ...pushPayload,
      forced: true,
      commits: [{ modified: ["src/index.ts"] }],
    });
    const json = await readJson(res);
    expect(json.requested).toEqual(["arcade-games"]);
    expect(json.skipped).toEqual([]);
    expect(patchNamespacedCustomObject).toHaveBeenCalledTimes(1);
  });
});
