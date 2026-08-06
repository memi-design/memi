import { defineConfig, mergeConfig } from "vitest/config";
import baseConfig from "./vitest.config.js";

const reliabilityCore = [
  "src/agents/intent-classifier.ts",
  "src/agents/execution-context-capsule.ts",
  "src/frontend/{task-contract,context-capsule,repository-design-index}.ts",
  "src/frontend/receipts/{workflow-receipt-v3,chronological-replay}.ts",
  "src/frontend/verification/{native-verification-contract,expo-native-verification,swiftui-native-verification,receipt-evidence}.ts",
  "src/efficiency/frontend-verification/{web-contract,web-adapter}.ts",
  "src/commands/{compose-receipt,workflow-receipt-verify}.ts",
  "src/utils/package-artifact.ts",
];

export default mergeConfig(baseConfig, defineConfig({
  test: {
    coverage: {
      provider: "v8",
      include: reliabilityCore,
      reporter: ["text-summary"],
      thresholds: {
        statements: 80,
        branches: 80,
        functions: 80,
        lines: 80,
      },
    },
  },
}));
