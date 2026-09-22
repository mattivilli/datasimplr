// Reads server-only secrets/env vars on Cloudflare Workers.
//
// Nitro's own generated Cloudflare handler (.output/server/index.mjs,
// node_modules/nitro/dist/presets/cloudflare/runtime/_module-handler.mjs)
// sets `globalThis.__env__ = env` synchronously at the true Workers entry
// point, before any routing happens — that's nitro's own documented
// mechanism for this, and the one that's actually reliable here.
// `process.env` (even with nodejs_compat + nodejs_compat_populate_process_env)
// and a bare `cloudflare:workers` import both showed the right key *names*
// with empty values intermittently on this deployment (no_bundle cloudflare
// preset splits the app into many lazily-loaded ES modules), so read the
// nitro global first and fall back to process.env for non-Workers environments.
declare global {
  // eslint-disable-next-line no-var
  var __env__: Record<string, string | undefined> | undefined;
}

export function getServerEnv(name: string): string | undefined {
  const fromNitroGlobal = globalThis.__env__?.[name];
  if (fromNitroGlobal) return fromNitroGlobal;
  return process.env[name];
}
