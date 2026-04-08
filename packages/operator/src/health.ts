export function startHealthServer() {
  const port = Number(process.env.HEALTH_PORT ?? 8080);
  const watchers = new Map<string, boolean>();

  const server = Bun.serve({
    port,
    fetch(req) {
      const url = new URL(req.url);

      if (url.pathname === "/healthz") {
        return Response.json({ ok: true }, { status: 200 });
      }

      if (url.pathname === "/readyz") {
        if (watchers.size === 0) {
          return Response.json({ ok: true }, { status: 200 });
        }
        const allConnected = Array.from(watchers.values()).every(Boolean);
        return Response.json({ ok: allConnected }, { status: allConnected ? 200 : 503 });
      }

      return Response.json({ ok: false }, { status: 404 });
    },
  });

  console.log(`Health server listening on port ${server.port}`);

  return {
    registerWatcher(name: string) {
      watchers.set(name, false);
    },
    markWatcherConnected(name: string) {
      watchers.set(name, true);
    },
    markWatcherDisconnected(name: string) {
      watchers.set(name, false);
    },
  };
}
