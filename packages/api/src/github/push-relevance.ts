const CONFIG_FILE = ".kuberize.yaml";

/**
 * Whether a GitHub push payload touched the repo-root .kuberize.yaml — as far
 * as we can tell. Fails open (returns true) when the payload can't positively
 * rule out a config change: force pushes, deleted refs, or missing/empty
 * commit lists.
 */
export function pushTouchesConfig(push: {
  forced?: boolean;
  deleted?: boolean;
  commits?: { added?: string[]; modified?: string[]; removed?: string[] }[];
}) {
  if (push.forced === true || push.deleted === true) return true;
  if (!push.commits || push.commits.length === 0) return true;
  return push.commits.some((c) =>
    [...(c.added ?? []), ...(c.modified ?? []), ...(c.removed ?? [])].includes(CONFIG_FILE)
  );
}
