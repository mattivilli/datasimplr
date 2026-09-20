type Pyodide = {
  loadPackage: (names: string[]) => Promise<void>;
  FS: {
    writeFile: (path: string, data: string) => void;
    mkdir: (path: string) => void;
    chdir: (path: string) => void;
    analyzePath: (path: string) => { exists: boolean };
  };
  runPythonAsync: (code: string) => Promise<unknown>;
};

function basename(name?: string | null) {
  const raw = (name ?? "data.csv").replace(/\\/g, "/").split("/").pop()?.trim() || "data.csv";
  return raw.replace(/[\0<>:"|?*]/g, "_");
}

declare global {
  interface Window {
    loadPyodide?: (opts: { indexURL: string }) => Promise<Pyodide>;
  }
}

const INDEX = "https://cdn.jsdelivr.net/pyodide/v0.26.4/full/";
let pyodidePromise: Promise<Pyodide> | null = null;

export const BLOCKED_LIBS: { re: RegExp; label: string; hint: string }[] = [
  { re: /\b(tensorflow|keras|tf\.)\b/i, label: "TensorFlow / Keras", hint: "Deep learning is not in this browser sandbox. Use DataSimplr regression or clustering instead." },
  { re: /\b(torch|pytorch)\b/i, label: "PyTorch", hint: "PyTorch cannot run here. Stick to pandas + matplotlib, or the PCA panel." },
  { re: /\b(sklearn|scikit-learn)\b/i, label: "scikit-learn", hint: "sklearn is not loaded. Use DataSimplr Clustering and PCA tools — they already run k-means and PCA." },
  { re: /\b(plotly|bokeh|altair)\b/i, label: "Interactive viz libs", hint: "Only matplotlib figures render in Preview. Use plt.bar / plt.scatter / df.plot." },
  { re: /\b(requests|httpx|urllib)\b/i, label: "Network calls", hint: "This lab has no internet. The uploaded file is already in df." },
  { re: /\b(psycopg|sqlalchemy|sqlite3)\b/i, label: "Databases", hint: "Load data with the Upload panel, then chart df." },
];

export function findBlocked(code: string) {
  return BLOCKED_LIBS.filter((b) => b.re.test(code));
}

async function loadScript() {
  if (window.loadPyodide) return;
  await new Promise<void>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = `${INDEX}pyodide.js`;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Could not load the Python runtime from the CDN."));
    document.head.appendChild(s);
  });
}

export async function getPyodide(): Promise<Pyodide> {
  if (!pyodidePromise) {
    pyodidePromise = (async () => {
      await loadScript();
      const py = await window.loadPyodide!({ indexURL: INDEX });
      await py.loadPackage(["pandas", "numpy", "matplotlib"]);
      await py.runPythonAsync(`
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
`);
      return py;
    })();
  }
  return pyodidePromise;
}

export type PyRunResult = {
  ok: boolean;
  stdout: string;
  images: string[];
  error?: string;
};

