import { access, mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const config = path.join(root, "dist/server/wrangler.json");
await access(config).catch(() => {
  throw new Error("Built Worker is missing. Run npm run build before npm start.");
});
await mkdir(path.join(root, ".wrangler"), { recursive: true });
const child = spawn(process.execPath, [
  path.join(root, "node_modules/wrangler/bin/wrangler.js"),
  "dev", "--local", "--config", config,
  "--persist-to", path.join(root, ".wrangler/state"),
  ...process.argv.slice(2),
], {
  cwd: root,
  stdio: "inherit",
  env: { ...process.env, WRANGLER_LOG_PATH: path.join(root, ".wrangler/preview.log") },
});
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
child.on("error", (error) => { console.error(error.message); process.exitCode = 1; });
child.on("exit", (code) => { process.exitCode = code ?? 1; });
