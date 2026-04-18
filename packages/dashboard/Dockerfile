FROM oven/bun:1-alpine AS build
WORKDIR /app

COPY package.json bun.lock tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/dashboard/package.json packages/dashboard/
RUN bun install --frozen-lockfile

COPY packages/shared packages/shared
COPY packages/dashboard packages/dashboard

WORKDIR /app/packages/dashboard
RUN bun run build

FROM oven/bun:1-alpine
WORKDIR /app/packages/dashboard

COPY --from=build /app/node_modules /app/node_modules
COPY --from=build /app/package.json /app/bun.lock /app/
COPY --from=build /app/packages/shared /app/packages/shared
COPY --from=build /app/packages/dashboard /app/packages/dashboard

ENV NODE_ENV=production
ENV PORT=3000
EXPOSE 3000

CMD ["bun", "run", "start"]
