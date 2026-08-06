import simpleGit from "simple-git";
import { load as parseYaml } from "js-yaml";
import { KuberizeConfigSchema } from "@kuberize/shared";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

export async function parseKuberizeConfig(repoUrl: string, branch: string, token: string) {
  const tempDir = await mkdtemp(join(tmpdir(), "kuberize-"));

  try {
    const authedUrl = repoUrl.replace("https://", `https://${token}@`);

    await simpleGit().clone(authedUrl, tempDir, ["--depth", "1", "--branch", branch]);

    // The clone's own HEAD is authoritative for what this sync read —
    // recording it (rather than a separate ls-remote) avoids any race.
    const sha = (await simpleGit(tempDir).revparse(["HEAD"])).trim();

    let rawYaml: string;
    try {
      rawYaml = await readFile(join(tempDir, ".kuberize.yaml"), "utf8");
    } catch {
      throw new Error("No .kuberize.yaml found in repository root");
    }

    const parsed = parseYaml(rawYaml);

    return { config: KuberizeConfigSchema.parse(parsed), sha };
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}
