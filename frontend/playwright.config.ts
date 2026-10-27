import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end smoke for the money path.
 *
 * The suite runs against a real production build (`next start`), a mocked EIP-1193 wallet and a
 * mocked Base RPC — so it exercises the actual React tree, the wallet hook, the three-stage progress
 * rail and the button states, without a funded key and without depending on chain latency.
 *
 * That combination is what would have caught the two regressions that reached production: a YES/NO
 * button rendering without its multiplier, and a submit button that silently disabled itself when
 * the wallet held no USDC.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 90_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://127.0.0.1:3100",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    viewport: { width: 1280, height: 900 },
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        command: "PORT=3100 bun run start",
        url: "http://127.0.0.1:3100",
        reuseExistingServer: true,
        timeout: 120_000,
      },
});
