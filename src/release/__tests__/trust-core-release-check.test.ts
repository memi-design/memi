import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

describe("Trust Core candidate release-check policy", () => {
  it("reports the beta candidate honestly without blocking on its named stale-evidence limitation", () => {
    const result = spawnSync(process.execPath, [join(process.cwd(), "scripts", "check-release.mjs")], {
      cwd: process.cwd(),
      encoding: "utf8",
      env: {
        ...process.env,
        SKIP_PACK_GATE: "1",
      },
    });
    const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;

    expect(output).not.toContain(
      "CHANGELOG.md starts at v2.7.9 but package.json is 2.8.0-beta.1",
    );
    expect(output).not.toContain(
      "audit scorecard gate failed: Evidence is stale at release time: reviewed-candidate-audit, swiftui-rendered-rerun",
    );
    expect(output).toContain(
      "TRUST_CORE_BETA_PENDING_DESIGNWORKBENCH_EVIDENCE: reviewed-candidate-audit and swiftui-rendered-rerun must be refreshed before stable",
    );
  });
});
