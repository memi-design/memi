import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      "src/security/__tests__/**/*.test.ts",
      "src/commands/__tests__/execution-policy.test.ts",
      "src/commands/__tests__/trust-core-*.test.ts",
      "src/release/__tests__/trust-core-*.test.ts",
    ],
    exclude: ["**/node_modules/**", "**/dist/**", "**/fixtures/**"],
    testTimeout: 30_000,
    coverage: {
      provider: "v8",
      // Vitest 4 includes every file matching `include`, including modules not
      // imported by a test. This is the supported equivalent of legacy
      // `all: true` coverage collection.
      include: [
        "src/security/execution-policy.ts",
        "src/security/metadata-receipt.ts",
        "src/security/command-preflight.ts",
        "scripts/lib/trust-core-e2e.mjs",
      ],
      exclude: [
        "**/__tests__/**",
        "**/*.d.ts",
        "**/fixtures/**",
        "**/generated/**",
      ],
      reporter: ["text", "json-summary", "lcov"],
      reportsDirectory: "coverage/trust-core",
      thresholds: {
        lines: 80,
        branches: 80,
        functions: 80,
        statements: 80,
      },
    },
  },
});
