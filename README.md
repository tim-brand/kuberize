# Kuberize

A self-hosted, Kubernetes-native PaaS. Declare apps and their
dependencies in a `.kuberize.yaml` file in your Git repo; Kuberize
turns that into running workloads on any Kubernetes cluster.

Think Coolify or Railway — but every resource is a proper Kubernetes
object (`Deployment`, `Service`, `Ingress`, `PersistentVolumeClaim`,
managed services via Bitnami Helm charts), and the Git repo is the
single source of truth.

> **Status:** v1 MVP, experimental. The operator, API, dashboard, CLI,
> and Helm chart all exist and have been smoke-tested end-to-end on
> Docker Desktop. Prebuilt container images are not yet published, and
> several features (log streaming, full GitHub push-event sync, PR
> previews, Kaniko builds) are deferred. Not production-ready.

## What it does today

- **Deploys pre-built container images** into a standard Kubernetes
  Deployment/Service/Ingress, with cert-manager TLS.
- **Provisions managed services** — PostgreSQL, Redis, RabbitMQ, MinIO
  — via Bitnami Helm charts, exposing a standardised connection secret.
- **Wires services into apps** by mirroring the connection secret into
  the app's namespace and injecting env vars via `secretKeyRef`. Apps
  wait (with a "Pending" status) until their services are `Ready`.
