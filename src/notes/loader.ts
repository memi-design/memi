/**
 * Note Loader — Discovers and loads Mémoire Notes from two sources:
 *   1. Built-in notes: existing skills/ directory (shipped with npm package)
 *   2. Installed notes: .memoire/notes/ in the project workspace
 *
 * Notes are cached in memory keyed by their manifest name + file mtime.
 * The cache is invalidated automatically when a note file changes on disk.
 */

import { readFile, readdir, stat } from "fs/promises";
import { join } from "path";
import { createLogger } from "../engine/logger.js";
import { packageRoot } from "../utils/asset-path.js";
import {
  NoteManifestSchema,
  type InstalledNote,
  type NoteManifest,
  type NoteCategory,
} from "./types.js";
import { buildWorkspaceSkillNote } from "./frontmatter.js";

const log = createLogger("notes-loader");

// ── In-memory note cache ──────────────────────────────────
// Key: "<noteDir>:<mtimeMs>" → InstalledNote
// Invalidated automatically when the note.json mtime changes.
const noteCache = new Map<string, InstalledNote>();

async function getCachedNote(noteDir: string, noteJsonPath: string, loader: () => Promise<InstalledNote | null>): Promise<InstalledNote | null> {
  try {
    const fileStat = await stat(noteJsonPath);
    const cacheKey = `${noteDir}:${fileStat.mtimeMs}`;

    if (noteCache.has(cacheKey)) {
      return noteCache.get(cacheKey)!;
    }

    const note = await loader();
    if (note) {
      // Evict any stale entry for this noteDir before inserting
      for (const key of noteCache.keys()) {
        if (key.startsWith(`${noteDir}:`)) {
          noteCache.delete(key);
        }
      }
      noteCache.set(cacheKey, note);
    }
    return note;
  } catch {
    return null;
  }
}

// ── Built-in Skill → Note Adapter ───────────────────────

interface SkillRegistryEntry {
  id: string;
  name: string;
  file: string;
  description: string;
  activateOn: string;
  freedomLevel: string;
  prerequisite?: string | null;
  chains?: string[];
}

interface SkillRegistry {
  version: string;
  skills: SkillRegistryEntry[];
}

interface WorkspaceRegistrySkill {
  readonly name?: string;
  readonly id?: string;
  readonly description?: string;
  readonly status?: string;
  readonly legacyCategory?: string;
  readonly tags?: string[];
  readonly surfaces?: string[];
  readonly routing?: {
    readonly intents?: string[];
    readonly excludes?: string[];
    readonly role?: string;
  };
  readonly runtime?: {
    readonly requires?: string[];
  };
}

function inferCategory(skill: SkillRegistryEntry): NoteCategory {
  if (skill.id.startsWith("figma-") || skill.id === "multi-agent" || skill.id === "atomic-design") return "craft";
  if (skill.id === "superpower") return "craft";
  if (skill.id === "dashboard-from-research") return "research";
  if (skill.id === "motion-video") return "craft";
  return "craft";
}

