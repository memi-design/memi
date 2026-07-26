import type { Command } from "commander";
import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import { extname, resolve } from "node:path";

import type { MemoireEngine } from "../engine/core.js";
import type { ComponentSpec } from "../specs/types.js";
import { exportShadcnRegistry, doctorShadcnRegistryOutput } from "../shadcn/exporter.js";
import { getMemoirePackageVersion } from "../utils/package-version.js";

export const SHADCN_SERVER_HOST = "127.0.0.1";

export function registerShadcnCommand(program: Command, engine: MemoireEngine): void {
  const shadcn = program
    .command("shadcn")
    .description("Export, serve, and validate shadcn-native registry files")
    .addHelpText("after", [
      "",
      "Examples:",
      "  memi shadcn export --out public/r",
      "  memi shadcn doctor --out public/r --json",
      "  memi shadcn serve --out public/r --port 4014",
    ].join("\n"));

  shadcn
    .command("export")
    .description("Generate shadcn registry.json and /r/*.json item files from the current workspace")
    .option("--out <dir>", "Output directory for registry.json and item JSON", "public/r")
    .option("--name <name>", "Registry name", "memoire")
    .option("--homepage <url>", "Registry homepage URL")
    .option("--json", "Output stable JSON")
    .action(async (opts: { out: string; name: string; homepage?: string; json?: boolean }) => {
      await engine.init("registry");
      const specs = (await engine.registry.getAllSpecs()).filter((spec): spec is ComponentSpec => spec.type === "component");
      const outDir = resolve(engine.config.projectRoot, opts.out);
      const result = await exportShadcnRegistry({
        outDir,
        name: opts.name,
        homepage: opts.homepage,
        designSystem: engine.registry.designSystem,
        specs,
        memoireVersion: getMemoirePackageVersion(),
      });

      const payload = {
        status: "exported",
        outDir: result.outDir,
        registryPath: result.registryPath,
        itemCount: result.registry.items.length,
        itemRoutes: result.itemRoutes,
        filesWritten: result.filesWritten,
      };

      if (opts.json) {
        console.log(JSON.stringify(payload, null, 2));
        return;
      }

      console.log();
      console.log(`  Shadcn registry exported to ${result.outDir}`);
      console.log(`  registry.json: ${result.registryPath}`);
      console.log(`  items: ${result.registry.items.length}`);
      console.log();
    });

  shadcn
    .command("doctor")
    .description("Validate generated shadcn registry.json and item files")
    .option("--out <dir>", "Output directory containing registry.json and item JSON", "public/r")
    .option("--json", "Output stable JSON")
    .action(async (opts: { out: string; json?: boolean }) => {
      const outDir = resolve(engine.config.projectRoot, opts.out);
      const result = await doctorShadcnRegistryOutput(outDir);

      if (opts.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        printDoctorResult(result);
      }

      if (result.status === "failed") process.exitCode = 1;
    });

  shadcn
    .command("serve")
    .description("Serve generated shadcn registry files for shadcn, v0, and AI editors")
    .option("--out <dir>", "Output directory containing registry.json and item JSON", "public/r")
    .option("--port <port>", "Port to serve on", "4014")
    .action(async (opts: { out: string; port: string }) => {
      const outDir = resolve(engine.config.projectRoot, opts.out);
      const port = Number.parseInt(opts.port, 10);
      const doctor = await doctorShadcnRegistryOutput(outDir);
      if (doctor.status === "failed") {
        printDoctorResult(doctor);
        process.exitCode = 1;
        return;
      }

      const server = createServer(async (request, response) => {
        const requestPath = new URL(request.url ?? "/", `http://localhost:${port}`).pathname;
        const relativePath = requestPath === "/" ? "registry.json" : requestPath.replace(/^\/r\//, "").replace(/^\//, "");
        const filePath = resolve(outDir, relativePath);
        if (!filePath.startsWith(outDir)) {
          response.writeHead(403);
          response.end("Forbidden");
          return;
        }

        try {
          await stat(filePath);
          const body = await readFile(filePath);
          response.writeHead(200, { "content-type": contentType(filePath) });
          response.end(body);
        } catch {
          response.writeHead(404, { "content-type": "text/plain" });
          response.end("Not found");
        }
      });

      server.listen(port, SHADCN_SERVER_HOST, () => {
        console.log();
        console.log(`  Serving shadcn registry from ${outDir}`);
        console.log(`  Registry: http://localhost:${port}/registry.json`);
        console.log(`  Items:    http://localhost:${port}/r/{item}.json`);
        console.log();
      });
    });
}

function printDoctorResult(result: Awaited<ReturnType<typeof doctorShadcnRegistryOutput>>): void {
  console.log();
  console.log(`  Shadcn doctor: ${result.outDir}`);
  for (const check of result.checks) {
    const marker = check.status === "passed" ? "+" : "x";
    console.log(`  ${marker} ${check.name}${check.message ? ` - ${check.message}` : ""}`);
  }
  console.log();
  console.log(`  Result: ${result.status}`);
  console.log();
}

function contentType(path: string): string {
  if (extname(path) === ".json") return "application/json; charset=utf-8";
  if (extname(path) === ".css") return "text/css; charset=utf-8";
  return "text/plain; charset=utf-8";
}
