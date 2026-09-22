// Reads server-only secrets/env vars. On Cloudflare Workers, `process.env` (even with
// nodejs_compat + nodejs_compat_populate_process_env) can expose the right key names with
// empty values when the build ships as separate un-bundled modules (nitro's `no_bundle`
// cloudflare preset). `cloudflare:workers`'s `env` export is the runtime-correct source of
// bindings/secrets regardless of module layout, so prefer it and fall back to process.env
// for non-Workers environments (local dev, other hosts).
export async function getServerEnv(name: string): Promise<string | undefined> {
  try {
    // @ts-expect-error - no @cloudflare/workers-types in this project; module exists at runtime on Workers.
    const { env } = (await import('cloudflare:workers')) as { env: Record<string, string | undefined> };
    if (env?.[name]) return env[name];
  } catch {
    // Not running on Cloudflare Workers.
  }
  return process.env[name];
}