export async function runPython(code: string, csv?: string, fileName?: string | null): Promise<PyRunResult> {
  const blocked = findBlocked(code);
  if (blocked.length) {
    return {
      ok: false,
      stdout: "",
      images: [],
      error: blocked.map((b) => `${b.label}: ${b.hint}`).join("\n"),
    };
  }

  const py = await getPyodide();
  const payload = csv?.trim() ? csv : "value\n1\n2\n3";
  const original = basename(fileName);
  const stemCsv = original.replace(/\.(xlsx|xls|json|tsv|txt)$/i, ".csv");
  const work = "/work";
  try {
    if (!py.FS.analyzePath(work).exists) py.FS.mkdir(work);
  } catch {
    try {
      py.FS.mkdir(work);
    } catch {
      /* exists */
    }
  }
  py.FS.chdir(work);
  for (const path of [`${work}/data.csv`, `${work}/${original}`, `${work}/${stemCsv}`, `/tmp/data.csv`, `/${original}`]) {
    try {
      py.FS.writeFile(path, payload);
    } catch {
      /* skip illegal alias */
    }
  }
  py.FS.writeFile("/tmp/user.py", code);

  const result = await py.runPythonAsync(`
import io, sys, traceback, base64, contextlib, os
from pathlib import Path
import pandas as pd
import matplotlib.pyplot as plt

plt.close("all")
os.chdir("/work")
DATA_PATH = "/work/data.csv"
_ORIG = ${JSON.stringify(original)}
try:
    df = pd.read_csv(DATA_PATH)
except Exception:
    df = pd.DataFrame()

_real_csv = pd.read_csv
_real_table = getattr(pd, "read_table", _real_csv)
_real_excel = getattr(pd, "read_excel", None)
_real_json = getattr(pd, "read_json", None)

def _resolve(path):
    p = str(path)
    if os.path.exists(p):
        return p
    name = os.path.basename(p)
    for cand in (p, f"/work/{name}", f"/work/{Path(name).stem}.csv", "/work/data.csv", f"/{name}", DATA_PATH):
        if os.path.exists(cand):
            return cand
    return DATA_PATH

def _read_csv(path, *args, **kwargs):
    return _real_csv(_resolve(path), *args, **kwargs)

def _read_table(path, *args, **kwargs):
    return _real_table(_resolve(path), *args, **kwargs)

def _read_excel(path, *args, **kwargs):
    return _real_csv(_resolve(path))

def _read_json(path, *args, **kwargs):
    try:
        return _real_json(_resolve(path), *args, **kwargs) if _real_json else _real_csv(DATA_PATH)
    except Exception:
        return _real_csv(DATA_PATH)

pd.read_csv = _read_csv
pd.read_table = _read_table
pd.read_excel = _read_excel
if _real_json:
    pd.read_json = _read_json

_buf = io.StringIO()
_err = None
_ns = {"df": df, "pd": pd, "plt": plt, "DATA_PATH": DATA_PATH, "os": os, "__name__": "__main__"}
with contextlib.redirect_stdout(_buf), contextlib.redirect_stderr(_buf):
    print("Loaded", _ORIG, "→", DATA_PATH, "shape", df.shape)
    try:
        exec(Path("/tmp/user.py").read_text(), _ns)
    except Exception:
        _err = traceback.format_exc()
        print(_err)

_images = []
for _n in plt.get_fignums():
    _bio = io.BytesIO()
    plt.figure(_n).savefig(_bio, format="png", bbox_inches="tight", dpi=120, facecolor="white")
    _images.append(base64.b64encode(_bio.getvalue()).decode("ascii"))
plt.close("all")

import json
__ds_json = json.dumps({"stdout": _buf.getvalue(), "images": _images, "error": _err})
__ds_json
`);

  const raw = typeof result === "string" ? result : String(result ?? "{}");
  const out = JSON.parse(raw) as { stdout: string; images: string[]; error: string | null };
  return {
    ok: !out.error,
    stdout: out.stdout ?? "",
    images: out.images ?? [],
    error: out.error ?? undefined,
  };
}

export function starterPython(fileName?: string | null, columns?: string[]) {
  const x = columns?.[0] ?? "col_a";
  const y = columns?.[1] ?? columns?.[0] ?? "col_b";
  const shown = fileName ?? "uploaded.csv";
  return `# Uploaded file is already loaded as df
# Server/sandbox path: DATA_PATH  (/work/data.csv)
# These also work:
#   pd.read_csv(${JSON.stringify(shown)})
#   pd.read_csv("data.csv")
# Available: pandas, numpy, matplotlib (plt)

numeric = df.select_dtypes(include="number")
print("shape", df.shape)
print(df.head())

fig, ax = plt.subplots(figsize=(7, 4))
if numeric.shape[1] >= 2:
    ax.scatter(numeric.iloc[:, 0], numeric.iloc[:, 1], alpha=0.7)
    ax.set_xlabel(${JSON.stringify(x)})
    ax.set_ylabel(${JSON.stringify(y)})
    ax.set_title("Scatter from uploaded data")
elif numeric.shape[1] == 1:
    numeric.iloc[:, 0].plot(kind="hist", ax=ax, bins=12)
    ax.set_title("Distribution")
else:
    df.iloc[:, 0].value_counts().head(8).plot(kind="bar", ax=ax)
    ax.set_title("Top categories")
fig.tight_layout()
`;
}

export function nextSteps(ok: boolean, blocked: boolean): string[] {
  if (blocked) {
    return [
      "Keep the snippet to pandas + matplotlib — those are the libraries this lab runs.",
      "Use DataSimplr Clustering or PCA instead of scikit-learn.",
      "Chart the uploaded df (it is already loaded). Do not fetch or open other files.",
      "Ask AI Chat to rewrite the snippet for this sandbox.",
    ];
  }
  if (ok) {
    return [
      "Try a bar chart of a category column, or a histogram of a numeric field.",
      "Open Correlation in Upload & Analyze to confirm the relationship you just plotted.",
      "Ask AI Chat to interpret this chart in plain language.",
      "Save the analysis from Upload & Analyze if you want it in Past Analyses.",
    ];
  }
  return [
    "If you see FileNotFoundError, use df or pd.read_csv(DATA_PATH) — the upload is in /work, not your laptop.",
    "Drop tensorflow / sklearn / network calls; this lab is pandas + matplotlib only.",
    "Fall back to the built-in Regression, Clustering or PCA panels — no code required.",
    "Paste the error into AI Chat and ask for a matplotlib version of the same idea.",
  ];
}
