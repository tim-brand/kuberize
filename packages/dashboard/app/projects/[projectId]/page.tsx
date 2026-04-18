import Link from "next/link";
import { notFound } from "next/navigation";
import { api } from "../../../lib/api";
import { DeployStatus } from "../../../components/deploy-status";

export default async function ProjectDetailPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId } = await params;

  let project;
  try {
    project = await api.getProject(projectId);
  } catch {
    notFound();
  }

  const [appsRes, servicesRes] = await Promise.all([
    api.listApps(projectId),
    api.listServices(projectId),
  ]);

  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-10">
      <div className="mb-8">
        <Link href="/projects" className="text-sm text-zinc-500 hover:underline">
          ← Projects
        </Link>
        <div className="mt-2 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">{project.spec.displayName}</h1>
            <div className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              {project.spec.repo.url} · {project.spec.baseDomain}
            </div>
          </div>
          <DeployStatus phase={project.status?.phase} />
        </div>
      </div>

      <section className="mb-10">
        <h2 className="mb-3 text-lg font-medium">Apps</h2>
        {appsRes.items.length === 0 ? (
          <p className="text-sm text-zinc-500">No apps yet.</p>
        ) : (
          <ul className="divide-y divide-zinc-200 rounded border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
            {appsRes.items.map((app) => (
              <li key={app.metadata.name} className="flex items-center justify-between p-4">
                <div>
                  <div className="font-medium">{app.spec.appName}</div>
                  <div className="text-sm text-zinc-500 dark:text-zinc-400">
                    {app.spec.environment} · {app.spec.image}
                  </div>
                  {app.status?.url && (
                    <a
                      href={app.status.url}
                      className="mt-1 block text-xs text-blue-600 hover:underline dark:text-blue-400"
                      target="_blank"
                      rel="noreferrer"
                    >
                      {app.status.url}
                    </a>
                  )}
                </div>
                <DeployStatus phase={app.status?.phase} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-lg font-medium">Services</h2>
        {servicesRes.items.length === 0 ? (
          <p className="text-sm text-zinc-500">No services yet.</p>
        ) : (
          <ul className="divide-y divide-zinc-200 rounded border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
            {servicesRes.items.map((svc) => (
              <li key={svc.metadata.name} className="flex items-center justify-between p-4">
                <div>
                  <div className="font-medium">{svc.spec.serviceName}</div>
                  <div className="text-sm text-zinc-500 dark:text-zinc-400">
                    {svc.spec.type} · {svc.spec.plan} · scope: {svc.spec.scope}
                  </div>
                </div>
                <DeployStatus phase={svc.status?.phase} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
