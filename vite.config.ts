/// <reference types="vitest/config" />
import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

import { devApi } from "./dev/api-plugin";

export default defineConfig({
  // devApi runs the functions in api/ during `npm run dev`; it applies to the
  // dev server only and contributes nothing to the build.
  plugins: [react(), tailwindcss(), devApi()],
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
  // The parts worth pinning down are the write queue and the shapes crossing
  // the wire — everything else is a form. No browser needed for either.
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});
