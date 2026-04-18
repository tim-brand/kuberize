import type { MiddlewareHandler } from "hono";

export const apiKeyAuth: MiddlewareHandler = async (c, next) => {
  const expected = process.env.API_KEY;
  if (!expected) {
    return c.json({ error: "API_KEY not configured on server" }, 500);
  }

  const header = c.req.header("Authorization");
  const provided = header?.startsWith("Bearer ") ? header.slice(7) : undefined;
  if (!provided || provided !== expected) {
    return c.json({ error: "unauthorized" }, 401);
  }

  await next();
};
