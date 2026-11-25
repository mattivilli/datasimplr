import * as duckdb from "@duckdb/duckdb-wasm";
import ehWorker from "@duckdb/duckdb-wasm/dist/duckdb-browser-eh.worker.js?url";
import mvpWorker from "@duckdb/duckdb-wasm/dist/duckdb-browser-mvp.worker.js?url";

export type DuckContext = {
  db: duckdb.AsyncDuckDB;
  conn: duckdb.AsyncDuckDBConnection;
};

// The engine .wasm files are 33 MB and 38 MB, over Cloudflare Workers' 25 MiB limit for
// static assets, so they cannot ship with the site. They load from jsDelivr, pinned to the
// installed @duckdb/duckdb-wasm version. The small worker scripts stay on our own origin.
const CDN = duckdb.getJsDelivrBundles();

const BUNDLES: duckdb.DuckDBBundles = {
  mvp: { mainModule: CDN.mvp.mainModule, mainWorker: mvpWorker },
  ...(CDN.eh ? { eh: { mainModule: CDN.eh.mainModule, mainWorker: ehWorker } } : {}),
};

let opening: Promise<DuckContext> | null = null;
let chain: Promise<unknown> = Promise.resolve();

function boot(): Promise<DuckContext> {
  if (typeof Worker === "undefined") {
    return Promise.reject(new Error("Large dataset processing runs in the browser."));
  }
  return (async () => {
    const bundle = await duckdb.selectBundle(BUNDLES);
    if (!bundle.mainWorker || !bundle.mainModule) throw new Error("The analysis engine could not be loaded.");
    const worker = new Worker(bundle.mainWorker);
    const db = new duckdb.AsyncDuckDB(new duckdb.VoidLogger(), worker);
    await db.instantiate(bundle.mainModule, bundle.pthreadWorker);
    const conn = await db.connect();
    // One thread and no insertion-order copy. The browser heap stops near 3.1 GiB,
    // and there is no disk folder to spill into.
    try {
      await conn.query("SET threads=1");
      await conn.query("SET preserve_insertion_order=false");
    } catch {
      // Older builds ignore these settings. The load still runs.
    }
    return { db, conn };
  })();
}

// An out-of-memory query leaves the worker unusable. Drop it so the next
// request can prepare a smaller working file.
export async function resetDb(): Promise<void> {
  const pending = opening;
  opening = null;
  chain = Promise.resolve();
  if (!pending) return;
  try {
    const ctx = await pending;
    await ctx.conn.close();
    await ctx.db.terminate();
  } catch {
    // The worker is already gone after an out-of-memory failure.
  }
}

export function withDb<T>(task: (ctx: DuckContext) => Promise<T>): Promise<T> {
  const run = chain.then(async () => {
    if (!opening) {
      opening = boot().catch((error) => {
        opening = null;
        throw error;
      });
    }
    const ctx = await opening;
    return task(ctx);
  });
  chain = run.then(
    () => undefined,
    () => undefined,
  );
  return run;
}

export const FILE_READER = duckdb.DuckDBDataProtocol.BROWSER_FILEREADER;
