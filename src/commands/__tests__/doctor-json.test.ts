import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Command } from "commander";
import { mkdir, rm } from "fs/promises";
import { tmpdir } from "os";
import { join } from "path";
import { registerDoctorCommand } from "../doctor.js";
import { captureLogs, lastLog, writePluginBundle } from "./test-helpers.js";

const { accessMock, readdirMock } = vi.hoisted(() => ({
  accessMock: vi.fn(async (path: unknown) => {
    const value = String(path);
    if (value.includes(".memoire")) {
      throw new Error("missing workspace");
    }
  }),
  readdirMock: vi.fn(async () => ["index.html", "notes.md"]),
}));

vi.mock("fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs/promises")>();
  return {
    ...actual,
    access: accessMock,
    readdir: readdirMock,
    constants: {
      R_OK: 4,
      W_OK: 2,
    },
  };
});

afterEach(() => {
  vi.restoreAllMocks();
  process.exitCode = 0;
});

beforeEach(() => {
  accessMock.mockClear();
  readdirMock.mockClear();
});

let projectRoot = "";
let originalHome: string | undefined;

beforeEach(async () => {
  projectRoot = join(tmpdir(), `memoire-doctor-json-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  await mkdir(join(projectRoot, "plugin"), { recursive: true });
  await writePluginBundle(join(projectRoot, "plugin"));
  originalHome = process.env.HOME;
  process.env.HOME = join(projectRoot, "fake-home");
});

afterEach(async () => {
  if (originalHome === undefined) {
    delete process.env.HOME;
  } else {
    process.env.HOME = originalHome;
  }
  await rm(projectRoot, { recursive: true, force: true });
});

describe("doctor --json", () => {
  it("emits structured check results and summary counts", async () => {
    const logs = captureLogs();
    const engine = makeDoctorEngine();
    const program = new Command();

    registerDoctorCommand(program, engine as never);
    await program.parseAsync(["doctor", "--json"], { from: "user" });

    const payload = JSON.parse(lastLog(logs));
    const checks = getChecks(payload);
    const summary = getSummary(payload, checks);

    expect(checks).toHaveLength(17);
    expect(summary).toMatchObject({
      fail: 1,
      total: 17,
    });
    expect(statusMap(checks)).toEqual({
      "Project detected": "pass",
      "Design system": "pass",
      Specs: "warn",
      "Token coverage": "pass",
      "Plugin bundle": "pass",
      "Plugin install": "warn",
      "Widget V2 metadata": "pass",
      "Figma bridge": "warn",
      Preview: "pass",
      Node: "pass",
      Dependencies: "pass",
      ".env.local": expect.stringMatching(/^(pass|warn)$/),
      "REST credentials": "warn",
      Workspace: "fail",
      // Team gate: bare test repo has no committed policy/baseline/managed block
      Policy: "warn",
      Baseline: "warn",
      Gitignore: "warn",
    });
    expect(detailMap(checks).get("Specs")).toContain("missing shadcnBase");
  });

  it("keeps the JSON payload stable for mixed pass and warning checks", async () => {
    const logs = captureLogs();
    const engine = makeDoctorEngine();
    const program = new Command();

    registerDoctorCommand(program, engine as never);
    await program.parseAsync(["doctor", "--json"], { from: "user" });

    const payload = JSON.parse(lastLog(logs));
    const checks = getChecks(payload);

    expect(checks.every((check: { label: string; status: string; detail: string }) =>
      typeof check.label === "string" &&
      typeof check.status === "string" &&
      typeof check.detail === "string"
    )).toBe(true);
    expect(checks.every((check: { code?: string; category?: string }) =>
      typeof check.code === "string" &&
      typeof check.category === "string"
    )).toBe(true);
    expect(getSummary(payload, checks).total).toBe(checks.length);
  });

  it("reports a metadata-only locked policy receipt without mutating the workspace", async () => {
    const logs = captureLogs();
    const engine = makeDoctorEngine();
    const init = vi.spyOn(engine, "init");
    const registryLoad = vi.spyOn(engine.registry, "load");
    const program = new Command();

    registerDoctorCommand(program, engine as never);
    await program.parseAsync(["doctor", "--json"], { from: "user" });

    const payload = JSON.parse(lastLog(logs));
    expect(init).not.toHaveBeenCalled();
    expect(registryLoad).not.toHaveBeenCalled();
    expect(payload.policy).toMatchObject({
      profile: "locked",
      requestedCapabilities: [],
      effectiveCapabilities: [],
      dataLocations: { project: ".memi/", home: "~/.memoire/" },
      offlineInternalUse: {
        suitable: true,
        requiresEmployerApproval: true,
      },
    });
    expect(payload.optionalIntegrations).toEqual(expect.objectContaining({
      anthropic: expect.any(Boolean),
      canvas: expect.any(Boolean),
      playwright: expect.any(Boolean),
    }));
    expect(payload.receipt).toMatchObject({
      schemaVersion: "memi.receipt.v1",
      command: "doctor",
      policy: { profile: "locked", effectiveCapabilities: [] },
    });
    const serialized = JSON.stringify(payload.receipt);
    expect(serialized).not.toContain(projectRoot);
    expect(serialized).not.toContain(process.env.HOME);
  });
});

function makeDoctorEngine() {
  return {
    async init() {},
    config: {
      projectRoot,
    },
    project: {
      framework: "vite",
      styling: { tailwind: true },
    },
    registry: {
      designSystem: {
        tokens: [
          { name: "color/primary", type: "color", values: { value: "#111111" } },
          { name: "spacing/4", type: "spacing", values: { value: 16 } },
          { name: "typography/body", type: "typography", values: { value: "16px" } },
          { name: "radius/md", type: "radius", values: { value: 8 } },
        ],
        components: [],
        styles: [],
        lastSync: "2026-03-27T10:00:00.000Z",
      },
      async load() {},
      async getAllSpecs() {
        return [
          {
            type: "component",
            name: "Button",
            purpose: "Primary action button",
            shadcnBase: ["Button"],
          },
          {
            type: "page",
            name: "Dashboard",
            purpose: "Main dashboard",
          },
          {
            type: "component",
            name: "Card",
            purpose: "Card component",
            shadcnBase: [],
          },
        ];
      },
    },
    figma: {
      isConnected: false,
      getStatus() {
        return {
          running: false,
          port: 0,
          clients: [],
        };
      },
    },
  };
}

function getChecks(payload: { checks?: unknown; results?: unknown }): Array<{ label: string; status: string; detail: string }> {
  const checks = payload.checks ?? payload.results;
  if (!Array.isArray(checks)) {
    throw new Error("Expected a checks/results array in doctor JSON payload");
  }
  return checks as Array<{ label: string; status: string; detail: string }>;
}

function getSummary(payload: { summary?: Record<string, number>; counts?: Record<string, number>; totals?: Record<string, number> }, checks?: Array<unknown>) {
  const summary = payload.summary ?? payload.counts ?? payload.totals;
  if (summary && typeof summary === "object") {
    return {
      pass: summary.pass ?? summary.passed ?? 0,
      warn: summary.warn ?? summary.warnings ?? 0,
      fail: summary.fail ?? summary.failed ?? 0,
      total: summary.total ?? (checks?.length ?? 0),
    };
  }

  return {
    pass: 0,
    warn: 0,
    fail: 0,
    total: checks?.length ?? 0,
  };
}

function statusMap(checks: Array<{ label: string; status: string }>): Record<string, string> {
  return Object.fromEntries(checks.map((check) => [check.label, check.status]));
}

function detailMap(checks: Array<{ label: string; detail: string }>): Map<string, string> {
  return new Map(checks.map((check) => [check.label, check.detail]));
}
