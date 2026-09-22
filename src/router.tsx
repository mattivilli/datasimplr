import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
  const queryClient = new QueryClient();

  const router = createRouter({
    routeTree,
    context: { queryClient },
    // Local dev sits behind the XAMPP Apache proxy at /datasimplr/ (see vite.config.ts).
    // Production serves from root on its own dedicated domain.
    basepath: import.meta.env.DEV ? "/datasimplr" : "/",
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
  });

  return router;
};
