/**
 * Registry — Manages specs, design system data, and generation state.
 * Persists to .memoire/ directory for cross-session continuity.
 */

import { EventEmitter } from "events";
import { readFile, writeFile, readdir, mkdir, rename } from "fs/promises";
import { join } from "path";
import { createLogger } from "./logger.js";
import { ComponentSpec, PageSpec, DataVizSpec, DesignSpec, IASpec, AnySpec } from "../specs/types.js";
import type { Finding } from "../codegen/generator.js";
import type { LayoutCritique } from "../codegen/layout-critic.js";
import { isPathWithin } from "../utils/path-containment.js";

const log = createLogger("registry");

export interface DesignSystem {
  tokens: DesignToken[];
  components: DesignComponent[];
  styles: DesignStyle[];
  lastSync: string;
}

export interface DesignToken {
  name: string;
  collection: string;
  type: "color" | "spacing" | "typography" | "radius" | "shadow" | "other";
  values: Record<string, string | number>; // mode → value
  cssVariable: string;
}

export interface DesignComponent {
  name: string;
  key: string;
  description: string;
  variants: string[];
  properties: Record<string, { type: string; defaultValue?: string }>;
  figmaNodeId: string;
}

export interface DesignStyle {
  name: string;
  type: "fill" | "text" | "effect" | "grid";
  value: Record<string, unknown>;
}

export interface GenerationState {
  specName: string;
  generatedAt: string;
  files: string[];
  specHash: string; // detect if spec changed since last gen
  /** Quality-gate findings from the generation that produced this state. Never set for a blocked generation — see CodeGenerator.generate(). */
  findings?: Finding[];
  /** AI layout critique (page specs only, when an API key was configured). */
  critique?: LayoutCritique;
}

/** Validate spec name is safe for use in file paths */
function assertSafeName(name: string): void {
  if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(name)) {
    throw new Error(`Invalid spec name "${name}": must start with a letter and contain only letters, numbers, hyphens, or underscores`);
  }
  if (name.length > 128) {
    throw new Error(`Spec name too long (${name.length} chars, max 128)`);
  }
}

/** Ensure a resolved path stays within the expected parent directory */
function assertWithinDir(filePath: string, parentDir: string): void {
  if (!isPathWithin(filePath, parentDir)) {
    throw new Error(`Path traversal detected: ${filePath} escapes ${parentDir}`);
  }
}

/** Map spec type to its directory name */
function specTypeDir(type: string): string {
  switch (type) {
    case "dataviz": return "dataviz";
    case "design": return "design";
    case "ia": return "ia";
    case "component": return "components";
    case "page": return "pages";
    default: return `${type}s`;
  }
}

export class Registry extends EventEmitter {
  private arkDir: string;
  private specs = new Map<string, AnySpec>();
  private generations = new Map<string, GenerationState>();
  private saveTimer: ReturnType<typeof setTimeout> | null = null;
  private _designSystem: DesignSystem = {
    tokens: [],
    components: [],
    styles: [],
    lastSync: "never",
  };

  constructor(arkDir: string) {
    super();
    this.setMaxListeners(20);
    this.arkDir = arkDir;
  }

  get designSystem(): DesignSystem {
    return this._designSystem;
  }

  async load(): Promise<void> {
    await mkdir(this.arkDir, { recursive: true });

    // Load design system
    try {
      const dsPath = join(this.arkDir, "design-system.json");
      const raw = await readFile(dsPath, "utf-8");
      // Fix #5 (HIGH): sanitize JSON before parsing to prevent prototype pollution.
      // JSON.parse with a reviver that blocks __proto__, constructor, prototype keys.
      const parsed = JSON.parse(raw, (key, value) => {
        if (key === "__proto__" || key === "constructor" || key === "prototype") return undefined;
        return value;
      });
      if (parsed && typeof parsed === "object" && Array.isArray(parsed.tokens)) {
        this._designSystem = parsed;
      } else {
        log.warn("design-system.json has unexpected shape, using defaults");
      }
    } catch (err) {
      if (err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code !== "ENOENT") {
        log.warn({ err: err.message }, "Failed to load design-system.json");
      }
    }

    // Load specs from specs/ directories (parallel for faster init)
    await Promise.all([
      this.loadSpecsFrom("components"),
      this.loadSpecsFrom("pages"),
      this.loadSpecsFrom("dataviz"),
      this.loadSpecsFrom("design"),
      this.loadSpecsFrom("ia"),
    ]);

    // Load generation state
    try {
      const genPath = join(this.arkDir, "generations.json");
      const raw = await readFile(genPath, "utf-8");
      const states: GenerationState[] = JSON.parse(raw, (key, value) => {
        if (key === "__proto__" || key === "constructor" || key === "prototype") return undefined;
        return value;
      });
      for (const state of states) {
        this.generations.set(state.specName, state);
      }
    } catch (err) {
      if (err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code !== "ENOENT") {
        log.warn({ err: err.message }, "Failed to load generations.json");
      }
    }
  }

