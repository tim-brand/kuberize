import type { ErrorHandler } from "hono";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { HTTPException } from "hono/http-exception";
import { ZodError } from "zod";

export const errorHandler: ErrorHandler = (err, c) => {
  if (err instanceof HTTPException) {
    return err.getResponse();
  }

  if (err instanceof ZodError) {
    return c.json({ error: "validation_error", issues: err.issues }, 400);
  }

  if (
    typeof err === "object" &&
    err !== null &&
    "statusCode" in err &&
    typeof (err as { statusCode?: unknown }).statusCode === "number"
  ) {
    const status = (err as { statusCode: number }).statusCode as ContentfulStatusCode;
    const body = (err as { body?: unknown }).body;
    return c.json({ error: "kubernetes_error", status, details: body }, status);
  }

  console.error("[api] unhandled error:", err);
  return c.json({ error: "internal_server_error", message: String(err) }, 500);
};
