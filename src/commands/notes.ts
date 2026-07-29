/**
 * Notes CLI — Manage Mémoire Notes (downloadable skill packs).
 *
 * Commands:
 *   memi notes install <source>   Install from local path or GitHub
 *   memi notes list                Show all installed notes
 *   memi notes remove <name>       Uninstall a note
 *   memi notes create <name>       Scaffold a new note
 *   memi notes info <name>         Show note details
 */

import type { Command } from "commander";
import { join } from "path";
import type { MemoireEngine } from "../engine/core.js";
import {
  DEFAULT_NOTES_CATALOG_URL,
  findCatalogNote,
  installNote,
  loadNotesCatalog,
  routeInstalledSkills,
  searchCatalogSkills,
  removeNote,
  scaffoldNote,
  getNoteInfo,
  buildRepositoryFingerprint,
  type NoteCategory,
} from "../notes/index.js";
import { validateCommunityNoteDir } from "../notes/community.js";
import type { InstalledNote, NoteManifest } from "../notes/index.js";
import { ui } from "../tui/format.js";

type NoteMutationAction = "install" | "create" | "remove" | "update";
type NoteMutationStatus = "completed" | "failed";

interface NoteMutationPayload {
  action: NoteMutationAction;
  status: NoteMutationStatus;
  options: {
    json: boolean;
  };
  source?: string;
  name?: string;
  category?: NoteCategory;
  installedPath?: string | null;
  noteDir?: string | null;
  removedPath?: string | null;
  filesCreated?: string[];
  note?: ReturnType<typeof serializeManifest> | null;
  error?: {
    message: string;
  };
}

