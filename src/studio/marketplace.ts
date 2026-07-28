import { NoteLoader } from "../notes/loader.js";
import { installNote, removeNote } from "../notes/installer.js";
import {
  DEFAULT_COMMUNITY_NOTES_CATALOG_URL,
  DEFAULT_NOTES_CATALOG_URL,
  loadNotesCatalog,
  type NoteCatalog,
  type NoteCatalogEntry,
} from "../notes/catalog.js";
import { listNoteForks } from "../notes/community.js";
import type { InstalledNote } from "../notes/types.js";
import type {
  StudioMarketplaceNote,
  StudioMarketplaceNoteSource,
  StudioMarketplaceNotesPayload,
} from "./types.js";

export interface MarketplaceNotesOptions {
  refresh?: boolean;
  catalogUrl?: string | null;
  includeRemote?: boolean;
}

class StudioCatalogCache {
  private catalog: NoteCatalog | null = null;
  private checkedAt = 0;
  private error: string | null = null;
  private catalogUrl: string | null = null;
  private readonly ttlMs = 5 * 60_000;

  get ageMs(): number {
    return this.checkedAt ? Math.max(0, Date.now() - this.checkedAt) : 0;
  }

  get status() {
    if (!this.catalog && !this.error) {
      return {
        status: "disabled" as const,
        catalogUrl: this.catalogUrl,
        checkedAt: null,
        cacheAgeMs: 0,
        error: null,
        entries: 0,
      };
    }
    return {
      status: this.catalog ? "ready" as const : "error" as const,
      catalogUrl: this.catalogUrl,
      checkedAt: this.checkedAt ? new Date(this.checkedAt).toISOString() : null,
      cacheAgeMs: this.ageMs,
      error: this.error,
      entries: this.catalog?.notes.length ?? 0,
    };
  }

  async load(options: MarketplaceNotesOptions = {}): Promise<NoteCatalog | null> {
    const catalogUrl = options.catalogUrl || process.env.MEMOIRE_NOTES_CATALOG_URL || DEFAULT_NOTES_CATALOG_URL;
    const now = Date.now();
    if (!options.refresh && this.catalog && this.catalogUrl === catalogUrl && now - this.checkedAt < this.ttlMs) return this.catalog;
    try {
      this.catalog = await loadNotesCatalog({ catalogUrl, timeoutMs: 2_500 });
      this.catalogUrl = catalogUrl;
      this.checkedAt = now;
      this.error = null;
      return this.catalog;
    } catch (error) {
      this.catalog = null;
      this.catalogUrl = catalogUrl;
      this.checkedAt = now;
      this.error = error instanceof Error ? error.message : String(error);
      return null;
    }
  }
}

export const studioCatalogCache = new StudioCatalogCache();
export const studioCommunityCatalogCache = new StudioCatalogCache();

