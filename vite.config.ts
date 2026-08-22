/// <reference types="vitest/config" />
import path from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
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
