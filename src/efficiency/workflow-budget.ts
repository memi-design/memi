export interface WorkflowAgentBudget {
  readonly maxToolCalls: number;
  readonly maxToolOutputBytes?: number;
  readonly maxInputTokens: number;
  readonly maxOutputTokens: number;
  readonly maxReasoningTokens: number;
}

export interface WorkflowBudgetAssessment {
  readonly withinBudget: boolean;
  readonly exceeded: readonly WorkflowBudgetDimension[];
  readonly observed: {
    readonly toolCalls: number;
    readonly toolOutputBytes: number;
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly reasoningTokens: number;
  };
}

export type WorkflowBudgetDimension =
  | "max-tool-calls"
  | "max-tool-output-bytes"
  | "max-input-tokens"
  | "max-output-tokens"
  | "max-reasoning-tokens";

export function assessWorkflowBudget(
  budget: WorkflowAgentBudget,
  result: {
    readonly usage: {
      readonly inputTokens: number;
      readonly outputTokens: number;
      readonly reasoningTokens: number;
    };
    readonly tools: { readonly calls: number; readonly outputBytes?: number };
  },
): Readonly<WorkflowBudgetAssessment> {
  const observed = {
    toolCalls: result.tools.calls,
    toolOutputBytes: result.tools.outputBytes ?? 0,
    inputTokens: result.usage.inputTokens,
    outputTokens: result.usage.outputTokens,
    reasoningTokens: result.usage.reasoningTokens,
  };
  const exceeded: WorkflowBudgetDimension[] = [];
  if (observed.toolCalls > budget.maxToolCalls) exceeded.push("max-tool-calls");
  if (
    budget.maxToolOutputBytes !== undefined
    && observed.toolOutputBytes > budget.maxToolOutputBytes
  ) {
    exceeded.push("max-tool-output-bytes");
  }
  if (observed.inputTokens > budget.maxInputTokens) exceeded.push("max-input-tokens");
  if (observed.outputTokens > budget.maxOutputTokens) exceeded.push("max-output-tokens");
  if (observed.reasoningTokens > budget.maxReasoningTokens) {
    exceeded.push("max-reasoning-tokens");
  }
  return freeze({
    withinBudget: exceeded.length === 0,
    exceeded,
    observed,
  });
}

function freeze<T>(value: T): Readonly<T> {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) {
      freeze(child);
    }
    Object.freeze(value);
  }
  return value;
}
