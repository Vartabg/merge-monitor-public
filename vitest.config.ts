import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  test: {
    include: ["tests/**/*.test.{mjs,ts,tsx}"],
    testTimeout: 15_000,
    restoreMocks: true,
  },
});
