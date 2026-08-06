import simpleGit from "simple-git";

// Parses `git ls-remote` output ("<sha>\t<ref>\n" per line) into the SHA of
// the exact ref — ls-remote patterns are tail matches, so a branch named
// "foo/refs/heads/main" could otherwise shadow "refs/heads/main".
export function parseLsRemoteOutput(output: string, branch: string) {
  const ref = `refs/heads/${branch}`;
  for (const line of output.split("\n")) {
    const [sha, lineRef] = line.split("\t");
    if (lineRef?.trim() === ref && sha) return sha.trim();
  }
  return undefined;
}

/**
 * Branch HEAD SHA via one `git ls-remote` ref lookup (no clone), or undefined
 * on any failure — callers treat undefined as "cannot skip, run the full sync",
 * so real connectivity errors still surface through the sync's own error path.
 */
export async function getRemoteHead(repoUrl: string, branch: string, token: string) {
  try {
    const authedUrl = repoUrl.replace("https://", `https://${token}@`);
    const output = await simpleGit().listRemote([authedUrl, `refs/heads/${branch}`]);
    return parseLsRemoteOutput(output, branch);
  } catch {
    return undefined;
  }
}
