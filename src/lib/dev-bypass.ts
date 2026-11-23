// Local-development login bypass. Every check is tied to Vite's build-time
// `import.meta.env.DEV`, which is statically false in a production build, so a
// localStorage flag or request header can never switch it on in production.

const FLAG = "ds_dev_bypass";

export const DEV_BYPASS_AVAILABLE: boolean = import.meta.env.DEV === true;

export function isDevBypass(): boolean {
  if (!DEV_BYPASS_AVAILABLE || typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(FLAG) === "1";
  } catch {
    return false;
  }
}

export function enableDevBypass(): void {
  if (!DEV_BYPASS_AVAILABLE || typeof window === "undefined") return;
  try {
    window.localStorage.setItem(FLAG, "1");
  } catch {
    /* storage unavailable */
  }
}

export function clearDevBypass(): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(FLAG);
  } catch {
    /* storage unavailable */
  }
}
