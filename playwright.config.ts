import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  fullyParallel: true,
  // Physics-heavy desktop and mobile scenes contend when both projects run in
  // parallel, producing timing-dependent failures in the canonical aggregate
  // gate. Keep the standard command deterministic; focused commands remain
  // available for fast iteration.
  workers: 1,
  reporter: "list",
  use: {
    baseURL: "http://127.0.0.1:3873",
    trace: "on-first-retry",
  },
  webServer: {
    command: "NEXT_PUBLIC_GAMEPLAY_TELEMETRY_ENABLED=false NEXT_PUBLIC_TEST_WITHOUT_ENCLOSURE=1 COREPACK_HOME=/tmp/corepack corepack pnpm dev --hostname 127.0.0.1 --port 3873",
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
      // Only browser specs with distinct touch or narrow-viewport behavior run
      // twice; logic, API, and database specs run once on desktop.
      name: "mobile",
      testMatch: [
        "course-editor.spec.ts",
        "home.spec.ts",
        "kart-editor.spec.ts",
        "profile.spec.ts",
      ],
      use: { ...devices["Pixel 7"] },
    },
  ],
});
