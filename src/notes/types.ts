/**
 * Mémoire Notes — Type definitions and Zod schemas for the
 * downloadable skill pack ecosystem.
 *
 * A Note is a self-contained skill bundle: manifest + markdown skills
 * + optional hooks. Notes extend what Mémoire can do — better at
 * mobile design, systems thinking, research, new integrations, etc.
 */

import { z } from "zod";

// ── Note Categories ──────────────────────────────────────

export const NoteCategorySchema = z.enum([
  "craft",      // design craft — mobile, systems, accessibility, animation
  "research",   // user research, competitive analysis, data synthesis
  "connect",    // integrations — Notion, Linear, Slack, custom APIs
  "generate",   // specialized codegen — React Native, Vue, SwiftUI, Flutter
]);
export type NoteCategory = z.infer<typeof NoteCategorySchema>;

// ── Freedom Levels ───────────────────────────────────────

export const FreedomLevelSchema = z.enum([
  "maximum",    // full autonomy — create, modify, delete
  "high",       // create and modify, no destructive ops
  "read-only",  // analysis and reporting only
  "reference",  // passive reference material, never auto-activated
]);
export type FreedomLevel = z.infer<typeof FreedomLevelSchema>;

// ── Skill Entry (one markdown file within a Note) ────────

export const NoteSkillSchema = z.object({
  file: z.string(),                             // relative path within note folder
  name: z.string(),                             // display name
  activateOn: z.string(),                       // activation context key
  freedomLevel: FreedomLevelSchema.default("high"),
});
export type NoteSkill = z.infer<typeof NoteSkillSchema>;

// ── Note Manifest (note.json) ────────────────────────────

export const NoteManifestSchema = z.object({
  name: z.string().regex(/^[a-z][a-z0-9-]*$/, "Note name must be kebab-case"),
  version: z.string().regex(/^\d+\.\d+\.\d+$/, "Version must be semver (x.y.z)"),
  description: z.string().min(1),
  author: z.string().optional(),
  category: NoteCategorySchema,
  tags: z.array(z.string()).default([]),
  sourceUrls: z.array(z.string().url()).default([]),
  lastResearchedAt: z.string().datetime().optional(),
  freshnessDays: z.number().int().positive().optional(),
  skills: z.array(NoteSkillSchema).min(1),
  dependencies: z.array(z.string()).default([]),  // other note names
  engines: z.object({
    memoire: z.string().optional(),               // semver range compatibility
  }).optional(),
  memoire: z.object({
    harnessExtensions: z.array(z.unknown()).default([]),
    routing: z.object({
      intents: z.array(z.string().min(1)).default([]),
      excludes: z.array(z.string().min(1)).default([]),
      capabilities: z.array(z.string().min(1)).default([]),
      platforms: z.array(z.string().min(1)).default([]),
      priority: z.number().int().default(0),
      actions: z.array(z.string().min(1)).optional(),
      lifecycle: z.array(z.string().min(1)).optional(),
    }).strict().optional(),
  }).optional(),
  reviewStatus: z.enum(["draft", "submitted", "approved", "rejected"]).optional(),
  forkOf: z.object({
    name: z.string().regex(/^[a-z][a-z0-9-]*$/),
    version: z.string().regex(/^\d+\.\d+\.\d+$/),
    sourceRepo: z.string().url().optional(),
    sourcePath: z.string().optional(),
  }).optional(),
  createdAt: z.string().default(() => new Date().toISOString()),
  updatedAt: z.string().default(() => new Date().toISOString()),
});
export type NoteManifest = z.infer<typeof NoteManifestSchema>;

// ── Runtime Types ────────────────────────────────────────

export interface InstalledNote {
  manifest: NoteManifest;
  path: string;           // absolute path to note directory
  builtIn: boolean;       // true = ships with npm package in skills/
  enabled: boolean;
}

export interface ResolvedSkill {
  noteId: string;         // manifest.name
  skillName: string;      // display name
  file: string;           // absolute path to .md
  content: string;        // loaded markdown
  activateOn: string;
  freedomLevel: FreedomLevel;
}

// ── Activation Context Map ───────────────────────────────
// Maps IntentCategory values to activation context strings

export const INTENT_TO_ACTIVATION: Record<string, string[]> = {
  "token-update":       ["always", "component-creation"],
  "component-create":   ["always", "component-creation", "design-creation", "library-creation"],
  "component-modify":   ["always", "component-creation"],
  "page-layout":        ["always", "design-creation", "prototype-creation"],
  "dataviz-create":     ["always", "research-to-dashboard"],
  "theme-change":       ["always", "component-creation"],
  "spacing-system":     ["always", "component-creation"],
  "typography-system":  ["always", "component-creation"],
  "color-palette":      ["always", "component-creation"],
  "figma-sync":         ["always", "figma-canvas-operation", "library-creation", "prototype-creation"],
  "code-generate":      ["always", "component-creation", "library-creation"],
  "design-audit":       ["always", "design-review"],
  "design-system-init": ["always", "component-creation", "design-creation", "library-creation"],
  "responsive-layout":  ["always", "design-creation", "prototype-creation"],
  "accessibility-check":["always", "design-review"],
  "multi-agent":        ["always", "multi-instance"],
  "docker-setup":       ["always", "docker-environment"],
  "general":            ["always"],
};
