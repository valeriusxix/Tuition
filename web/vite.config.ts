import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// Static site: all data comes from public/data/*.json written by the engine's export step.
export default defineConfig({
  plugins: [react(), tailwindcss()],
});
