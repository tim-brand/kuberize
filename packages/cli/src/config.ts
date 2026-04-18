import { readFile, writeFile, mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const CONFIG_PATH = join(homedir(), ".kuberize", "config.json");

export type CliConfig = { url: string; key: string };

export async function loadConfig() {
  try {
    const raw = await readFile(CONFIG_PATH, "utf8");
    return JSON.parse(raw) as CliConfig;
  } catch {
    return null;
  }
}

export async function saveConfig(config: CliConfig) {
  await mkdir(join(homedir(), ".kuberize"), { recursive: true });
  await writeFile(CONFIG_PATH, JSON.stringify(config, null, 2), { mode: 0o600 });
  return CONFIG_PATH;
}

export async function requireConfig() {
  const config = await loadConfig();
  if (!config) {
    console.error("Not logged in. Run: kuberize login --url <url> --key <key>");
    process.exit(1);
  }
  return config;
}
