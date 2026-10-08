import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// VITE_FITTINGROOM is defined explicitly, with a default of "0", so the muslin
// check in src/api/client.ts folds to `false` in a production build and Rollup
// drops the dynamic import, the fixtures and @fitting-room/adapter-msw entirely.
export default defineConfig(() => {
  // Read inside the function so a test can toggle the flag between calls.
  const muslin = process.env.VITE_FITTINGROOM === "1";
  return {
    plugins: [react()],
    define: {
      "import.meta.env.VITE_FITTINGROOM": JSON.stringify(process.env.VITE_FITTINGROOM ?? "0"),
    },
    build: {
      // The muslin never overwrites the production dist/.
      ...(muslin ? { outDir: "dist-muslin" } : {}),
      rollupOptions: {
        output: {
          // Name the panel's chunk so the bundle tests can prove it is present in
          // the muslin build and absent from production. Every other chunk keeps
          // Vite's default name. The panel resolves from workspace source in the
          // monorepo and from node_modules/@fitting-room/panel in the export.
          chunkFileNames: (chunk: { facadeModuleId: string | null }) =>
            /[\\/](?:packages|@fitting-room)[\\/]panel[\\/]/.test(chunk.facadeModuleId ?? "")
              ? "assets/fittingroom-panel-[hash].js"
              : "assets/[name]-[hash].js",
        },
      },
    },
  };
});
