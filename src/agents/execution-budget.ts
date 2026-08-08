import type { FrontendTaskContractV1 } from "../frontend/task-contract.js";

export type ExecutionBudgetCeilings = FrontendTaskContractV1["resourceCeilings"];

export type ExecutionBudgetDimension =
  | "input-tokens"
  | "output-tokens"
  | "reasoning-tokens"
  | "tool-calls"
  | "wall-time";

export type ExecutionBudgetStopReason =
  | "token-budget-exhausted"
  | "tool-budget-exhausted"
  | "time-budget-exhausted"
  | "attempt-limit-reached";

export type MeasurementStatus = "measured" | "unavailable";

export interface ExecutionBudgetUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly reasoningTokens: number;
  readonly toolCalls: number;
}

export type ExecutionAttemptOutcome =
  | "completed"
  | "retryable-failure"
  | "fatal-failure"
  | "timed-out";

export type ExecutionRetryReason =
  | "provider-transient"
  | "tool-transient"
  | "verification-actionable"
  | "missing-skill-context"
  | "harness-recovery";

export interface ExecutionBudgetAttempt {
  readonly attemptId: string;
  readonly startedAt: string;
  readonly completedAt: string;
  readonly outcome: ExecutionAttemptOutcome;
  readonly usage: ExecutionBudgetUsage;
}

export interface ExecutionBudgetRetry {
  readonly retryId: string;
  readonly afterAttemptId: string;
  readonly requestedAt: string;
  readonly reason: ExecutionRetryReason;
}

export interface ExecutionBudgetReport {
  readonly ceilings: ExecutionBudgetCeilings;
  readonly observed: ExecutionBudgetUsage & { readonly wallTimeMs: number };
  readonly measurement: {
    readonly inputTokens: MeasurementStatus;
    readonly outputTokens: MeasurementStatus;
    readonly reasoningTokens: MeasurementStatus;
    readonly toolCalls: MeasurementStatus;
  };
  readonly implementationAttempts: number;
  readonly attempts: readonly ExecutionBudgetAttempt[];
  readonly retries: readonly ExecutionBudgetRetry[];
  readonly exceededDimensions: readonly ExecutionBudgetDimension[];
  readonly stopReason: ExecutionBudgetStopReason | null;
  readonly limitations: readonly ExecutionBudgetLimitation[];
}

export type ExecutionBudgetLimitation =
  | "provider-request-cancellation-unavailable"
  | "input-token-usage-unavailable"
  | "output-token-usage-unavailable"
  | "reasoning-token-usage-unavailable"
  | "tool-call-usage-unavailable";

interface ActiveAttempt {
  readonly attemptId: string;
  readonly startedAt: string;
  readonly baseline: ExecutionBudgetUsage;
}

export class ExecutionBudgetExceededError extends Error {
  readonly stopReason: ExecutionBudgetStopReason;
  readonly exceededDimensions: readonly ExecutionBudgetDimension[];

  constructor(
    stopReason: ExecutionBudgetStopReason,
    exceededDimensions: readonly ExecutionBudgetDimension[],
  ) {
    super(`Execution budget exhausted: ${exceededDimensions.join(", ") || stopReason}`);
    this.name = "ExecutionBudgetExceededError";
    this.stopReason = stopReason;
    this.exceededDimensions = Object.freeze([...exceededDimensions]);
  }
}

/**
 * Enforces the measurable AgentOrchestrator boundary for one contracted run.
 *
 * The current AIClient API does not accept an AbortSignal, so timeout aborts
 * stop orchestration, retries, and pre-mutation application but cannot cancel
 * an already-issued provider HTTP request. That boundary is recorded in every
 * report instead of claiming provider cancellation that did not occur.
 */