export async function listMarketplaceNotes(
  projectRoot: string,
  options: MarketplaceNotesOptions = {},
): Promise<StudioMarketplaceNotesPayload> {
  const loader = new NoteLoader(projectRoot);
  const [legacySkills, builtInPackages, workspaceSkills, installedNotes] = await Promise.all([
    loader.loadBuiltInNotes(),
    loader.loadBuiltInNotePackages(),
    loader.loadWorkspaceSkillNotes(),
    loader.loadInstalledNotes(),
  ]);
  const localForks = await listNoteForks(projectRoot);
  const builtInIds = new Set([...legacySkills, ...builtInPackages].map((note) => note.manifest.name));
  const installableIds = new Set(builtInPackages.map((note) => note.manifest.name));
  const rows = new Map<string, StudioMarketplaceNote>();

  for (const note of legacySkills) {
    rows.set(note.manifest.name, serializeMarketplaceNote(note, {
      source: "legacy-skill",
      installed: false,
      builtIn: true,
      installable: false,
    }));
  }
  for (const note of builtInPackages) {
    rows.set(note.manifest.name, serializeMarketplaceNote(note, {
      source: "built-in-note",
      installed: false,
      builtIn: true,
      installable: true,
    }));
  }
  for (const note of workspaceSkills) {
    rows.set(note.manifest.name, serializeMarketplaceNote(note, {
      source: "workspace-skill",
      installed: true,
      builtIn: builtInIds.has(note.manifest.name),
      installable: false,
    }));
  }
  for (const note of installedNotes) {
    const isFork = Boolean(note.manifest.forkOf);
    rows.set(note.manifest.name, serializeMarketplaceNote(note, {
      source: isFork ? "local-fork" : "installed-note",
      installed: true,
      builtIn: builtInIds.has(note.manifest.name),
      installable: installableIds.has(note.manifest.name),
    }));
  }
  for (const fork of localForks) {
    const current = rows.get(fork.name);
    if (current) {
      rows.set(fork.name, {
        ...current,
        source: "local-fork",
        reviewStatus: fork.reviewStatus,
        forkOf: fork.forkOf,
        isForkable: false,
      });
    }
  }
  if (options.includeRemote || options.refresh || options.catalogUrl) {
    const remote = await studioCatalogCache.load(options);
    for (const entry of remote?.notes ?? []) {
      const installed = rows.get(entry.name);
      if (installed) {
        rows.set(entry.name, {
          ...installed,
          sourceUrl: entry.archive.url,
          installable: !installed.installed,
          sourceUrls: entry.sourceUrls,
          lastResearchedAt: entry.lastResearchedAt ?? null,
          freshnessDays: entry.freshnessDays ?? null,
          sourceRepo: entry.sourceRepo ?? null,
          reviewStatus: entry.reviewStatus ?? null,
          contributionUrl: entry.contributionUrl ?? null,
          freshnessStatus: freshnessStatus(entry.lastResearchedAt, entry.freshnessDays),
        });
        continue;
      }
      rows.set(entry.name, serializeRemoteMarketplaceNote(entry, "remote-catalog"));
    }
    const community = await studioCommunityCatalogCache.load({
      ...options,
      catalogUrl: process.env.MEMOIRE_COMMUNITY_NOTES_CATALOG_URL || DEFAULT_COMMUNITY_NOTES_CATALOG_URL,
    });
    for (const entry of community?.notes ?? []) {
      const installed = rows.get(entry.name);
      if (installed) {
        rows.set(entry.name, {
          ...installed,
          sourceRepo: entry.sourceRepo ?? installed.sourceRepo ?? null,
          reviewStatus: entry.reviewStatus ?? installed.reviewStatus ?? "approved",
          contributionUrl: entry.contributionUrl ?? installed.contributionUrl ?? null,
          freshnessStatus: freshnessStatus(entry.lastResearchedAt, entry.freshnessDays),
        });
        continue;
      }
      rows.set(entry.name, serializeRemoteMarketplaceNote(entry, "community-catalog"));
    }
  }

  const notes = Array.from(rows.values()).sort((left, right) => {
    if (left.installed !== right.installed) return left.installed ? -1 : 1;
    if (left.category !== right.category) return left.category.localeCompare(right.category);
    return left.title.localeCompare(right.title);
  });

  return {
    notes,
    summary: {
      total: notes.length,
      builtIn: notes.filter((note) => note.builtIn).length,
      installed: notes.filter((note) => note.installed).length,
      installable: notes.filter((note) => note.installable).length,
      categories: notes.reduce<Record<string, number>>((acc, note) => {
        acc[note.category] = (acc[note.category] ?? 0) + 1;
        return acc;
      }, {}),
    },
    remote: studioCatalogCache.status,
    community: studioCommunityCatalogCache.status,
  };
}

export async function getMarketplaceNote(
  projectRoot: string,
  id: string,
  options: MarketplaceNotesOptions = {},
): Promise<StudioMarketplaceNote | null> {
  const payload = await listMarketplaceNotes(projectRoot, { ...options, includeRemote: true });
  return payload.notes.find((note) => note.id === id || note.name === id) ?? null;
}

