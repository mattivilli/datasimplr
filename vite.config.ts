// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

// The app always runs at basepath "/" — a non-root basepath here triggers a TanStack
// Start dev-mode bug (breaks all page routing under `vite dev`). Reverse-proxying it
// under a sub-path (e.g. XAMPP at localhost/datasimplr/) doesn't work around this
// either: the server-rendered page loads, but client-side hydration reads the
// browser's real URL (which still has the proxy's prefix) and crashes trying to
// match a route the root-basepath router doesn't know about. Run `npm run dev` and
// open http://localhost:8080/ directly — no reverse proxy in front of it.
export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
});
