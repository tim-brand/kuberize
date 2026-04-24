FROM oven/bun:1-alpine AS base
RUN apk add --no-cache git curl bash tar gzip openssl \
 && curl -fsSL https://raw.githubusercontent.com/helm/helm/main/scripts/get-helm-3 | bash

WORKDIR /app

# Install workspace deps. Bun's lockfile-integrity check inspects every workspace
# package.json, so copy them all even though the operator only needs shared.
COPY package.json bun.lock tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/operator/package.json packages/operator/
COPY packages/api/package.json packages/api/
COPY packages/dashboard/package.json packages/dashboard/
COPY packages/cli/package.json packages/cli/
RUN bun install --frozen-lockfile --production

# Copy sources
COPY packages/shared packages/shared
COPY packages/operator packages/operator

ENV NODE_ENV=production
ENV HEALTH_PORT=8080
EXPOSE 8080

CMD ["bun", "run", "packages/operator/src/index.ts"]
