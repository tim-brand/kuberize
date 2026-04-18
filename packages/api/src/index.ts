import { Hono } from "hono";
import { apiKeyAuth } from "./middleware/auth.js";
import { errorHandler } from "./middleware/error.js";
import { projects } from "./routes/projects.js";
import { apps } from "./routes/apps.js";
import { services } from "./routes/services.js";
import { webhooks } from "./routes/webhooks.js";

const app = new Hono();
app.onError(errorHandler);

app.get("/healthz", (c) => c.json({ ok: true }));

// Public-ish: GitHub webhooks use HMAC, not API key
app.route("/webhooks/github", webhooks.github);

// Everything under /api/v1 requires API key
const api = new Hono();
api.use("*", apiKeyAuth);
api.route("/projects", projects);
api.route("/projects/:projectId/apps", apps);
api.route("/projects/:projectId/services", services);
api.route("/webhooks/deploy", webhooks.deploy);

app.route("/api/v1", api);

const port = Number(process.env.PORT ?? 3001);
console.log(`Kuberize API listening on port ${port}`);

export default { port, fetch: app.fetch };
