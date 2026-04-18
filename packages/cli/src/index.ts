#!/usr/bin/env bun
import { Command } from "commander";
import { readFile } from "node:fs/promises";
import { load as parseYaml } from "js-yaml";
import {
  KuberizeConfigSchema,
  type KuberizeProject,
  type KuberizeApp,
  type KuberizeService,
} from "@kuberize/shared";
import { loadConfig, requireConfig, saveConfig } from "./config.js";
import { apiCall } from "./client.js";

const program = new Command();
program
  .name("kuberize")
  .description("Kuberize CLI — manage projects, apps, and services")
  .version("0.0.1");

// ─── login ────────────────────────────────────────────────────────────────
program
  .command("login")
  .description("Save API URL and key to ~/.kuberize/config.json")
  .requiredOption("--url <url>", "Kuberize API base URL")
  .requiredOption("--key <key>", "Kuberize API key")
  .action(async (opts: { url: string; key: string }) => {
    const path = await saveConfig({ url: opts.url, key: opts.key });
    console.log(`Saved config to ${path}`);
  });

program
  .command("whoami")
  .description("Show the currently configured API URL")
  .action(async () => {
    const config = await loadConfig();
    if (!config) {
      console.log("Not logged in.");
      return;
    }
    console.log(`URL: ${config.url}`);
    console.log("Key: [hidden]");
  });

// ─── projects ─────────────────────────────────────────────────────────────
const projects = program.command("projects").description("Manage projects");

projects
  .command("list")
  .description("List all projects")
  .action(async () => {
    const config = await requireConfig();
    const { items } = await apiCall<{ items: KuberizeProject[] }>(
      config,
      "/api/v1/projects"
    );
    if (items.length === 0) {
      console.log("No projects.");
      return;
    }
    for (const p of items) {
      console.log(
        `${p.metadata.name}  ${p.status?.phase ?? "Pending"}  ${p.spec.repo.url}`
      );
    }
  });

projects
  .command("create")
  .description("Create a new project")
  .requiredOption("--name <name>")
  .requiredOption("--repo <url>")
  .requiredOption("--github-token <token>")
  .requiredOption("--registry-url <url>")
  .requiredOption("--registry-username <username>")
  .requiredOption("--registry-password <password>")
  .requiredOption("--base-domain <domain>")
  .option("--branch <branch>", "Default branch", "main")
  .option("--cluster-issuer <name>", "cert-manager ClusterIssuer", "letsencrypt-prod")
  .option("--display-name <name>")
  .action(async (opts) => {
    const config = await requireConfig();
    const project = await apiCall<KuberizeProject>(config, "/api/v1/projects", {
      method: "POST",
      body: {
        name: opts.name,
        displayName: opts.displayName,
        repoUrl: opts.repo,
        repoBranch: opts.branch,
        githubToken: opts.githubToken,
        registry: {
          url: opts.registryUrl,
          username: opts.registryUsername,
          password: opts.registryPassword,
        },
        baseDomain: opts.baseDomain,
        clusterIssuer: opts.clusterIssuer,
      },
    });
    console.log(`Created project ${project.metadata.name}`);
  });

projects
  .command("delete <name>")
  .description("Delete a project")
  .action(async (name: string) => {
    const config = await requireConfig();
    await apiCall<void>(config, `/api/v1/projects/${name}`, { method: "DELETE" });
    console.log(`Deleted project ${name}`);
  });

// ─── apps ─────────────────────────────────────────────────────────────────
const apps = program.command("apps").description("Manage apps");

apps
  .command("list")
  .description("List apps for a project")
  .requiredOption("--project <name>")
  .action(async (opts: { project: string }) => {
    const config = await requireConfig();
    const { items } = await apiCall<{ items: KuberizeApp[] }>(
      config,
      `/api/v1/projects/${opts.project}/apps`
    );
    if (items.length === 0) {
      console.log("No apps.");
      return;
    }
    for (const a of items) {
      console.log(
        `${a.metadata.name}  ${a.status?.phase ?? "Pending"}  ${a.spec.image}  ${a.status?.url ?? ""}`
      );
    }
  });

apps
  .command("deploy")
  .description("Trigger a deploy with a new image tag")
  .requiredOption("--project <name>")
  .requiredOption("--app <name>")
  .requiredOption("--image <tag>")
  .option("--environment <env>")
  .option("--commit-sha <sha>")
  .option("--commit-message <msg>")
  .option("--commit-author <author>")
  .action(async (opts) => {
    const config = await requireConfig();
    const body: Record<string, unknown> = {
      project: opts.project,
      app: opts.app,
      image: opts.image,
    };
    if (opts.environment) body.environment = opts.environment;
    if (opts.commitSha || opts.commitMessage || opts.commitAuthor) {
      body.commit = {
        sha: opts.commitSha ?? "",
        message: opts.commitMessage ?? "",
        author: opts.commitAuthor ?? "",
      };
    }
    const result = await apiCall<{ patched: string[]; missing: string[] }>(
      config,
      "/api/v1/webhooks/deploy",
      { method: "POST", body }
    );
    console.log(`Patched: ${result.patched.join(", ") || "(none)"}`);
    if (result.missing.length > 0) {
      console.log(`Missing: ${result.missing.join(", ")}`);
    }
  });

// ─── services ─────────────────────────────────────────────────────────────
const services = program.command("services").description("Manage services");

services
  .command("list")
  .description("List services for a project")
  .requiredOption("--project <name>")
  .action(async (opts: { project: string }) => {
    const config = await requireConfig();
    const { items } = await apiCall<{ items: KuberizeService[] }>(
      config,
      `/api/v1/projects/${opts.project}/services`
    );
    if (items.length === 0) {
      console.log("No services.");
      return;
    }
    for (const s of items) {
      console.log(
        `${s.metadata.name}  ${s.status?.phase ?? "Pending"}  ${s.spec.type}  ${s.spec.plan}  scope:${s.spec.scope}`
      );
    }
  });

// ─── config ──────────────────────────────────────────────────────────────
const configCmd = program.command("config").description("Local config helpers");

configCmd
  .command("validate [file]")
  .description("Validate a .kuberize.yaml file against the schema")
  .action(async (file?: string) => {
    const path = file ?? ".kuberize.yaml";
    let raw: string;
    try {
      raw = await readFile(path, "utf8");
    } catch (err) {
      console.error(`Failed to read ${path}: ${(err as Error).message}`);
      process.exit(1);
    }
    const parsed = KuberizeConfigSchema.safeParse(parseYaml(raw));
    if (!parsed.success) {
      console.error("Invalid .kuberize.yaml:");
      for (const issue of parsed.error.issues) {
        console.error(`  ${issue.path.join(".")}: ${issue.message}`);
      }
      process.exit(1);
    }
    console.log(`${path} is valid.`);
  });

program.parseAsync().catch((err) => {
  console.error(err.message ?? err);
  process.exit(1);
});