function skillToManifest(skill: SkillRegistryEntry, registryVersion: string): NoteManifest {
  return {
    name: skill.id,
    version: registryVersion,
    description: skill.description,
    category: inferCategory(skill),
    tags: [],
    sourceUrls: [],
    skills: [{
      file: skill.file,
      name: skill.name,
      activateOn: skill.activateOn,
      freedomLevel: (skill.freedomLevel as "maximum" | "high" | "read-only" | "reference") || "high",
    }],
    dependencies: skill.prerequisite ? [skill.prerequisite] : [],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

// ── Note Loader ──────────────────────────────────────────

/**
 * NoteLoader discovers and loads Mémoire Notes from all sources.
 *
 * ## Note Manifest Format
 * Each Note is a directory containing a `note.json` manifest:
 * ```json
 * {
 *   "name": "my-note",
 *   "version": "1.0.0",
 *   "description": "...",
 *   "category": "craft|research|connect|generate",
 *   "tags": [],
 *   "skills": [{
 *     "file": "my-note.md",
 *     "name": "My Note",
 *     "activateOn": "component-creation",
 *     "freedomLevel": "high"
 *   }],
 *   "dependencies": []
 * }
 * ```
 *
 * ## Activation Context Matching
 * The `activateOn` field in each skill is matched against the `INTENT_TO_ACTIVATION`
 * map in `types.ts`. When the orchestrator classifies an intent, it looks up which
 * activation contexts apply, then activates all skills whose `activateOn` value
 * appears in that set. Skills with `activateOn: "always"` are always activated.
 *
 * ## Load Sources (in priority order, later overrides earlier)
 * 1. Built-in skills from `skills/registry.json` (adapted to Note format)
 * 2. Built-in Note packages from `notes/` directory in the npm package
 * 3. User-installed Notes from `.memoire/notes/` in the project workspace
 * 4. Workspace skill notes from `<projectRoot>/skills/<name>/SKILL.md`
 *
 * ## Caching
 * Note manifests are cached in memory keyed by `<noteDir>:<mtime>`.
 * The cache is invalidated automatically when a `note.json` file changes on disk.
 */
export class NoteLoader {
  private projectRoot: string;
  private _notes: InstalledNote[] = [];
  private _loaded = false;

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
  }

  get notes(): InstalledNote[] {
    return this._notes;
  }

  get loaded(): boolean {
    return this._loaded;
  }

  /**
   * Load all notes from three sources:
   * 1. Legacy skills (skills/registry.json, adapted to Note format)
   * 2. Built-in Note packages (notes/{name}/note.json in npm package)
   * 3. User-installed Notes (.memoire/notes/)
   */
  async loadAll(): Promise<InstalledNote[]> {
    const [builtIn, builtInPackages, workspace, installed] = await Promise.all([
      this.loadBuiltInNotes(),
      this.loadBuiltInNotePackages(),
      this.loadWorkspaceSkillNotes(),
      this.loadInstalledNotes(),
    ]);

    // Later sources override earlier ones with the same name.
    const noteMap = new Map<string, InstalledNote>();
    for (const note of builtIn) noteMap.set(note.manifest.name, note);
    for (const note of builtInPackages) noteMap.set(note.manifest.name, note);
    for (const note of installed) noteMap.set(note.manifest.name, note);
    for (const note of workspace) noteMap.set(note.manifest.name, note);

    this._notes = Array.from(noteMap.values());
    this._loaded = true;

    const totalBuiltIn = builtIn.length + builtInPackages.length;
    log.info({ builtIn: totalBuiltIn, workspace: workspace.length, installed: installed.length, total: this._notes.length }, "Notes loaded");
    return this._notes;
  }

  /**
   * Load built-in notes from skills/registry.json.
   * Adapts the legacy skill format into the Note manifest format.
   */
  async loadBuiltInNotes(): Promise<InstalledNote[]> {
    const registryPath = join(packageRoot(), "skills", "registry.json");
    try {
      const raw = await readFile(registryPath, "utf-8");
      const registry: SkillRegistry = JSON.parse(raw);

      return registry.skills.map((skill) => ({
        manifest: skillToManifest(skill, registry.version),
        path: packageRoot(),
        builtIn: true,
        enabled: true,
      }));
    } catch (err) {
      log.warn({ err }, "Could not load built-in skills registry");
      return [];
    }
  }

  /**
   * Load built-in Note packages from notes/ directory in the npm package.
   * These are full Note directories with note.json manifests.
   */
  async loadBuiltInNotePackages(): Promise<InstalledNote[]> {
    const notesDir = join(packageRoot(), "notes");
    const notes: InstalledNote[] = [];

    try {
      const entries = await readdir(notesDir);

      for (const entry of entries) {
        const noteDir = join(notesDir, entry);
        const noteJsonPath = join(noteDir, "note.json");

        const note = await getCachedNote(noteDir, noteJsonPath, async () => {
          const dirStat = await stat(noteDir);
          if (!dirStat.isDirectory()) return null;

          const raw = await readFile(noteJsonPath, "utf-8");
          const parsed = JSON.parse(raw);
          const manifest = NoteManifestSchema.parse(parsed);

          return { manifest, path: noteDir, builtIn: true, enabled: true };
        });

        if (note) notes.push(note);
      }
    } catch {
      // notes/ directory doesn't exist — that's fine
    }

    return notes;
  }

  /**
   * Load workspace skills from <projectRoot>/skills/<skill-name>/SKILL.md.
   * This is the ClawHub/AgentSkills compatibility path.
   */
  async loadWorkspaceSkillNotes(): Promise<InstalledNote[]> {
    const skillsDir = join(this.projectRoot, "skills");
    const notes: InstalledNote[] = [];
    const registry = await loadWorkspaceRegistry(this.projectRoot);

    try {
      const entries = await readdir(skillsDir, { withFileTypes: true });

      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith(".")) continue;

        const noteDir = join(skillsDir, entry.name);
        const skillPath = join(noteDir, "SKILL.md");

        try {
          const fileStat = await stat(skillPath);
          if (!fileStat.isFile()) continue;

          const markdown = await readFile(skillPath, "utf-8");
          const note = buildWorkspaceSkillNote(markdown, {
            noteDir,
            fallbackName: entry.name,
            skillFileName: "SKILL.md",
          });
          notes.push(applyWorkspaceRegistryMetadata(
            note,
            registry.get(note.manifest.name),
          ));
        } catch {
          // Skip directories without a valid SKILL.md file
        }
      }
    } catch {
      // Workspace skills directory doesn't exist yet — that's fine
    }

    return notes;
  }

  /**
   * Load user-installed notes from .memoire/notes/
   */
  async loadInstalledNotes(): Promise<InstalledNote[]> {
    const notesDir = join(this.projectRoot, ".memoire", "notes");
    const notes: InstalledNote[] = [];

    try {
      const entries = await readdir(notesDir);

      for (const entry of entries) {
        const noteDir = join(notesDir, entry);
        const noteJsonPath = join(noteDir, "note.json");

        const note = await getCachedNote(noteDir, noteJsonPath, async () => {
          const dirStat = await stat(noteDir);
          if (!dirStat.isDirectory()) return null;

          const raw = await readFile(noteJsonPath, "utf-8");
          const parsed = JSON.parse(raw);
          const manifest = NoteManifestSchema.parse(parsed);

          return { manifest, path: noteDir, builtIn: false, enabled: true };
        });

        if (note) {
          notes.push(note);
        } else if (note === null) {
          // getCachedNote returns null for directories we can't read — warn only for installed notes
          const dirStat = await stat(noteDir).catch(() => null);
          if (dirStat?.isDirectory()) {
            log.warn({ entry }, "Skipping invalid note (no valid note.json)");
          }
        }
      }
    } catch {
      // .memoire/notes/ doesn't exist yet — that's fine
    }

    return notes;
  }

  /**
   * Get a specific note by name.
   */
  getNote(name: string): InstalledNote | undefined {
    return this._notes.find((n) => n.manifest.name === name);
  }

  /**
   * Get notes filtered by category.
   */
  getNotesByCategory(category: NoteCategory): InstalledNote[] {
    return this._notes.filter((n) => n.manifest.category === category);
  }

  /**
   * Reload all notes (useful after install/remove).
   */
  async reload(): Promise<InstalledNote[]> {
    this._loaded = false;
    return this.loadAll();
  }
}

