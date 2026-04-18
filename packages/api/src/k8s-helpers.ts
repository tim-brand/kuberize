export function is404(err: unknown) {
  return (
    typeof err === "object" &&
    err !== null &&
    "statusCode" in err &&
    (err as { statusCode?: number }).statusCode === 404
  );
}

export const GROUP = "kuberize.io";
export const VERSION = "v1alpha1";
export const SYSTEM_NAMESPACE = "kuberize-system";
