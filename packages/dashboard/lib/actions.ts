"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { api } from "./api";

export async function createProjectAction(formData: FormData) {
  const input = {
    name: String(formData.get("name") ?? ""),
    displayName: String(formData.get("displayName") ?? "") || undefined,
    repoUrl: String(formData.get("repoUrl") ?? ""),
    repoBranch: String(formData.get("repoBranch") ?? "main"),
    githubToken: String(formData.get("githubToken") ?? ""),
    registry: {
      url: String(formData.get("registryUrl") ?? ""),
      username: String(formData.get("registryUsername") ?? ""),
      password: String(formData.get("registryPassword") ?? ""),
    },
    baseDomain: String(formData.get("baseDomain") ?? ""),
    clusterIssuer: String(formData.get("clusterIssuer") ?? "") || undefined,
  };

  await api.createProject(input);
  revalidatePath("/projects");
  redirect(`/projects/${input.name}`);
}

export async function deleteProjectAction(projectId: string) {
  await api.deleteProject(projectId);
  revalidatePath("/projects");
  redirect("/projects");
}

export async function enableWebhookAction(projectId: string) {
  await api.enableProjectWebhook(projectId);
  revalidatePath(`/projects/${projectId}`);
}
