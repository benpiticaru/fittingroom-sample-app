import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(() => {
  return {
    plugins: [react()],
    build: {
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