  async getSpec(name: string): Promise<AnySpec | null> {
    return this.specs.get(name) ?? null;
  }

  async getAllSpecs(): Promise<AnySpec[]> {
    return Array.from(this.specs.values());
  }

  async saveSpec(spec: AnySpec): Promise<void> {
    assertSafeName(spec.name);
    const previous = this.specs.get(spec.name) ?? null;
    this.specs.set(spec.name, spec);

    const typeDir = specTypeDir(spec.type);
    const dir = join(this.arkDir, "..", "specs", typeDir);
    await mkdir(dir, { recursive: true });

    // Atomic write: write to temp file, then rename
    const filePath = join(dir, `${spec.name}.json`);
    const tmpPath = join(dir, `.${spec.name}.json.tmp`);
    assertWithinDir(filePath, dir);
    await writeFile(tmpPath, JSON.stringify(spec, null, 2));
    await rename(tmpPath, filePath);
    this.emit("spec-changed", { name: spec.name, type: spec.type, previous, current: spec });
  }

  addToken(token: DesignToken): void {
    const idx = this._designSystem.tokens.findIndex(t => t.name === token.name);
    const previous = idx >= 0 ? this._designSystem.tokens[idx] : null;
    if (idx >= 0) {
      this._designSystem.tokens[idx] = token;
    } else {
      this._designSystem.tokens.push(token);
    }
    this.emit("token-changed", { name: token.name, action: previous ? "updated" : "added", previous, current: token });
    this.deferSave();
  }

  updateToken(name: string, token: DesignToken): void {
    const idx = this._designSystem.tokens.findIndex(t => t.name === name);
    const previous = idx >= 0 ? this._designSystem.tokens[idx] : null;
    if (idx >= 0) {
      this._designSystem.tokens[idx] = token;
    } else {
      this._designSystem.tokens.push(token);
    }
    this.emit("token-changed", { name, action: previous ? "updated" : "added", previous, current: token });
    this.deferSave();
  }

  removeToken(name: string): boolean {
    const idx = this._designSystem.tokens.findIndex(t => t.name === name);
    if (idx >= 0) {
      const removed = this._designSystem.tokens[idx];
      this._designSystem.tokens.splice(idx, 1);
      this.emit("token-changed", { name, action: "removed", previous: removed, current: null });
      this.deferSave();
      return true;
    }
    return false;
  }

  async save(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    await this.updateDesignSystem(this._designSystem);
  }

  /** Coalesce rapid token mutations into a single disk write (100ms debounce). */
  private deferSave(): void {
    if (this.saveTimer) return;
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      this.save().catch((err) => {
        log.warn({ err: (err as Error).message }, "Deferred save failed");
      });
    }, 100);
  }

  async updateDesignSystem(ds: DesignSystem): Promise<void> {
    const previous = this._designSystem;

    // Save previous snapshot for `memi diff` (only if it had real data)
    if (previous.tokens.length > 0 || previous.components.length > 0) {
      const prevPath = join(this.arkDir, "design-system.prev.json");
      await writeFile(prevPath, JSON.stringify(previous, null, 2)).catch(() => {});
    }

    this._designSystem = ds;
    const path = join(this.arkDir, "design-system.json");
    const tmpPath = join(this.arkDir, ".design-system.json.tmp");
    await writeFile(tmpPath, JSON.stringify(ds, null, 2));
    await rename(tmpPath, path);
    this.emit("design-system-changed", { previous, current: ds });
  }

  async recordGeneration(state: GenerationState): Promise<void> {
    this.generations.set(state.specName, state);
    const path = join(this.arkDir, "generations.json");
    const tmpPath = join(this.arkDir, ".generations.json.tmp");
    const all = Array.from(this.generations.values());
    await writeFile(tmpPath, JSON.stringify(all, null, 2));
    await rename(tmpPath, path);
  }

  getGenerationState(specName: string): GenerationState | null {
    return this.generations.get(specName) ?? null;
  }

  private async loadSpecsFrom(subdir: string): Promise<void> {
    const dir = join(this.arkDir, "..", "specs", subdir);
    try {
      const files = await readdir(dir);
      for (const file of files) {
        if (!file.endsWith(".json")) continue;
        try {
          const raw = await readFile(join(dir, file), "utf-8");
          const spec: AnySpec = JSON.parse(raw);
          if (!spec.name || typeof spec.name !== "string") {
            log.warn({ subdir, file }, "Spec missing valid name, using filename");
            spec.name = file.replace(/\.json$/, "");
          }
          assertSafeName(spec.name);
          this.specs.set(spec.name, spec);
        } catch (err) {
          if (err instanceof Error) {
            log.warn({ subdir, file, err: err.message }, "Skipping invalid spec file");
          }
        }
      }
    } catch (err) {
      if (err instanceof Error && "code" in err && (err as NodeJS.ErrnoException).code !== "ENOENT") {
        log.warn({ subdir, err: (err as Error).message }, "Failed to read specs directory");
      }
    }
  }
}
