// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

// The app always runs at basepath "/" — in local dev, XAMPP's Apache reverse proxy
// (datasimplr-proxy.conf) strips the /datasimplr prefix before forwarding to this
// dev server, so the app never needs to know about it. This avoids TanStack Start's
// dev-basepath-alignment edge cases entirely (a non-root basepath here previously
// broke all page routing under `vite dev`, independent of how it was configured).
export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
});
