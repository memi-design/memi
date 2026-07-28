/**
 * DesignAnalyzer — AI-powered visual analysis of Figma screenshots.
 *
 * Uses Claude's vision capability to analyze design quality, consistency,
 * accessibility, and spec compliance from captured screenshots.
 */

import { z } from "zod";
import { createLogger } from "../engine/logger.js";
import type { AIClient } from "../ai/types.js";
import type { DesignSystem } from "../engine/registry.js";

const log = createLogger("design-analyzer");

// ── Analysis Schemas ──────────────────────────────────────

export const VisualIssueSchema = z.object({
  severity: z.enum(["critical", "major", "minor", "suggestion"]),
  category: z.enum([
    "spacing", "alignment", "typography", "color", "contrast",
    "hierarchy", "consistency", "accessibility", "layout", "interaction",
  ]),
  description: z.string(),
  location: z.string().optional(),
  fix: z.string().optional(),
});

export const DesignAnalysisSchema = z.object({
  score: z.number().min(0).max(100),
  summary: z.string(),
  issues: z.array(VisualIssueSchema),
  strengths: z.array(z.string()),
  specCompliance: z.object({
    matches: z.boolean(),
    deviations: z.array(z.string()),
  }).optional(),
});

export type VisualIssue = z.infer<typeof VisualIssueSchema>;
export type DesignAnalysis = z.infer<typeof DesignAnalysisSchema>;

// ── Prompts ───────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a senior design system engineer reviewing UI screenshots. Analyze with precision.

Score 0-100 based on:
- Visual consistency (spacing, alignment, rhythm)
- Typography hierarchy (size, weight, contrast between levels)
- Color usage (semantic correctness, accessible contrast)
- Layout quality (responsive-ready, proper containment)
- Accessibility (touch targets, focus indicators, text readability)

Be specific about locations. "Top-left card" not "the card". Include concrete fixes.`;

const SPEC_COMPLIANCE_PROMPT = `You are reviewing a UI screenshot against a component specification.

Check:
1. Do the rendered props match the spec's prop definitions?
2. Are the correct shadcn/ui base components used?
3. Do variants render distinct visual states?
4. Are accessibility attributes visible (focus rings, aria labels)?
5. Does the layout match the spec's atomic design level?

Return deviations as specific, actionable items.`;

const ACCESSIBILITY_PROMPT = `You are a WCAG 2.2 accessibility auditor reviewing a UI screenshot.

Check:
1. Color contrast — can all text be read against its background?
2. Touch targets — are interactive elements at least 44x44px?
3. Focus indicators — are focus rings visible on interactive elements?
4. Text sizing — is body text at least 16px equivalent?
5. Hierarchy — do heading sizes decrease predictably (h1 > h2 > h3)?
6. Icon-only buttons — do they have text alternatives?
7. Color-independence — is information conveyed by more than color alone?

Score severity: critical (blocker), major (should fix), minor (nice to fix), suggestion.`;

// ── DesignAnalyzer ────────────────────────────────────────

export class DesignAnalyzer {
  private ai: AIClient;

  constructor(ai: AIClient) {
    this.ai = ai;
  }

  /**
   * General design quality analysis of a screenshot.
   */
  async analyzeDesign(imageBase64: string, context?: string): Promise<DesignAnalysis> {
    const prompt = context
      ? `Analyze this UI design. Context: ${context}`
      : "Analyze this UI design for quality, consistency, and accessibility.";

    return this.ai.visionJSON<DesignAnalysis>({
      system: SYSTEM_PROMPT,
      prompt,
      imageBase64,
      schema: DesignAnalysisSchema,
    });
  }

  /**
   * Check a screenshot against a component/page spec.
   */
  async checkSpecCompliance(
    imageBase64: string,
    specJson: string,
    designSystem?: DesignSystem,
  ): Promise<DesignAnalysis> {
    let prompt = `Analyze this screenshot against the following spec:\n\n${specJson}`;
    if (designSystem) {
      const tokenSummary = designSystem.tokens.slice(0, 20).map(t => `${t.name}: ${JSON.stringify(t.values)}`).join("\n");
      prompt += `\n\nDesign tokens:\n${tokenSummary}`;
    }

    return this.ai.visionJSON<DesignAnalysis>({
      system: SPEC_COMPLIANCE_PROMPT,
      prompt,
      imageBase64,
      schema: DesignAnalysisSchema,
    });
  }

  /**
   * WCAG 2.2 accessibility audit of a screenshot.
   */
  async auditAccessibility(imageBase64: string): Promise<DesignAnalysis> {
    return this.ai.visionJSON<DesignAnalysis>({
      system: ACCESSIBILITY_PROMPT,
      prompt: "Audit this UI screenshot for WCAG 2.2 accessibility compliance.",
      imageBase64,
      schema: DesignAnalysisSchema,
    });
  }

  /**
   * Compare two screenshots (before/after) and report changes.
   */
  async compareScreenshots(
    beforeBase64: string,
    afterBase64: string,
    context?: string,
  ): Promise<DesignAnalysis> {
    const prompt = context
      ? `Compare these two UI screenshots. Context: ${context}\n\nFirst image is BEFORE, second is AFTER. Identify improvements and regressions.`
      : "Compare these two UI screenshots. First is BEFORE, second is AFTER. Identify improvements and regressions.";

    return this.ai.visionJSON<DesignAnalysis>({
      system: SYSTEM_PROMPT,
      prompt,
      imageBase64: beforeBase64,
      schema: DesignAnalysisSchema,
      // Note: for dual-image comparison, the caller should construct the
      // multimodal message manually. This is a simplified single-image version.
    });
  }
}
