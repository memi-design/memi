/**
 * Note Resolver — Given an intent category, resolves which Notes
 * should activate and builds the prompt injection block.
 *
 * This is the brain that connects the Note ecosystem to the agent
 * orchestrator. When the orchestrator classifies an intent, the
 * resolver determines which installed Notes are relevant and
 * concatenates their skill markdown into a prompt block.
 */

import { readFile } from "fs/promises";
import { join } from "path";
import { createLogger } from "../engine/logger.js";
import {
  INTENT_TO_ACTIVATION,
  type InstalledNote,
  type ResolvedSkill,
} from "./types.js";

const log = createLogger("notes-resolver");

/** Maximum characters of skill content to inject into a single prompt. */
const MAX_SKILL_CHARS = 8000;

/**
 * Resolve which skills should activate for a given intent category.
 */
export async function resolveForIntent(
  intentCategory: string,
  notes: InstalledNote[],
): Promise<ResolvedSkill[]> {
  const activationContexts = INTENT_TO_ACTIVATION[intentCategory] ?? ["always"];
  const resolved: ResolvedSkill[] = [];

  for (const note of notes) {
    if (!note.enabled) continue;

    for (const skill of note.manifest.skills) {
      // Match if the skill's activateOn is in the set of valid contexts
      if (activationContexts.includes(skill.activateOn) || skill.activateOn === "always") {
        try {
          const filePath = join(note.path, skill.file);

          const content = await readFile(filePath, "utf-8");

          resolved.push({
            noteId: note.manifest.name,
            skillName: skill.name,
            file: filePath,
            content,
            activateOn: skill.activateOn,
            freedomLevel: skill.freedomLevel,
          });
        } catch (err) {
          log.warn({ noteId: note.manifest.name, file: skill.file, err }, "Could not load skill file");
        }
      }
    }
  }

  // Sort: "always" notes first, then by freedom level (maximum > high > read-only > reference)
  const freedomOrder = { maximum: 0, high: 1, "read-only": 2, reference: 3 };
  resolved.sort((a, b) => {
    const aAlways = a.activateOn === "always" ? 0 : 1;
    const bAlways = b.activateOn === "always" ? 0 : 1;
    if (aAlways !== bAlways) return aAlways - bAlways;
    return (freedomOrder[a.freedomLevel] ?? 9) - (freedomOrder[b.freedomLevel] ?? 9);
  });

  log.info({ intentCategory, resolved: resolved.length }, "Resolved skills for intent");
  return resolved;
}

/**
 * Build a prompt injection block from resolved skills.
 * Truncates if the combined content exceeds MAX_SKILL_CHARS.
 */
export function buildSkillPromptBlock(resolved: readonly ResolvedSkill[]): string {
  if (resolved.length === 0) return "";

  const sections: string[] = [];
  let totalChars = 0;

  for (const skill of resolved) {
    const section = `### ${skill.skillName} (${skill.noteId})\n${skill.content}`;

    if (totalChars + section.length > MAX_SKILL_CHARS) {
      sections.push(`\n... (${resolved.length - sections.length} more notes available — run \`memi notes list\` to see all)`);
      break;
    }

    sections.push(section);
    totalChars += section.length;
  }

  return `## Active Mémoire Notes\n\n${sections.join("\n\n---\n\n")}`;
}

/**
 * Wrap a base prompt with resolved skill content.
 * Used by the agent prompt system to inject Note knowledge.
 */
export function wrapWithNotes(basePrompt: string, resolved: readonly ResolvedSkill[]): string {
  const block = buildSkillPromptBlock(resolved);
  if (!block) return basePrompt;
  return `${block}\n\n---\n\n${basePrompt}`;
}
