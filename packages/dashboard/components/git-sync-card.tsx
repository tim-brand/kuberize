import { enableWebhookAction } from "../lib/actions";
import { Button } from "./ui/button";
import type { ProjectWebhookStatus } from "../lib/api";

function Dot({ className }: { className: string }) {
  return <span className={`inline-block size-2 rounded-full ${className}`} />;
}

export function GitSyncCard({
  projectId,
  branch,
  status,
}: {
  projectId: string;
  branch: string;
  status: ProjectWebhookStatus | null;
}) {
  return (
    <section className="mb-10">
      <h2 className="mb-3 text-lg font-medium">Git sync</h2>
      <div className="rounded border border-zinc-200 p-4 dark:border-zinc-800">
        {status === null ? (
          <p className="text-sm text-zinc-500">Sync status unavailable.</p>
        ) : status.configured ? (
          <div className="flex items-center justify-between">
            <div>
              <div className="flex items-center gap-2 text-sm font-medium">
                <Dot className="bg-green-500" /> Instant sync enabled
              </div>
              <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                Pushes to <code>{branch}</code> apply your <code>.kuberize.yaml</code> within
                seconds, with a 60s polling fallback.
              </p>
            </div>
            {status.hook?.lastResponse?.code != null && (
              <div className="text-xs text-zinc-500">
                last delivery: {status.hook.lastResponse.code}
              </div>
            )}
          </div>
        ) : status.canCreate ? (
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="flex items-center gap-2 text-sm font-medium">
                <Dot className="bg-zinc-400" /> Polling every 60s
              </div>
              <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                Add a GitHub webhook so pushes to <code>{branch}</code> sync instantly.
              </p>
            </div>
            <form action={enableWebhookAction.bind(null, projectId)}>
              <Button type="submit">Enable instant sync</Button>
            </form>
          </div>
        ) : status.error === "token_scope" && status.manual ? (
          <div>
            <div className="flex items-center gap-2 text-sm font-medium">
              <Dot className="bg-amber-500" /> Polling every 60s — webhook needs manual setup
            </div>
            <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
              The project&apos;s GitHub token can&apos;t manage webhooks (it needs the{" "}
              <code>admin:repo_hook</code> scope). Add one manually under the repo&apos;s{" "}
              <span className="font-medium">Settings → Webhooks</span>:
            </p>
            <dl className="mt-3 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm">
              <dt className="text-zinc-500">Payload URL</dt>
              <dd>
                <code>{status.manual.payloadUrl}</code>
              </dd>
              <dt className="text-zinc-500">Content type</dt>
              <dd>
                <code>{status.manual.contentType}</code>
              </dd>
              <dt className="text-zinc-500">Secret</dt>
              <dd>
                <code>{status.manual.secret}</code>
              </dd>
              <dt className="text-zinc-500">Events</dt>
              <dd>Just the push event</dd>
            </dl>
          </div>
        ) : (
          <p className="text-sm text-zinc-500">
            Polling every 60s. Webhook setup unavailable
            {status.error === "not_configured"
              ? " — set KUBERIZE_API_PUBLIC_URL on the API"
              : status.error === "not_github"
                ? " — repository is not on github.com"
                : ""}
            .
          </p>
        )}
      </div>
    </section>
  );
}
