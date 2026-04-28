import { writeFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

export async function runHelm(args: string[]) {
  const proc = Bun.spawn(["helm", ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  if (exitCode !== 0) {
    const detail = [
      stderr.trim() ? `stderr: ${stderr.trim()}` : "",
      stdout.trim() ? `stdout: ${stdout.trim()}` : "",
    ]
      .filter(Boolean)
      .join("\n");
    throw new Error(`helm ${args[0]} failed (exit ${exitCode})\n${detail}`);
  }

  return { stdout, stderr };
}

export async function helmInstall(
  release: string,
  chart: string,
  namespace: string,
  values: Record<string, unknown>,
  version?: string
) {
  const valuesFile = join(tmpdir(), `kuberize-helm-values-${Date.now()}.json`);
  try {
    await writeFile(valuesFile, JSON.stringify(values));
    const args = [
      "upgrade",
      "--install",
      release,
      chart,
      "-n",
      namespace,
      "--create-namespace",
      "-f",
      valuesFile,
    ];
    if (version) {
      args.push("--version", version);
    }
    await runHelm(args);
  } finally {
    await rm(valuesFile, { force: true });
  }
}

export async function helmUninstall(release: string, namespace: string) {
  await runHelm(["uninstall", release, "-n", namespace, "--ignore-not-found"]);
}

export async function helmStatus(release: string, namespace: string) {
  try {
    const { stdout } = await runHelm([
      "status",
      release,
      "-n",
      namespace,
      "--output",
      "json",
    ]);
    return JSON.parse(stdout) as unknown;
  } catch {
    return null;
  }
}

export function generatePassword() {
  return Buffer.from(crypto.getRandomValues(new Uint8Array(24))).toString(
    "base64url"
  );
}

const PLAN_RESOURCES = {
  small: {
    requests: { cpu: "100m", memory: "256Mi" },
    limits: { cpu: "500m", memory: "512Mi" },
  },
  medium: {
    requests: { cpu: "250m", memory: "512Mi" },
    limits: { cpu: "1000m", memory: "1Gi" },
  },
  large: {
    requests: { cpu: "500m", memory: "1Gi" },
    limits: { cpu: "2000m", memory: "2Gi" },
  },
};

export function planResources(plan: "small" | "medium" | "large") {
  return PLAN_RESOURCES[plan];
}