- **Syncs `.kuberize.yaml` from Git** — the operator polls the config
  branch every 60s, and an HMAC-verified GitHub webhook endpoint makes
  pushes apply within seconds (see
  [Instant config sync](#instant-config-sync-github-webhook)).
- **Exposes a REST API** (Hono) over three CRDs, plus a `/webhooks/deploy`
  endpoint CI can call with a new image tag.
- **Ships a Next.js dashboard** (Server Components + Server Actions) and
  a single-executable Bun CLI.

## How it's designed

Three Custom Resources drive everything:

| CRD              | Purpose                                                     |
|------------------|-------------------------------------------------------------|
| `KuberizeProject`| Repo + registry credentials, base domain, environments      |
| `KuberizeApp`    | One per app per environment — image, resources, routing     |
| `KuberizeService`| Managed service (PG/Redis/etc.), scope `project` or `app`   |

The operator (`packages/operator`) watches these CRDs and reconciles
them into plain Kubernetes resources. The API server
(`packages/api`) is a thin CRUD layer over the same CRDs plus a
deploy webhook. The dashboard (`packages/dashboard`) talks only to
the API — the API key never reaches the browser.

State lives in etcd via CRDs; there is no separate Kuberize database.

## Prerequisites

- A Kubernetes cluster (Docker Desktop's built-in cluster is fine for dev)
- `kubectl`, `helm` on `PATH`
- [Bun](https://bun.sh) 1.3 or newer
- nginx-ingress + cert-manager installed in the cluster (for ingress/TLS)

## Quick start (local dev)

```bash
# 1. Install workspace dependencies
bun install

# 2. Apply the CRDs and create the system namespace
kubectl apply -f k8s/crds/
kubectl create namespace kuberize-system

# 3. Start the operator (watches CRDs, reconciles)
cd packages/operator && bun run dev
```

In separate terminals, start the API and dashboard:

```bash
# API
cd packages/api
API_KEY=dev-key GITHUB_WEBHOOK_SECRET=dev bun run dev

# Dashboard
cd packages/dashboard
KUBERIZE_API_URL=http://localhost:3001 \
KUBERIZE_API_KEY=dev-key \
bun run dev
```

Open the dashboard at `http://localhost:3000`, or use the CLI:

```bash
cd packages/cli
bun run dev login --url http://localhost:3001 --key dev-key
bun run dev projects list
```

## Minimal `.kuberize.yaml`

```yaml
project: my-app

environments:
  production:
    branch: main

services:
  - name: db
    type: postgresql
    plan: small
    scope: project

apps:
  - name: api
    path: apps/api
    build:
      type: image
      image: ghcr.io/me/my-app-api:latest
    expose:
      port: 3000
      healthCheck: /health
    services:
      - db
    env:
      - name: DATABASE_URL
        fromService: db.connectionString
    environments:            # optional per-app, per-environment overrides
      staging:
        branch: feature/big-redesign   # this app's staging tracks a different branch
        # domain: preview.my-app.dev   # custom domain override also lives here
```

An app's branch resolves as: per-app override
(`apps[i].environments[<env>].branch`) → environment mapping
(`environments.<env>.branch`) → the project's config branch. The
`.kuberize.yaml` itself is always read from the project's config branch,
regardless of overrides.

The full schema lives in
[`packages/shared/src/schema.ts`](packages/shared/src/schema.ts).

## Installing on a real cluster

Each tagged GitHub Release publishes three multi-arch images
(`linux/amd64` + `linux/arm64`) to GHCR and the Helm chart itself as an
OCI artifact. Install with:

```bash
helm install kuberize oci://ghcr.io/tim-brand/charts/kuberize \
  --version <version> \
  --namespace kuberize-system --create-namespace \
  --set global.baseDomain=kuberize.mycompany.com \
  --set global.clusterIssuer=letsencrypt-prod
```

The chart's default image tag follows `.Chart.AppVersion`, so
`--version 0.2.0` pulls `kuberize-operator:0.2.0`,
`kuberize-api:0.2.0`, and `kuberize-dashboard:0.2.0`. Override any
individual image with `--set operator.image.tag=sha-abc123`.

You can also install directly from a clone of this repo:
`helm install kuberize ./k8s/helm/kuberize --set global.baseDomain=...`.

## Instant config sync (GitHub webhook)

The operator picks up `.kuberize.yaml` changes by polling the project's
config branch every 60 seconds (interval: `KUBERIZE_SYNC_INTERVAL_MS`).
Adding a GitHub **push webhook** makes changes apply within seconds
instead; polling stays active as a fallback.

**From the dashboard (easiest):** open the project and click
**Enable instant sync** on the *Git sync* card. This creates the webhook
through the project's GitHub token — the token needs the
`admin:repo_hook` scope (classic PAT) or webhook read/write permission
(fine-grained PAT). If the token can't manage hooks, the card shows the
manual values instead.

**Manually:** in the GitHub repo under *Settings → Webhooks → Add
webhook*, set:

| Field        | Value                                        |
|--------------|----------------------------------------------|
| Payload URL  | `https://<api-host>/webhooks/github`         |
| Content type | `application/json`                           |
| Secret       | the `GITHUB_WEBHOOK_SECRET` value (see below)|
| Events       | Just the push event                          |

With the Helm chart, the API host is `kuberize-api.<global.baseDomain>`
and the secret can be read from the cluster:

```bash
kubectl get secret kuberize-api-secrets -n kuberize-system \
  -o jsonpath='{.data.GITHUB_WEBHOOK_SECRET}' | base64 -d
```

Only pushes to the branch the project reads its config from
(`spec.repo.branch`) trigger a sync — pushes to other branches and tag
pushes are acknowledged and ignored. The API stamps a
`kuberize.io/requested-sync-at` annotation on the `KuberizeProject`;
the operator syncs and records it in `status.lastHandledSyncRequest`,
so duplicate watch events never double-sync.

**What triggers a sync:** the webhook only requests an instant sync when the
push actually touched `.kuberize.yaml` — code-only pushes are acknowledged and
skipped (the response lists them under `skipped`). Force pushes and pushes
whose payload doesn't carry file lists are treated as config changes to stay
safe. The 60-second poll is also cheap when idle: the operator records the
synced commit in `status.lastSyncedSha` and skips the repo clone entirely
(one `git ls-remote` ref lookup instead) while the branch HEAD is unchanged.
Manually annotating the project with `kuberize.io/requested-sync-at` always
forces a full sync. This also means drift repair (e.g. a manually deleted
`KuberizeApp`) waits for the next push or forced sync while the branch HEAD
is unchanged — annotate the project to repair immediately.

Note: each app's `triggerOn` list is *not* consulted for sync gating — it is
reserved for CI build filtering (v2).

## Project structure

```
packages/
  shared/     — Zod schemas, CRD TypeScript types, naming utilities
  operator/   — watches CRDs, reconciles K8s state, shells out to helm
  api/        — REST API (Hono) + GitHub/deploy webhooks
  dashboard/  — Next.js 16 UI (Server Components + Server Actions)
  cli/        — commander-based Bun CLI, compilable to a single binary
k8s/
  crds/       — CustomResourceDefinition YAML (source of truth)
  helm/       — Helm chart for installing Kuberize itself
```

## What's deferred

Known gaps from the v1 scope, intentionally not yet implemented:

- Pod log streaming (API SSE + dashboard viewer + CLI streaming)
- CI workflow generator wired up as an API route
- Bcrypt-hashed API keys backed by a Kubernetes Secret
- Dashboard dependency graph (reactflow)
- Dockerfile builds via Kaniko (planned for v2)
- PR preview environments (planned for v2)
- MySQL / MongoDB service types (v1 ships PG, Redis, RabbitMQ, MinIO only)

## License

Apache 2.0 — see [LICENSE](LICENSE).
