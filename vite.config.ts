import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Relative base so the build works from a GitHub Pages project subpath,
  // a Netlify root, or a local file preview without reconfiguration.
  base: "./",
});
