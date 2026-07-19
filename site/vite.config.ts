import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Served from https://godiao.github.io/codingverse/ on GitHub Pages,
// so assets must resolve under the /codingverse/ base path.
export default defineConfig({
  base: "/codingverse/",
  plugins: [react(), tailwindcss()],
});
