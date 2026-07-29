/**
 * Mémoire Notes — Downloadable skill packs for the design engine.
 */

export {
  NoteCategorySchema,
  FreedomLevelSchema,
  NoteSkillSchema,
  NoteManifestSchema,
  INTENT_TO_ACTIVATION,
  type NoteCategory,
  type FreedomLevel,
  type NoteSkill,
  type NoteManifest,
  type InstalledNote,
  type ResolvedSkill,
} from "./types.js";

export { NoteLoader } from "./loader.js";
export {
  parseSkillMarkdown,
  buildWorkspaceSkillNote,
} from "./frontmatter.js";

export {
  resolveForIntent,
  buildSkillPromptBlock,
  wrapWithNotes,
} from "./resolver.js";

export {
  SKILL_ROUTER_VERSION,
  formatRoutedSkillContext,
  resolveRoutedSkills,
  routeInstalledSkills,
  searchCatalogSkills,
  type ResolvedSkillRoute,
  type RouteInstalledSkillsInput,
  type SkillRouteResult,
  type SkillSearchEntry,
  type SkillSearchResult,
} from "./skill-router.js";
export { buildRepositoryFingerprint } from "./repository-fingerprint.js";
export {
  SkillFitnessEventSchema,
  SkillFitnessRouteSchema,
  SkillFitnessRouteReceiptSchema,
  appendSkillFitnessEvent,
  buildSkillFitnessEvent,
  loadSkillFitnessEvents,
  projectSkillFitness,
  type SkillFitnessEvent,
  type SkillFitnessProjection,
  type SkillFitnessRoute,
} from "./skill-fitness.js";

export {
  installNote,
  removeNote,
  scaffoldNote,
  getNoteInfo,
  parseGithubNoteRepo,
} from "./installer.js";

export {
  DEFAULT_NOTES_CATALOG_URL,
  DEFAULT_COMMUNITY_NOTES_CATALOG_URL,
  NoteCatalogArchiveSchema,
  NoteCatalogEntrySchema,
  NoteCatalogSchema,
  assertSafeArchiveEntries,
  catalogEntryToManifest,
  findCatalogNote,
  installCatalogNote,
  isSafeNoteName,
  loadNotesCatalog,
  noteArchiveName,
  noteTitleFromName,
  type NoteCatalog,
  type NoteCatalogEntry,
} from "./catalog.js";

export {
  buildNoteForkPrHandoff,
  diffNoteFork,
  forkNoteDirectory,
  getNoteForkFiles,
  listNoteForks,
  updateNoteForkFile,
  validateCommunityNoteDir,
} from "./community.js";