export async function installMarketplaceNote(
  projectRoot: string,
  input: { noteId?: string; source?: string },
): Promise<StudioMarketplaceNotesPayload> {
  const source = input.source?.trim();
  if (source) {
    await installNote(source, projectRoot);
    return listMarketplaceNotes(projectRoot);
  }

  const noteId = input.noteId?.trim();
  if (!noteId) {
    throw Object.assign(new Error("noteId or source is required"), { statusCode: 400 });
  }

  const marketplace = await listMarketplaceNotes(projectRoot);
  const note = marketplace.notes.find((candidate) => candidate.id === noteId || candidate.name === noteId);
  if (!note) {
    throw Object.assign(new Error(`Unknown marketplace note: ${noteId}`), { statusCode: 404 });
  }
  if (!note.installable) {
    throw Object.assign(new Error(`Marketplace note is not installable: ${note.name}`), { statusCode: 400 });
  }

  await installNote(note.sourcePath, projectRoot);
  return listMarketplaceNotes(projectRoot);
}

export async function removeMarketplaceNote(
  projectRoot: string,
  input: { name?: string },
): Promise<StudioMarketplaceNotesPayload> {
  const name = input.name?.trim();
  if (!name) {
    throw Object.assign(new Error("name is required"), { statusCode: 400 });
  }
  await removeNote(name, projectRoot);
  return listMarketplaceNotes(projectRoot);
}

function serializeMarketplaceNote(
  note: InstalledNote,
  meta: {
    source: StudioMarketplaceNoteSource;
    installed: boolean;
    builtIn: boolean;
    installable: boolean;
  },
): StudioMarketplaceNote {
  const manifest = note.manifest;
  return {
    id: manifest.name,
    name: manifest.name,
    title: manifest.skills[0]?.name ?? titleize(manifest.name),
    category: manifest.category,
    description: manifest.description,
    source: meta.source,
    sourcePath: note.path,
    sourceUrl: null,
    packageName: null,
    version: manifest.version,
    installed: meta.installed,
    builtIn: meta.builtIn,
    installable: meta.installable,
    tags: manifest.tags,
    sourceUrls: manifest.sourceUrls ?? [],
    lastResearchedAt: manifest.lastResearchedAt ?? null,
    freshnessDays: manifest.freshnessDays ?? null,
    sourceRepo: manifest.forkOf?.sourceRepo ?? null,
    reviewStatus: manifest.reviewStatus ?? null,
    forkOf: manifest.forkOf ? {
      name: manifest.forkOf.name,
      version: manifest.forkOf.version,
      sourceRepo: manifest.forkOf.sourceRepo ?? null,
      sourcePath: manifest.forkOf.sourcePath ?? null,
    } : null,
    isForkable: meta.source !== "legacy-skill" && meta.source !== "local-fork",
    contributionUrl: contributionUrlFor(manifest.name),
    freshnessStatus: freshnessStatus(manifest.lastResearchedAt, manifest.freshnessDays),
  };
}

function serializeRemoteMarketplaceNote(
  entry: NoteCatalogEntry,
  source: "remote-catalog" | "community-catalog",
): StudioMarketplaceNote {
  return {
    id: entry.id,
    name: entry.name,
    title: entry.title,
    category: entry.category,
    description: entry.description,
    source,
    sourcePath: entry.archive.url,
    sourceUrl: entry.archive.url,
    packageName: null,
    version: entry.version,
    installed: false,
    builtIn: false,
    installable: true,
    tags: entry.tags,
    sourceUrls: entry.sourceUrls,
    lastResearchedAt: entry.lastResearchedAt ?? null,
    freshnessDays: entry.freshnessDays ?? null,
    sourceRepo: entry.sourceRepo ?? null,
    reviewStatus: entry.reviewStatus ?? (source === "community-catalog" ? "approved" : null),
    forkOf: null,
    isForkable: false,
    contributionUrl: entry.contributionUrl ?? contributionUrlFor(entry.name),
    freshnessStatus: freshnessStatus(entry.lastResearchedAt, entry.freshnessDays),
  };
}

function contributionUrlFor(name: string): string {
  return `https://github.com/memi-design/design-skills/tree/main/skills/${name}`;
}

function freshnessStatus(lastResearchedAt?: string | null, freshnessDays?: number | null): string {
  if (!lastResearchedAt) return "unverified";
  const researched = Date.parse(lastResearchedAt);
  if (!Number.isFinite(researched)) return "unverified";
  const ageDays = Math.max(0, Math.floor((Date.now() - researched) / 86_400_000));
  return ageDays > (freshnessDays ?? 90) ? "stale" : "fresh";
}

function titleize(value: string): string {
  return value.split("-").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}