export class ExecutionBudgetGuard {
  readonly ceilings: ExecutionBudgetCeilings;
  readonly signal: AbortSignal;
  private readonly controller = new AbortController();
  private readonly startedAtMs: number;
  private observed: ExecutionBudgetUsage = zeroUsage();
  private measurement = {
    inputTokens: "measured" as MeasurementStatus,
    outputTokens: "measured" as MeasurementStatus,
    reasoningTokens: "unavailable" as MeasurementStatus,
    toolCalls: "measured" as MeasurementStatus,
  };
  private readonly explicitlyUnavailableMeasurements = new Set<
    "inputTokens" | "outputTokens" | "reasoningTokens" | "toolCalls"
  >();
  private implementationAttempts = 0;
  private activeAttempt: ActiveAttempt | null = null;
  private attempts: readonly ExecutionBudgetAttempt[] = [];
  private retries: readonly ExecutionBudgetRetry[] = [];
  private stopReason: ExecutionBudgetStopReason | null = null;
  private timedOut = false;
  private providerUsageBaseline: Pick<ExecutionBudgetUsage, "inputTokens" | "outputTokens"> | null = null;

  constructor(ceilings: ExecutionBudgetCeilings) {
    this.ceilings = Object.freeze({ ...ceilings });
    this.signal = this.controller.signal;
    this.startedAtMs = Date.now();
  }

  get maximumImplementationAttempts(): 1 | 2 {
    return this.ceilings.implementationAttempts;
  }

  get remainingOutputTokens(): number {
    return Math.max(0, this.ceilings.outputTokens - this.observed.outputTokens);
  }

  recordImplementationAttempt(attempt: number): void {
    this.implementationAttempts = Math.max(this.implementationAttempts, attempt);
  }

  startImplementationAttempt(attempt: number): void {
    if (!Number.isSafeInteger(attempt) || attempt < 1 || attempt > this.ceilings.implementationAttempts) {
      throw new Error("Implementation attempt exceeds the contracted ceiling");
    }
    if (this.activeAttempt) {
      throw new Error(`Implementation attempt ${this.activeAttempt.attemptId} is still active`);
    }
    if (this.attempts.length !== attempt - 1) {
      throw new Error("Implementation attempts must be started in chronological order");
    }
    this.recordImplementationAttempt(attempt);
    this.activeAttempt = Object.freeze({
      attemptId: `attempt-${attempt}`,
      startedAt: new Date().toISOString(),
      baseline: Object.freeze({ ...this.observed }),
    });
  }

  finishImplementationAttempt(attempt: number, outcome: ExecutionAttemptOutcome): void {
    const active = this.activeAttempt;
    if (!active || active.attemptId !== `attempt-${attempt}`) {
      throw new Error(`Implementation attempt ${attempt} is not active`);
    }
    this.attempts = Object.freeze([...this.attempts, Object.freeze({
      attemptId: active.attemptId,
      startedAt: active.startedAt,
      completedAt: new Date().toISOString(),
      outcome,
      usage: Object.freeze(subtractUsage(this.observed, active.baseline)),
    })]);
    this.activeAttempt = null;
  }

  recordRetry(afterAttempt: number, reason: ExecutionRetryReason): void {
    const preceding = this.attempts.at(-1);
    if (!preceding || preceding.attemptId !== `attempt-${afterAttempt}`) {
      throw new Error(`Retry must follow completed implementation attempt ${afterAttempt}`);
    }
    if (preceding.outcome !== "retryable-failure") {
      throw new Error("Only a retryable failure may be retried");
    }
    if (this.retries.length >= this.ceilings.implementationAttempts - 1) {
      throw new Error("Retry exceeds the contracted implementation-attempt ceiling");
    }
    this.retries = Object.freeze([...this.retries, Object.freeze({
      retryId: `retry-${this.retries.length + 1}`,
      afterAttemptId: preceding.attemptId,
      requestedAt: new Date().toISOString(),
      reason,
    })]);
  }

