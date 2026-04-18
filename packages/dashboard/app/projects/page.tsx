import Link from "next/link";
import { api } from "../../lib/api";
import { Button } from "../../components/ui/button";

export default async function ProjectsPage() {
  const { items } = await api.listProjects();

  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-10">
      <div className="flex items-center justify-between mb-8">
        <h1 className="text-2xl font-semibold">Projects</h1>
        <Link href="/projects/new">
          <Button>Connect Repository</Button>
        </Link>
      </div>

      {items.length === 0 ? (
        <div className="rounded border border-dashed border-zinc-300 p-10 text-center text-zinc-500 dark:border-zinc-700 dark:text-zinc-400">
          No projects yet. Connect a repository to get started.
        </div>
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {items.map((p) => (
            <li key={p.metadata.name}>
              <Link
                href={`/projects/${p.metadata.name}`}
                className="block rounded border border-zinc-200 p-4 hover:border-zinc-400 dark:border-zinc-800 dark:hover:border-zinc-600"
              >
                <div className="text-lg font-medium">{p.spec.displayName}</div>
                <div className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                  {p.spec.repo.url}
                </div>
                <div className="mt-2 text-xs uppercase tracking-wide text-zinc-400">
                  {p.status?.phase ?? "Pending"}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
