/**
 * Token Tracker — Per-session usage tracking and cost estimation.
 */

import type { TokenUsage, ModelTier } from "./types.js";
import { estimateCost } from "./model-config.js";
import { writeFile, mkdir } from "fs/promises";
import { join } from "path";

interface UsageEntry {
  timestamp: string;
  model: string;
  tier: ModelTier;
  input: number;
  output: number;
  cost: number | null;
}

export class TokenTracker {
  private entries: UsageEntry[] = [];

  record(usage: TokenUsage, tier: ModelTier, model: string, costOverride?: number | null): void {
    const cost = costOverride === undefined ? estimateCost(usage, tier) : costOverride;
    this.entries.push({
      timestamp: new Date().toISOString(),
      model,
      tier,
      input: usage.inputTokens,
      output: usage.outputTokens,
      cost,
    });
  }

  get totalInput(): number {
    return this.entries.reduce((s, e) => s + e.input, 0);
  }

  get totalOutput(): number {
    return this.entries.reduce((s, e) => s + e.output, 0);
  }

  get totalCost(): number {
    return this.entries.reduce((sum, entry) => sum + (entry.cost ?? 0), 0);
  }

  get unpricedCallCount(): number {
    return this.entries.filter((entry) => entry.cost === null).length;
  }

  get isCostComplete(): boolean {
    return this.unpricedCallCount === 0;
  }

  get callCount(): number {
    return this.entries.length;
  }

  get summary(): string {
    if (this.entries.length === 0) return "No AI calls made";
    const usage = `${this.callCount} calls | ${this.totalInput.toLocaleString()} in + ${this.totalOutput.toLocaleString()} out`;
    if (!this.isCostComplete && this.totalCost === 0) return `${usage} | cost unknown`;
    if (!this.isCostComplete) return `${usage} | ~$${this.totalCost.toFixed(4)} known + ${this.unpricedCallCount} unpriced`;
    return `${usage} | ~$${this.totalCost.toFixed(4)}`;
  }

  async persist(projectRoot: string): Promise<void> {
    if (this.entries.length === 0) return;
    const dir = join(projectRoot, ".noche");
    await mkdir(dir, { recursive: true });
    const path = join(dir, "ai-usage.json");

    let existing: UsageEntry[] = [];
    try {
      const { readFileSync } = await import("fs");
      const raw = readFileSync(path, "utf-8");
      existing = JSON.parse(raw);
    } catch {
      // No existing file
    }

    const combined = [...existing, ...this.entries];
    await writeFile(path, JSON.stringify(combined, null, 2));
  }
}
