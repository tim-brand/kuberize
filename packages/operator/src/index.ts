import { startHealthServer } from "./health.js";
import { startProjectWatcher } from "./reconcilers/project.js";

console.log("Kuberize operator starting...");
console.log(`Bun ${Bun.version}`);

const health = startHealthServer();

startProjectWatcher(health);

process.on("SIGTERM", () => {
  console.log("Received SIGTERM, shutting down...");
  process.exit(0);
});

process.on("SIGINT", () => {
  console.log("Received SIGINT, shutting down...");
  process.exit(0);
});
