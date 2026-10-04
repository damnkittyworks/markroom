import vinext from "vinext";
import { readFile } from "node:fs/promises";
import { defineConfig } from "vite";
import { sites } from "./build/sites-vite-plugin";

const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";

export default defineConfig(async () => {
  process.env.WRANGLER_WRITE_LOGS ??= "false";
  process.env.WRANGLER_LOG_PATH ??= ".wrangler/logs";
  process.env.MINIFLARE_REGISTRY_PATH ??= ".wrangler/registry";
  const { cloudflare } = await import("@cloudflare/vite-plugin");
  const useSites = process.env.MARKROOM_SITES === "1";
  // Standalone builds do not read or package the author's Sites project ID.
  const hosting = useSites
    ? JSON.parse(await readFile(new URL("./.openai/hosting.json", import.meta.url), "utf8")) as { d1: string; r2: string }
    : undefined;

  return {
    build: { license: { fileName: "THIRD_PARTY_LICENSES.md" } },
    server: isCodexSeatbeltSandbox
      ? { watch: { useFsEvents: false, usePolling: true } }
      : undefined,
    plugins: [
      vinext(),
      ...(useSites ? [sites()] : []),
      cloudflare({
        configPath: process.env.MARKROOM_WRANGLER_CONFIG ?? "wrangler.jsonc",
        persistState: { path: ".wrangler/state" },
        viteEnvironment: { name: "rsc", childEnvironments: ["ssr"] },
        ...(hosting ? { config: {
          d1_databases: [{ binding: hosting.d1, database_name: "site-creator-d1", database_id: "00000000-0000-4000-8000-000000000000", migrations_dir: "drizzle" }],
          r2_buckets: [{ binding: hosting.r2, bucket_name: "site-creator-r2" }],
        } } : {}),
      }),
    ],
  };
});