  registerProviderUsageBaseline(
    usage: Pick<ExecutionBudgetUsage, "inputTokens" | "outputTokens">,
  ): void {
    if (this.providerUsageBaseline) return;
    this.providerUsageBaseline = {
      inputTokens: nonnegativeInteger(usage.inputTokens),
      outputTokens: nonnegativeInteger(usage.outputTokens),
    };
  }

  observeProviderUsageTotals(
    usage: Pick<ExecutionBudgetUsage, "inputTokens" | "outputTokens">,
  ): void {
    const totals = {
      inputTokens: nonnegativeInteger(usage.inputTokens),
      outputTokens: nonnegativeInteger(usage.outputTokens),
    };
    this.registerProviderUsageBaseline(totals);
    const baseline = this.providerUsageBaseline!;
    this.observeUsage({
      inputTokens: Math.max(0, totals.inputTokens - baseline.inputTokens),
      outputTokens: Math.max(0, totals.outputTokens - baseline.outputTokens),
      reasoningTokens: 0,
      toolCalls: 0,
    }, { reasoningTokens: "unavailable", toolCalls: "measured" });
  }

  markAttemptLimitReached(): void {
    if (this.stopReason === null) this.stopReason = "attempt-limit-reached";
  }

  markMeasurementUnavailable(
    dimension: "inputTokens" | "outputTokens" | "reasoningTokens" | "toolCalls",
  ): void {
    this.explicitlyUnavailableMeasurements.add(dimension);
    this.measurement = { ...this.measurement, [dimension]: "unavailable" };
  }

  observeUsage(
    usage: ExecutionBudgetUsage,
    measurement: {
      readonly inputTokens?: MeasurementStatus;
      readonly outputTokens?: MeasurementStatus;
      readonly reasoningTokens: MeasurementStatus;
      readonly toolCalls: MeasurementStatus;
    },
  ): void {
    this.observed = {
      inputTokens: nonnegativeInteger(usage.inputTokens),
      outputTokens: nonnegativeInteger(usage.outputTokens),
      reasoningTokens: nonnegativeInteger(usage.reasoningTokens),
      toolCalls: nonnegativeInteger(usage.toolCalls),
    };
    this.measurement = {
      inputTokens: this.measurementStatus("inputTokens", measurement.inputTokens ?? "measured"),
      outputTokens: this.measurementStatus("outputTokens", measurement.outputTokens ?? "measured"),
      reasoningTokens: this.measurementStatus("reasoningTokens", measurement.reasoningTokens),
      toolCalls: this.measurementStatus("toolCalls", measurement.toolCalls),
    };
  }

  assertWithinLimits(): void {
    const exceeded = this.exceededDimensions();
    if (exceeded.length === 0) return;
    const stopReason = exceeded.some((dimension) => dimension.endsWith("tokens"))
      ? "token-budget-exhausted"
      : exceeded.includes("tool-calls")
        ? "tool-budget-exhausted"
        : "time-budget-exhausted";
    this.stopReason = stopReason;
    throw new ExecutionBudgetExceededError(stopReason, exceeded);
  }

