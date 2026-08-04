import simpleGit from "simple-git";

// Parses `git ls-remote` output ("<sha>\t<ref>\n" per line) into the first SHA.
export function parseLsRemoteOutput(output: string) {
  const firstLine = output.split("\n")[0] ?? "";
  const sha = firstLine.split("\t")[0]?.trim();
  return sha ? sha : undefined;
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
    return parseLsRemoteOutput(output);
  } catch {
    return undefined;
  }
}
