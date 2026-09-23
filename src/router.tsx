import { QueryClient } from "@tanstack/react-query";
import { createRouter } from "@tanstack/react-router";
import { routeTree } from "./routeTree.gen";

export const getRouter = () => {
  const queryClient = new QueryClient();

  const router = createRouter({
    routeTree,
    context: { queryClient },
    // Always root — see vite.config.ts for why.
    scrollRestoration: true,
    defaultPreloadStaleTime: 0,
  });

  return router;
};