  async runWithinWallTime<T>(operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const remainingMs = Math.max(1, this.ceilings.wallTimeMs - this.elapsedMs());
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(() => {
        this.timedOut = true;
        this.stopReason = "time-budget-exhausted";
        const error = new ExecutionBudgetExceededError(
          "time-budget-exhausted",
          ["wall-time"],
        );
        this.controller.abort(error);
        reject(error);
      }, remainingMs);
    });
    const running = Promise.resolve().then(() => operation(this.signal));
    // The provider request may settle after the orchestration timeout. Attach a
    // handler now so that late rejection cannot become an unhandled rejection.
    void running.catch(() => undefined);
    try {
      const result = await Promise.race([running, timeout]);
      this.assertWithinLimits();
      return result;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  report(): Readonly<ExecutionBudgetReport> {
    const limitations: ExecutionBudgetLimitation[] = [
      "provider-request-cancellation-unavailable",
    ];
    if (this.measurement.reasoningTokens === "unavailable") {
      limitations.push("reasoning-token-usage-unavailable");
    }
    if (this.measurement.toolCalls === "unavailable") {
      limitations.push("tool-call-usage-unavailable");
    }
    if (this.measurement.inputTokens === "unavailable") {
      limitations.push("input-token-usage-unavailable");
    }
    if (this.measurement.outputTokens === "unavailable") {
      limitations.push("output-token-usage-unavailable");
    }
    const attempts = this.reportAttempts();
    return Object.freeze({
      ceilings: Object.freeze({ ...this.ceilings }),
      observed: Object.freeze({
        ...this.observed,
        wallTimeMs: this.elapsedMs(),
      }),
      measurement: Object.freeze({ ...this.measurement }),
      implementationAttempts: this.implementationAttempts,
      attempts,
      retries: Object.freeze([...this.retries]),
      exceededDimensions: Object.freeze(this.exceededDimensions()),
      stopReason: this.stopReason,
      limitations: Object.freeze(limitations),
    });
  }

  private elapsedMs(): number {
    return this.timedOut
      ? this.ceilings.wallTimeMs
      : Math.max(0, Date.now() - this.startedAtMs);
  }

  private exceededDimensions(): ExecutionBudgetDimension[] {
    const exceeded: ExecutionBudgetDimension[] = [];
    if (
      this.measurement.inputTokens === "measured"
      && this.observed.inputTokens > this.ceilings.inputTokens
    ) exceeded.push("input-tokens");
    if (
      this.measurement.outputTokens === "measured"
      && this.observed.outputTokens > this.ceilings.outputTokens
    ) exceeded.push("output-tokens");
    if (
      this.measurement.reasoningTokens === "measured"
      && this.observed.reasoningTokens > this.ceilings.reasoningTokens
    ) exceeded.push("reasoning-tokens");
    if (
      this.measurement.toolCalls === "measured"
      && this.observed.toolCalls > this.ceilings.toolCalls
    ) exceeded.push("tool-calls");
    if (this.timedOut || this.elapsedMs() > this.ceilings.wallTimeMs) exceeded.push("wall-time");
    return exceeded;
  }

  private reportAttempts(): readonly ExecutionBudgetAttempt[] {
    if (!this.activeAttempt) return Object.freeze([...this.attempts]);
    return Object.freeze([...this.attempts, Object.freeze({
      attemptId: this.activeAttempt.attemptId,
      startedAt: this.activeAttempt.startedAt,
      completedAt: new Date().toISOString(),
      outcome: this.timedOut ? "timed-out" : "fatal-failure",
      usage: Object.freeze(subtractUsage(this.observed, this.activeAttempt.baseline)),
    })]);
  }

  private measurementStatus(
    dimension: "inputTokens" | "outputTokens" | "reasoningTokens" | "toolCalls",
    next: MeasurementStatus,
  ): MeasurementStatus {
    return this.explicitlyUnavailableMeasurements.has(dimension) ? "unavailable" : next;
  }
}

function nonnegativeInteger(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error("Execution budget usage must be a nonnegative safe integer");
  }
  return value;
}

function zeroUsage(): ExecutionBudgetUsage {
  return { inputTokens: 0, outputTokens: 0, reasoningTokens: 0, toolCalls: 0 };
}

function subtractUsage(
  total: ExecutionBudgetUsage,
  baseline: ExecutionBudgetUsage,
): ExecutionBudgetUsage {
  return {
    inputTokens: Math.max(0, total.inputTokens - baseline.inputTokens),
    outputTokens: Math.max(0, total.outputTokens - baseline.outputTokens),
    reasoningTokens: Math.max(0, total.reasoningTokens - baseline.reasoningTokens),
    toolCalls: Math.max(0, total.toolCalls - baseline.toolCalls),
  };
}
