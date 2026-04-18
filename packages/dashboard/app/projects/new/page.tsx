import Link from "next/link";
import { createProjectAction } from "../../../lib/actions";
import { Button } from "../../../components/ui/button";

function Label({ children, htmlFor }: { children: React.ReactNode; htmlFor: string }) {
  return (
    <label htmlFor={htmlFor} className="block text-sm font-medium">
      {children}
    </label>
  );
}

function Input(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className="mt-1 block w-full rounded border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950"
    />
  );
}

export default function NewProjectPage() {
  return (
    <div className="mx-auto w-full max-w-2xl px-6 py-10">
      <div className="mb-6">
        <Link href="/projects" className="text-sm text-zinc-500 hover:underline">
          ← Projects
        </Link>
      </div>
      <h1 className="mb-6 text-2xl font-semibold">Connect Repository</h1>

      <form action={createProjectAction} className="space-y-5">
        <div>
          <Label htmlFor="name">Project name (k8s slug)</Label>
          <Input id="name" name="name" required placeholder="my-project" />
        </div>
        <div>
          <Label htmlFor="displayName">Display name</Label>
          <Input id="displayName" name="displayName" placeholder="My Project" />
        </div>
        <div>
          <Label htmlFor="repoUrl">Repository URL</Label>
          <Input
            id="repoUrl"
            name="repoUrl"
            required
            placeholder="https://github.com/org/repo"
          />
        </div>
        <div>
          <Label htmlFor="repoBranch">Default branch</Label>
          <Input id="repoBranch" name="repoBranch" defaultValue="main" />
        </div>
        <div>
          <Label htmlFor="githubToken">GitHub token</Label>
          <Input id="githubToken" name="githubToken" type="password" required />
        </div>

        <fieldset className="rounded border border-zinc-200 p-4 dark:border-zinc-800">
          <legend className="px-2 text-sm font-medium">Registry</legend>
          <div className="space-y-4">
            <div>
              <Label htmlFor="registryUrl">URL</Label>
              <Input id="registryUrl" name="registryUrl" required placeholder="ghcr.io/myorg" />
            </div>
            <div>
              <Label htmlFor="registryUsername">Username</Label>
              <Input id="registryUsername" name="registryUsername" required />
            </div>
            <div>
              <Label htmlFor="registryPassword">Password / token</Label>
              <Input
                id="registryPassword"
                name="registryPassword"
                type="password"
                required
              />
            </div>
          </div>
        </fieldset>

        <div>
          <Label htmlFor="baseDomain">Base domain</Label>
          <Input
            id="baseDomain"
            name="baseDomain"
            required
            placeholder="kuberize.mycompany.com"
          />
        </div>
        <div>
          <Label htmlFor="clusterIssuer">Cluster issuer</Label>
          <Input
            id="clusterIssuer"
            name="clusterIssuer"
            defaultValue="letsencrypt-prod"
          />
        </div>

        <Button type="submit">Create Project</Button>
      </form>
    </div>
  );
}
