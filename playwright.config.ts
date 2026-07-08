import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:3873",
    trace: "on-first-retry",
  },
  webServer: {
    command: "COREPACK_HOME=/tmp/corepack corepack pnpm dev --hostname 127.0.0.1 --port 3873",
    url: "http://127.0.0.1:3873",
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "mobile",
      use: { ...devices["Pixel 7"] },
    },
  ],
});