async function loadWorkspaceRegistry(
  projectRoot: string,
): Promise<ReadonlyMap<string, WorkspaceRegistrySkill>> {
  try {
    const raw = JSON.parse(
      await readFile(join(projectRoot, "registry", "skills.json"), "utf8"),
    ) as { skills?: unknown };
    if (!Array.isArray(raw.skills)) return new Map();
    const entries = raw.skills.filter((entry): entry is WorkspaceRegistrySkill =>
      Boolean(entry) && typeof entry === "object" && !Array.isArray(entry));
    return new Map(entries.flatMap((entry) => {
      const id = entry.name ?? entry.id;
      return id ? [[id, entry] as const] : [];
    }));
  } catch {
    return new Map();
  }
}

function applyWorkspaceRegistryMetadata(
  note: InstalledNote,
  metadata: WorkspaceRegistrySkill | undefined,
): InstalledNote {
  if (!metadata) return note;
  const category = isNoteCategory(metadata.legacyCategory)
    ? metadata.legacyCategory
    : note.manifest.category;
  const tags = stringArray(metadata.tags);
  const platforms = inferPlatforms([...tags, ...stringArray(metadata.surfaces)]);
  const capabilities = stringArray(metadata.runtime?.requires)
    .map((requirement) => requirement.split(".")[0])
    .filter((value, index, values) => value && values.indexOf(value) === index);
  const rolePriority: Readonly<Record<string, number>> = {
    primary: 3,
    supporting: 1,
    reference: -2,
  };
  const manifest = NoteManifestSchema.parse({
    ...note.manifest,
    description: metadata.description ?? note.manifest.description,
    category,
    tags: tags.length > 0 ? tags : note.manifest.tags,
    memoire: {
      ...note.manifest.memoire,
      harnessExtensions: note.manifest.memoire?.harnessExtensions ?? [],
      routing: {
        intents: stringArray(metadata.routing?.intents).length > 0
          ? stringArray(metadata.routing?.intents)
          : note.manifest.skills.flatMap((skill) =>
            skill.activateOn.split(",").map((entry) => entry.trim()).filter(Boolean)),
        excludes: stringArray(metadata.routing?.excludes),
        capabilities,
        platforms,
        priority: rolePriority[metadata.routing?.role ?? ""] ?? 0,
      },
    },
  });
  return {
    ...note,
    manifest,
    enabled: note.enabled && metadata.status !== "deprecated",
  };
}

function inferPlatforms(values: readonly string[]): string[] {
  const normalized = new Set(values.map((value) => value.toLowerCase()));
  const platforms = [
    ["flutter", ["flutter", "dart"]],
    ["react-native", ["react-native", "expo"]],
    ["swiftui", ["swiftui"]],
    ["ios", ["ios", "apple"]],
    ["android", ["android", "kotlin"]],
    ["web", ["web", "nextjs", "react", "browser"]],
  ] as const;
  return platforms
    .filter(([, signals]) => signals.some((signal) => normalized.has(signal)))
    .map(([platform]) => platform);
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function isNoteCategory(value: unknown): value is NoteCategory {
  return value === "craft"
    || value === "research"
    || value === "connect"
    || value === "generate";
}
