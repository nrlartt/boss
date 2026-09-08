import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    env: {
      BOSS_DATA_DIR: "./var-test",
      BOSS_HMAC_SECRET: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      BOSS_ALLOW_OFFLINE: "1",
    },
  },
});
