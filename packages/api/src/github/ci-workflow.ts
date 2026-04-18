type CiWorkflowInput = {
  project: string;
  apps: { name: string; path: string; registry: string }[];
  branch: string;
  kuberizeApiUrl: string;
};

export function generateCiWorkflow(input: CiWorkflowInput) {
  const { project, apps, branch, kuberizeApiUrl } = input;
  const jobs = apps
    .map((app) => {
      const imageTag = `${app.registry}:\${{ github.sha }}`;
      return `  deploy-${app.name}:
    if: contains(steps.changes.outputs.files, '${app.path}/')
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: \${{ github.actor }}
          password: \${{ secrets.GITHUB_TOKEN }}
      - uses: docker/build-push-action@v5
        with:
          context: ${app.path}
          push: true
          tags: ${imageTag}
      - name: Notify Kuberize
        run: |
          curl -fsSL -X POST ${kuberizeApiUrl}/api/v1/webhooks/deploy \\
            -H "Authorization: Bearer \${{ secrets.KUBERIZE_API_KEY }}" \\
            -H "Content-Type: application/json" \\
            -d '{"project":"${project}","app":"${app.name}","image":"${imageTag}","commit":{"sha":"\${{ github.sha }}","message":"\${{ github.event.head_commit.message }}","author":"\${{ github.actor }}"}}'`;
    })
    .join("\n\n");

  return `name: Deploy via Kuberize
on:
  push:
    branches: [${branch}]
jobs:
${jobs}
`;
}
