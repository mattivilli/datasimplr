type Pyodide = {
  loadPackage: (names: string[]) => Promise<void>;
  FS: { writeFile: (path: string, data: string) => void };
  runPythonAsync: (code: string) => Promise<unknown>;
};

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

export async function runPython(code: string, csv?: string): Promise<PyRunResult> {
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
  py.FS.writeFile("/tmp/data.csv", csv?.trim() ? csv : "value\n1\n2\n3");
  py.FS.writeFile("/tmp/user.py", code);

  const result = await py.runPythonAsync(`
import io, sys, traceback, base64, contextlib
from pathlib import Path
import pandas as pd
import matplotlib.pyplot as plt

plt.close("all")
try:
    df = pd.read_csv("/tmp/data.csv")
except Exception:
    df = pd.DataFrame()

_buf = io.StringIO()
_err = None
with contextlib.redirect_stdout(_buf), contextlib.redirect_stderr(_buf):
    try:
        exec(Path("/tmp/user.py").read_text(), {"df": df, "pd": pd, "plt": plt, "__name__": "__main__"})
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
  return `# df is the uploaded file (${fileName ?? "sample data"}) as a pandas DataFrame
# Available in this lab: pandas, numpy, matplotlib (plt)

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
    "Read the traceback — a missing column name is the usual cause. print(df.columns) first.",
    "Drop tensorflow / sklearn / network calls; this lab is pandas + matplotlib only.",
    "Fall back to the built-in Regression, Clustering or PCA panels — no code required.",
    "Paste the error into AI Chat and ask for a matplotlib version of the same idea.",
  ];
}
