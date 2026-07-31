import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { Hono } from "hono";

process.env.GITHUB_WEBHOOK_SECRET = "test-webhook-secret";
process.env.KUBERIZE_API_PUBLIC_URL = "https://kuberize-api.example.com";

const getNamespacedCustomObject = mock();
const readNamespacedSecret = mock();

mock.module("../k8s-client.js", () => ({
  customApi: { getNamespacedCustomObject },
  coreApi: { readNamespacedSecret },
}));

const { projectWebhook } = await import("./project-webhook.js");

const PAYLOAD_URL = "https://kuberize-api.example.com/webhooks/github";

const project = {
  metadata: { name: "arcade-games", namespace: "kuberize-system" },
  spec: {
    repo: {
      url: "https://github.com/tim-brand/archon-demo",
      branch: "master",
      secretRef: "arcade-games-github",
    },
  },
};

const githubHook = {
  id: 42,
  active: true,
  events: ["push"],
  config: { url: PAYLOAD_URL, content_type: "json" },
  updated_at: "2026-07-31T07:00:00Z",
  last_response: { code: 200, status: "active" },
};

const originalFetch = globalThis.fetch;
const fetchMock = mock();

beforeEach(() => {
  getNamespacedCustomObject.mockReset();
  readNamespacedSecret.mockReset();
  fetchMock.mockReset();
  globalThis.fetch = fetchMock as unknown as typeof fetch;

  getNamespacedCustomObject.mockResolvedValue({ body: project });
  readNamespacedSecret.mockResolvedValue({
    body: { data: { token: Buffer.from("gh-token").toString("base64") } },
  });
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function githubResponds(status: number, body: unknown) {
  fetchMock.mockResolvedValue(
    new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } })
  );
}

// Mount under a parent router so c.req.param("projectId") resolves like production.
const app = new Hono();
app.route("/projects/:projectId/webhook", projectWebhook);

function appRequest(method: "GET" | "POST") {
  return app.request("/projects/arcade-games/webhook", { method });
}

describe("GET project webhook status", () => {
  test("reports not configured when no hook matches", async () => {
    githubResponds(200, []);
    const res = await appRequest("GET");
    expect(res.status).toBe(200);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json.configured).toBe(false);
    expect(json.canCreate).toBe(true);
    expect(json.payloadUrl).toBe(PAYLOAD_URL);
    expect((json.manual as { secret?: string }).secret).toBe("test-webhook-secret");
  });

  test("reports configured when a hook targets our payload url", async () => {
    githubResponds(200, [githubHook]);
    const res = await appRequest("GET");
    const json = (await res.json()) as Record<string, unknown>;
    expect(json.configured).toBe(true);
    const hook = json.hook as { id: number; active: boolean };
    expect(hook.id).toBe(42);
    expect(hook.active).toBe(true);
  });

  test("reports token_scope error when GitHub denies hook access", async () => {
    githubResponds(404, { message: "Not Found" });
    const res = await appRequest("GET");
    expect(res.status).toBe(200);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json.configured).toBe(false);
    expect(json.canCreate).toBe(false);
    expect(json.error).toBe("token_scope");
    expect((json.manual as { payloadUrl?: string }).payloadUrl).toBe(PAYLOAD_URL);
  });

  test("404s when the project does not exist", async () => {
    getNamespacedCustomObject.mockRejectedValue({ statusCode: 404 });
    const res = await appRequest("GET");
    expect(res.status).toBe(404);
  });
});

describe("POST project webhook", () => {
  test("creates the hook on GitHub with payload url and secret", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify([]), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(githubHook), { status: 201 }));

    const res = await appRequest("POST");
    expect(res.status).toBe(201);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json.created).toBe(true);

    const createCall = fetchMock.mock.calls[1] ?? [];
    expect(String(createCall[0])).toBe(
      "https://api.github.com/repos/tim-brand/archon-demo/hooks"
    );
    const init = createCall[1] as { method?: string; body?: string };
    expect(init.method).toBe("POST");
    const sent = JSON.parse(init.body ?? "{}") as {
      events: string[];
      config: { url: string; secret: string; content_type: string };
    };
    expect(sent.events).toEqual(["push"]);
    expect(sent.config.url).toBe(PAYLOAD_URL);
    expect(sent.config.secret).toBe("test-webhook-secret");
    expect(sent.config.content_type).toBe("json");
  });

  test("is idempotent when the hook already exists", async () => {
    githubResponds(200, [githubHook]);
    const res = await appRequest("POST");
    expect(res.status).toBe(200);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json.created).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("returns 422 with manual instructions when the token lacks hook access", async () => {
    githubResponds(404, { message: "Not Found" });
    const res = await appRequest("POST");
    expect(res.status).toBe(422);
    const json = (await res.json()) as Record<string, unknown>;
    expect(json.error).toBe("token_scope");
    expect((json.manual as { secret?: string }).secret).toBe("test-webhook-secret");
  });
});