export function registerNotesCommand(program: Command, engine: MemoireEngine) {
  const notes = program
    .command("notes")
    .description("Manage Memoire Notes — downloadable skill packs");

  // ── install ────────────────────────────────────────────

  notes
    .command("install <source>")
    .description("Install a note (catalog name, local path, or github:user/repo)")
    .option("--catalog <url>", "Remote Notes catalog URL", DEFAULT_NOTES_CATALOG_URL)
    .option("--json", "Output install result as JSON")
    .action(async (source: string, opts: { catalog?: string; json?: boolean }) => {
      const root = engine.config.projectRoot;
      const json = Boolean(opts.json);
      if (!json) {
        console.log(`\n  Installing note from ${source}...\n`);
      }

      try {
        const manifest = await installNote(source, root, { catalogUrl: opts.catalog });
        if (json) {
          const payload: NoteMutationPayload = {
            action: "install",
            status: "completed",
            options: { json: true },
            source,
            installedPath: join(root, ".memoire", "notes", manifest.name),
            note: serializeManifest(manifest),
          };
          console.log(JSON.stringify(payload, null, 2));
          return;
        }
        console.log(`  + ${manifest.name}@${manifest.version}`);
        console.log(`    ${manifest.description}`);
        console.log(`    Category: ${manifest.category}`);
        console.log(`    Skills:   ${manifest.skills.length}`);
        console.log(`\n  Note installed. It will activate automatically during agent execution.\n`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (json) {
          const payload: NoteMutationPayload = {
            action: "install",
            status: "failed",
            options: { json: true },
            source,
            installedPath: null,
            note: null,
            error: { message: msg },
          };
          console.log(JSON.stringify(payload, null, 2));
          process.exitCode = 1;
          return;
        }
        console.log(ui.fail(`Failed to install: ${msg}`));
        process.exitCode = 1;
      }
    });

  // ── list ───────────────────────────────────────────────

  notes
    .command("list")
    .description("Show all installed notes with status")
    .option("--json", "Output notes as JSON")
    .action(async (opts: { json?: boolean }) => {
      if (!engine.notes.loaded) await engine.notes.loadAll();
      const allNotes = engine.notes.notes;

      if (allNotes.length === 0) {
        if (opts.json) {
          console.log(JSON.stringify({ notes: [], summary: emptyNotesSummary() }, null, 2));
          return;
        }
        console.log("\n  No notes installed.\n");
        console.log("  Install one with: memi notes install <source>\n");
        return;
      }

      if (opts.json) {
        console.log(JSON.stringify({
          notes: allNotes.map(serializeInstalledNote),
          summary: buildNotesSummary(allNotes),
        }, null, 2));
        return;
      }

      console.log("\n  ┌─────────────────────────────────────────────┐");
      console.log("  │            Memoire Notes                      │");
      console.log("  └─────────────────────────────────────────────┘\n");

      // Group by category
      const categories = ["craft", "research", "connect", "generate"] as const;
      const categoryLabels: Record<string, string> = {
        craft: "Craft",
        research: "Research",
        connect: "Connect",
        generate: "Generate",
      };

      for (const cat of categories) {
        const catNotes = allNotes.filter((n) => n.manifest.category === cat);
        if (catNotes.length === 0) continue;

        console.log(`  ${categoryLabels[cat]}`);
        for (const note of catNotes) {
          const badge = note.builtIn ? "built-in" : "installed";
          const status = note.enabled ? "active" : "disabled";
          console.log(`    ${note.manifest.name}@${note.manifest.version}  [${badge}] [${status}]`);
          console.log(`      ${note.manifest.description}`);
          for (const skill of note.manifest.skills) {
            const nameCol = skill.name.padEnd(32, " ");
            console.log(`      skill:      ${nameCol}  activateOn: ${skill.activateOn}`);
          }
        }
        console.log();
      }

      const installed = allNotes.filter((n) => !n.builtIn).length;
      const builtIn = allNotes.filter((n) => n.builtIn).length;
      console.log(`  ${builtIn} built-in, ${installed} installed\n`);
    });

  // ── search ─────────────────────────────────────────────

  notes
    .command("search [query]")
    .description("Search the remote Memoire Notes catalog")
    .option("--catalog <url>", "Remote Notes catalog URL", DEFAULT_NOTES_CATALOG_URL)
    .option("--json", "Output search result as JSON")
    .action(async (query: string | undefined, opts: { catalog?: string; json?: boolean }) => {
      try {
        const catalog = await loadNotesCatalog({ catalogUrl: opts.catalog });
        const ranked = query?.trim()
          ? searchCatalogSkills({
            query,
            entries: catalog.notes.map((note) => ({
              id: note.id,
              name: note.name,
              title: note.title,
              description: note.description,
              tags: note.tags,
              intents: note.manifest?.memoire?.routing?.intents
                ?? note.manifest?.skills.flatMap((skill) =>
                  skill.activateOn.split(",").map((value) => value.trim()))
                ?? [],
            })),
          })
          : catalog.notes.map((note) => ({
            id: note.id,
            name: note.name,
            title: note.title,
            description: note.description,
            score: 0,
            matchedTerms: [] as string[],
          }));
        const byId = new Map(catalog.notes.map((note) => [note.id, note]));
        const foundNotes = ranked.flatMap((result) => {
          const note = byId.get(result.id);
          return note ? [{
            name: note.name,
            title: note.title,
            version: note.version,
            description: note.description,
            category: note.category,
            tags: note.tags,
            sourceUrls: note.sourceUrls,
            archiveUrl: note.archive.url,
            score: result.score,
            matchedTerms: result.matchedTerms,
          }] : [];
        });
        if (opts.json) {
          console.log(JSON.stringify({
            status: "completed",
            query: query ?? "",
            catalogUrl: opts.catalog,
            notes: foundNotes,
          }, null, 2));
          return;
        }
        for (const note of foundNotes) {
          const score = query?.trim() ? ` [${note.score}]` : "";
          console.log(`${note.name}@${note.version}${score} — ${note.description}`);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (opts.json) {
          console.log(JSON.stringify({ status: "failed", query: query ?? "", catalogUrl: opts.catalog, error: { message } }, null, 2));
          process.exitCode = 1;
          return;
        }
        console.log(ui.fail(message));
        process.exitCode = 1;
      }
    });

  notes
    .command("route <intent...>")
    .description("Deterministically select a bounded installed skill stack")
    .option("--capabilities <values>", "Comma-separated available capabilities", "")
    .option("--platforms <values>", "Comma-separated repository platforms", "")
    .option("--max-skills <count>", "Maximum stacked skills", "2")
    .option("--max-context-bytes <count>", "Maximum injected skill bytes", "8000")
    .option("--json", "Output routing receipt as JSON")
    .action(async (intentParts: string[], opts: {
      capabilities?: string;
      platforms?: string;
      maxSkills: string;
      maxContextBytes: string;
      json?: boolean;
    }) => {
      if (!engine.notes.loaded) await engine.notes.loadAll();
      const repositoryFingerprint = await buildRepositoryFingerprint(
        engine.config.projectRoot,
      );
      const route = await routeInstalledSkills({
        intent: intentParts.join(" "),
        notes: engine.notes.notes,
        capabilities: csv(opts.capabilities),
        platforms: csv(opts.platforms),
        repositoryFingerprint,
        maximumSkills: positiveInteger(opts.maxSkills, "max-skills"),
        maximumContextBytes: positiveInteger(
          opts.maxContextBytes,
          "max-context-bytes",
        ),
      });
      if (opts.json) {
        console.log(JSON.stringify({ status: "completed", route }, null, 2));
        return;
      }
      if (route.decision === "abstain") {
        console.log("No skill met the deterministic routing threshold.");
        return;
      }
      for (const skill of route.selected) {
        console.log(`${skill.id} [${skill.score}] ${skill.contentHash}`);
      }
    });

  // ── outdated ───────────────────────────────────────────

  notes
    .command("outdated")
    .description("Report Notes that are version-stale or research-stale")
    .option("--catalog <url>", "Remote Notes catalog URL", DEFAULT_NOTES_CATALOG_URL)
    .option("--json", "Output outdated result as JSON")
    .action(async (opts: { catalog?: string; json?: boolean }) => {
      if (!engine.notes.loaded) await engine.notes.loadAll();
      const loadedNotes = engine.notes.notes;
      const catalog = await loadNotesCatalog({ catalogUrl: opts.catalog }).catch(() => null);
      const outdated = loadedNotes.flatMap((note) => {
        const remote = catalog ? findCatalogNote(catalog, note.manifest.name) : null;
        const reasons = outdatedReasons(note.manifest, remote);
        if (reasons.length === 0) return [];
        return [{
          name: note.manifest.name,
          installedVersion: note.manifest.version,
          latestVersion: remote?.version ?? null,
          builtIn: note.builtIn,
          reason: reasons.join("; "),
          lastResearchedAt: note.manifest.lastResearchedAt ?? null,
          freshnessDays: note.manifest.freshnessDays ?? null,
        }];
      });
      if (opts.json) {
        console.log(JSON.stringify({
          status: "completed",
          catalogUrl: opts.catalog,
          checked: loadedNotes.length,
          outdated,
        }, null, 2));
        return;
      }
      if (outdated.length === 0) {
        console.log("All notes are current.");
        return;
      }
      for (const note of outdated) console.log(`${note.name}: ${note.reason}`);
    });

  // ── update ─────────────────────────────────────────────

  notes
    .command("update [name]")
    .description("Update one Note or all Notes from the remote catalog")
    .option("--all", "Update every outdated installed Note")
    .option("--catalog <url>", "Remote Notes catalog URL", DEFAULT_NOTES_CATALOG_URL)
    .option("--json", "Output update result as JSON")
    .action(async (name: string | undefined, opts: { all?: boolean; catalog?: string; json?: boolean }) => {
      if (!name && !opts.all) {
        const message = "Pass a note name or --all";
        if (opts.json) {
          console.log(JSON.stringify({ action: "update", status: "failed", error: { message } }, null, 2));
          process.exitCode = 1;
          return;
        }
        console.log(ui.fail(message));
        process.exitCode = 1;
        return;
      }
      try {
        if (!engine.notes.loaded) await engine.notes.loadAll();
        const targets = opts.all ? engine.notes.notes.map((note) => note.manifest.name) : [name!];
        const updated = [];
        for (const target of Array.from(new Set(targets))) {
          const manifest = await installNote(target, engine.config.projectRoot, { catalogUrl: opts.catalog });
          updated.push(serializeManifest(manifest));
        }
        if (opts.json) {
          console.log(JSON.stringify({ action: "update", status: "completed", updated }, null, 2));
          return;
        }
        for (const note of updated) console.log(`Updated ${note.name}@${note.version}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (opts.json) {
          console.log(JSON.stringify({ action: "update", status: "failed", error: { message } }, null, 2));
          process.exitCode = 1;
          return;
        }
        console.log(ui.fail(message));
        process.exitCode = 1;
      }
    });

  // ── doctor ─────────────────────────────────────────────

  notes
    .command("doctor")
    .description("Validate installed Note manifests and freshness metadata")
    .option("--community", "Use strict community marketplace review rules")
    .option("--path <path>", "Validate a specific Note directory")
    .option("--json", "Output doctor result as JSON")
    .action(async (opts: { community?: boolean; path?: string; json?: boolean }) => {
      if (opts.path) {
        const validation = await validateCommunityNoteDir(opts.path, { strictCommunity: Boolean(opts.community) });
        const payload = {
          status: validation.ok ? "completed" : "failed",
          notesChecked: 1,
          issues: validation.issues,
          warnings: validation.warnings,
        };
        if (opts.json) {
          console.log(JSON.stringify(payload, null, 2));
        } else {
          for (const issue of [...payload.issues, ...payload.warnings]) console.log(`${issue.level}: ${issue.path ?? validation.noteName ?? "note"}: ${issue.message}`);
          if (payload.issues.length === 0 && payload.warnings.length === 0) console.log("Notes doctor passed.");
        }
        if (!validation.ok) process.exitCode = 1;
        return;
      }
      if (!engine.notes.loaded) await engine.notes.loadAll();
      const issues = engine.notes.notes.flatMap((note) => {
        const noteIssues: Array<{ name: string; level: "warning" | "error"; message: string }> = [];
        const missingLevel = opts.community ? "error" : "warning";
        if ((note.manifest.sourceUrls ?? []).length === 0) {
          noteIssues.push({ name: note.manifest.name, level: missingLevel, message: opts.community ? "sourceUrls metadata is required for community review" : "sourceUrls metadata is missing" });
        }
        if (!note.manifest.lastResearchedAt) {
          noteIssues.push({ name: note.manifest.name, level: missingLevel, message: opts.community ? "lastResearchedAt metadata is required for community review" : "lastResearchedAt metadata is missing" });
        }
        if (opts.community && !note.manifest.freshnessDays) {
          noteIssues.push({ name: note.manifest.name, level: "error", message: "freshnessDays metadata is required for community review" });
        }
        return noteIssues;
      });
      const payload = {
        status: issues.some((issue) => issue.level === "error") ? "failed" : "completed",
        notesChecked: engine.notes.notes.length,
        issues: issues.filter((issue) => issue.level === "error"),
        warnings: issues.filter((issue) => issue.level === "warning"),
      };
      if (opts.json) {
        console.log(JSON.stringify(payload, null, 2));
        return;
      }
      for (const issue of [...payload.issues, ...payload.warnings]) console.log(`${issue.level}: ${issue.name}: ${issue.message}`);
      if (payload.issues.length === 0 && payload.warnings.length === 0) console.log("Notes doctor passed.");
      if (payload.issues.length > 0) process.exitCode = 1;
    });

  // ── remove ─────────────────────────────────────────────

  notes
    .command("remove <name>")
    .description("Uninstall a note")
    .option("--json", "Output removal result as JSON")
    .action(async (name: string, opts: { json?: boolean }) => {
      const removedPath = join(engine.config.projectRoot, ".memoire", "notes", name);
      try {
        await removeNote(name, engine.config.projectRoot);
        if (opts.json) {
          const payload: NoteMutationPayload = {
            action: "remove",
            status: "completed",
            options: { json: true },
            name,
            removedPath,
          };
          console.log(JSON.stringify(payload, null, 2));
          return;
        }
        console.log(`\n  - Removed note "${name}"\n`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (opts.json) {
          const payload: NoteMutationPayload = {
            action: "remove",
            status: "failed",
            options: { json: true },
            name,
            removedPath: null,
            error: { message: msg },
          };
          console.log(JSON.stringify(payload, null, 2));
          process.exitCode = 1;
          return;
        }
        console.log(ui.fail(msg));
        process.exitCode = 1;
      }
    });

  // ── create ─────────────────────────────────────────────

  notes
    .command("create <name>")
    .description("Scaffold a new note")
    .option("-c, --category <category>", "Note category (craft|research|connect|generate)", "craft")
    .option("--json", "Output scaffold result as JSON")
    .action(async (name: string, opts: { category: string; json?: boolean }) => {
      const category = opts.category as NoteCategory;
      const validCategories = ["craft", "research", "connect", "generate"];
      if (!validCategories.includes(category)) {
        if (opts.json) {
          const payload: NoteMutationPayload = {
            action: "create",
            status: "failed",
            options: { json: true },
            name,
            category,
            noteDir: null,
            note: null,
            error: {
              message: `Invalid category "${category}". Use: ${validCategories.join(", ")}`,
            },
          };
          console.log(JSON.stringify(payload, null, 2));
          process.exitCode = 1;
          return;
        }
        console.log(ui.fail(`Invalid category "${category}". Use: ${validCategories.join(", ")}`));
        process.exitCode = 1;
        return;
      }

      try {
        const noteDir = await scaffoldNote(name, category, engine.config.projectRoot);
        const manifest = await getNoteInfo(name, engine.config.projectRoot);
        if (opts.json) {
          const payload: NoteMutationPayload = {
            action: "create",
            status: "completed",
            options: { json: true },
            name,
            category,
            noteDir,
            filesCreated: ["note.json", `${name}.md`],
            note: manifest ? serializeManifest(manifest) : null,
          };
          console.log(JSON.stringify(payload, null, 2));
          return;
        }
        console.log(`\n  + Scaffolded note "${name}" in:`);
        console.log(`    ${noteDir}`);
        console.log(`\n  Files created:`);
        console.log(`    note.json   — manifest`);
        console.log(`    ${name}.md  — skill definition\n`);
        console.log(`  Edit ${name}.md to add your skill knowledge, then it's ready to use.\n`);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (opts.json) {
          const payload: NoteMutationPayload = {
            action: "create",
            status: "failed",
            options: { json: true },
            name,
            category,
            noteDir: null,
            note: null,
            error: { message: msg },
          };
          console.log(JSON.stringify(payload, null, 2));
          process.exitCode = 1;
          return;
        }
        console.log(ui.fail(msg));
        process.exitCode = 1;
      }
    });

  // ── info ───────────────────────────────────────────────

  notes
    .command("info <name>")
    .description("Show note details")
    .option("--json", "Output note details as JSON")
    .action(async (name: string, opts: { json?: boolean }) => {
      if (!engine.notes.loaded) await engine.notes.loadAll();
      const note = engine.notes.getNote(name);

      if (!note) {
        console.log(ui.fail(`Note "${name}" not found.`));
        process.exitCode = 1;
        return;
      }

      if (opts.json) {
        console.log(JSON.stringify({
          source: note.builtIn ? "built-in" : "installed",
          note: serializeInstalledNote(note),
        }, null, 2));
        return;
      }

      const manifest = note.manifest;
      const source = note.builtIn ? "built-in" : "installed";

      console.log(`\n  ${manifest.name}@${manifest.version}  [${source}]`);
      console.log(`  ${manifest.description}`);
      console.log();
      console.log(`  Category:     ${manifest.category}`);
      console.log(`  Tags:         ${manifest.tags.length > 0 ? manifest.tags.join(", ") : "(none)"}`);
      if (manifest.author) {
        console.log(`  Author:       ${manifest.author}`);
      }
      console.log(`  Dependencies: ${manifest.dependencies.length > 0 ? manifest.dependencies.join(", ") : "(none)"}`);
      console.log();
      console.log(`  Skills (${manifest.skills.length}):`);
      for (const skill of manifest.skills) {
        console.log(`    ${skill.name}`);
        console.log(`      file:       ${skill.file}`);
        console.log(`      activateOn: ${skill.activateOn}`);
        console.log(`      freedom:    ${skill.freedomLevel}`);
      }
      console.log();
    });
}

function serializeInstalledNote(note: InstalledNote) {
  return {
    ...serializeManifest(note.manifest),
    builtIn: note.builtIn,
    enabled: note.enabled,
  };
}

function serializeManifest(manifest: NoteManifest) {
  return {
    name: manifest.name,
    version: manifest.version,
    description: manifest.description,
    category: manifest.category,
    tags: manifest.tags,
    author: manifest.author ?? null,
    dependencies: manifest.dependencies,
    sourceUrls: manifest.sourceUrls ?? [],
    lastResearchedAt: manifest.lastResearchedAt ?? null,
    freshnessDays: manifest.freshnessDays ?? null,
    skills: manifest.skills.map((skill) => ({
      file: skill.file,
      name: skill.name,
      activateOn: skill.activateOn,
      freedomLevel: skill.freedomLevel,
    })),
  };
}

function outdatedReasons(manifest: NoteManifest, remote: Awaited<ReturnType<typeof findCatalogNote>>): string[] {
  const reasons: string[] = [];
  if (remote && remote.version.localeCompare(manifest.version, undefined, { numeric: true }) > 0) {
    reasons.push(`remote version ${remote.version} is newer`);
  }
  const researchedAt = manifest.lastResearchedAt ?? manifest.updatedAt;
  const freshnessDays = manifest.freshnessDays ?? 90;
  if (researchedAt) {
    const ageMs = Date.now() - Date.parse(researchedAt);
    if (Number.isFinite(ageMs) && ageMs > freshnessDays * 24 * 60 * 60 * 1000) {
      reasons.push(`last researched ${Math.floor(ageMs / 86_400_000)} days ago`);
    }
  }
  return reasons;
}

function buildNotesSummary(notes: InstalledNote[]) {
  return {
    total: notes.length,
    builtIn: notes.filter((note) => note.builtIn).length,
    installed: notes.filter((note) => !note.builtIn).length,
    active: notes.filter((note) => note.enabled).length,
    byCategory: {
      craft: notes.filter((note) => note.manifest.category === "craft").length,
      research: notes.filter((note) => note.manifest.category === "research").length,
      connect: notes.filter((note) => note.manifest.category === "connect").length,
      generate: notes.filter((note) => note.manifest.category === "generate").length,
    },
  };
}

function emptyNotesSummary() {
  return {
    total: 0,
    builtIn: 0,
    installed: 0,
    active: 0,
    byCategory: {
      craft: 0,
      research: 0,
      connect: 0,
      generate: 0,
    },
  };
}

function csv(value: string | undefined): string[] {
  return (value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function positiveInteger(value: string, label: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return parsed;
}
