FROM oven/bun:1-alpine
WORKDIR /app

# Bun's lockfile-integrity check inspects every workspace package.json.
COPY package.json bun.lock tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/operator/package.json packages/operator/
COPY packages/api/package.json packages/api/
COPY packages/dashboard/package.json packages/dashboard/
COPY packages/cli/package.json packages/cli/
RUN bun install --frozen-lockfile --production

COPY packages/shared packages/shared
COPY packages/api packages/api

ENV NODE_ENV=production
ENV PORT=3001
EXPOSE 3001

CMD ["bun", "run", "packages/api/src/index.ts"]
