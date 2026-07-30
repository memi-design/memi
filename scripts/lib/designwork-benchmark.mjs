import { createHash } from "node:crypto";
import { access, readFile } from "node:fs/promises";
import path from "node:path";

const SPLITS = new Set(["publicDevelopment", "privateTest", "rollingHoldout"]);
const EVIDENCE_CAPS = Object.freeze({
  absent: 0,
  prompt_only: 25,
  implemented_tested: 65,
  runtime_reproduced: 100,
  independently_validated: 100,
});

const DIMENSIONS = Object.freeze([
  "problem-framing",
  "evidence-judgment",
  "craft",
  "interaction-behavior",
  "system-platform-fidelity",
  "accessibility-safety-ethics",
  "technical-runtime-quality",
  "validation",
  "handoff-collaboration",
  "critique-recovery",
]);

const MODES = Object.freeze([
  {
    id: "critique-diagnose",
    durationMinutes: 30,
    complexity: "scoped",
    instruction: "Diagnose the supplied work, identify the highest-risk failures, and produce a prioritized correction plan",
  },
  {
    id: "create",
    durationMinutes: 60,
    complexity: "system",
    instruction: "Create the requested work from the evidence pack and deliver editable source plus a verified output",
  },
  {
    id: "modify-in-context",
    durationMinutes: 75,
    complexity: "system",
    instruction: "Modify the existing product without collateral redesign, preserving its authentic system and behavior",
  },
  {
    id: "validate-handoff",
    durationMinutes: 60,
    complexity: "cross-functional",
    instruction: "Validate the work end to end, repair material defects, and prepare a handoff another practitioner can continue",
  },
  {
    id: "capstone-recovery",
    durationMinutes: 120,
    complexity: "long-horizon",
    instruction: "Complete the end-to-end assignment, respond to an interruption and changed constraint, then recover without discarding valid work",
  },
]);

const TRACKS = Object.freeze([
  track({
    id: "product-design",
    title: "Product design",
    contexts: ["activation journey", "complex account workflow", "multi-sided marketplace", "safety-sensitive decision flow"],
    artifacts: ["research-synthesis", "journey-map", "information-architecture", "interactive-prototype", "success-metrics"],
    runners: ["browser-playwright", "artifact-validator"],
    control: "unsupported-user-need",
    weights: [16, 16, 10, 10, 7, 9, 6, 10, 8, 8],
  }),
  track({
    id: "graphic-brand-design",
    title: "Graphic and brand design",
    contexts: ["editorial launch system", "public-information campaign", "data-rich annual report", "multi-format identity rollout"],
    artifacts: ["layered-source", "vector-export", "typography-specimen", "production-exports", "brand-rationale"],
    runners: ["figma-editable", "artifact-validator"],
    control: "artifact-flattening",
    weights: [10, 10, 24, 4, 8, 8, 10, 10, 8, 8],
  }),
  track({
    id: "motion-design",
    title: "Motion design",
    contexts: ["product onboarding sequence", "data-story animation", "campaign title system", "interaction motion language"],
    artifacts: ["storyboard", "motion-spec", "editable-timeline", "rendered-video", "reduced-motion-alternative"],
    runners: ["motion-render", "artifact-validator"],
    control: "unsafe-motion",
    weights: [8, 8, 18, 16, 8, 12, 12, 6, 5, 7],
  }),
  track({
    id: "spatial-xr",
    title: "Spatial, AR, and VR design",
    contexts: ["shared spatial workspace", "room-scale learning experience", "AR field-service overlay", "immersive data exploration"],
    artifacts: ["spatial-flow", "scene-source", "interaction-map", "comfort-safety-report", "runtime-capture"],
    runners: ["spatial-xr-runtime", "artifact-validator"],
    control: "spatial-comfort-failure",
    weights: [8, 8, 12, 14, 12, 18, 12, 5, 5, 6],
  }),
  track({
    id: "agentic-design",
    title: "Agentic design",
    contexts: ["human-agent code review", "delegated design-system repair", "multi-agent research synthesis", "high-risk autonomous workflow"],
    artifacts: ["control-model", "permission-policy", "reviewable-patch", "agent-trace", "recovery-report"],
    runners: ["browser-playwright", "artifact-validator"],
    control: "silent-agent-overwrite",
    weights: [10, 10, 8, 15, 10, 12, 15, 6, 7, 7],
  }),
  track({
    id: "ios-swiftui",
    title: "iOS and SwiftUI",
    contexts: ["native account recovery", "media-rich detail flow", "offline-first tracker", "Dynamic Type settings experience"],
    artifacts: ["xcode-source", "simulator-build", "ui-test-results", "accessibility-capture", "performance-trace"],
    runners: ["ios-simulator", "artifact-validator"],
    control: "non-native-web-substitution",
    weights: [7, 7, 10, 14, 16, 12, 18, 6, 5, 5],
  }),
  track({
    id: "cross-platform-mobile",
    title: "Cross-platform mobile and Expo",
    contexts: ["authenticated social feed", "gesture-driven media flow", "offline event companion", "native-module notification flow"],
    artifacts: ["expo-source", "ios-runtime-capture", "android-runtime-capture", "e2e-results", "release-notes"],
    runners: ["expo-device", "android-emulator", "ios-simulator"],
    control: "single-platform-proof",
    weights: [8, 8, 10, 14, 14, 12, 18, 6, 5, 5],
  }),
  track({
    id: "android-compose",
    title: "Android and Jetpack Compose",
    contexts: ["Material 3 account flow", "adaptive foldable workspace", "predictive-back navigation", "offline-first media library"],
    artifacts: ["android-studio-source", "emulator-build", "compose-ui-tests", "accessibility-capture", "performance-trace"],
    runners: ["android-emulator", "artifact-validator"],
    control: "non-native-web-substitution",
    weights: [7, 7, 10, 14, 16, 12, 18, 6, 5, 5],
  }),
  track({
    id: "native-design-kits",
    title: "Native design kits",
    contexts: ["Apple platform component library", "Material 3 adaptive kit", "desktop productivity kit", "spatial component kit"],
    artifacts: ["component-library", "token-library", "behavior-spec", "platform-mapping", "adoption-guide"],
    runners: ["figma-editable", "artifact-validator"],
    control: "platform-pattern-flattening",
    weights: [8, 8, 16, 10, 18, 12, 12, 6, 6, 4],
  }),
  track({
    id: "design-systems",
    title: "Design systems",
    contexts: ["multi-brand token migration", "component-variant consolidation", "code-and-design synchronization", "governed accessibility remediation"],
    artifacts: ["token-graph", "component-library", "migration-plan", "code-connect-map", "governance-report"],
    runners: ["figma-editable", "browser-playwright", "artifact-validator"],
    control: "duplicate-component-debt",
    weights: [10, 10, 15, 8, 15, 10, 12, 8, 7, 5],
  }),
  track({
    id: "design-engineering",
    title: "Design engineering",
    contexts: ["data-dense dashboard", "production command interface", "responsive commerce workflow", "canvas-based editor"],
    artifacts: ["production-source", "runtime-build", "e2e-results", "visual-regression", "performance-report"],
    runners: ["browser-playwright", "artifact-validator"],
    control: "frontend-backend-decoupling",
    weights: [8, 8, 12, 12, 12, 10, 20, 8, 5, 5],
  }),
  track({
    id: "service-design",
    title: "Service design",
    contexts: ["healthcare referral service", "public-benefit application", "returns and recovery service", "cross-channel onboarding service"],
    artifacts: ["service-blueprint", "end-to-end-journey", "operating-model", "failure-demand-analysis", "measurement-plan"],
    runners: ["artifact-validator"],
    control: "digital-only-service-substitution",
    weights: [18, 18, 8, 8, 8, 12, 4, 10, 8, 6],
  }),
  track({
    id: "content-design",
    title: "Content design",
    contexts: ["high-stakes eligibility flow", "multilingual account recovery", "complex product onboarding", "error and support content system"],
    artifacts: ["content-model", "content-journey", "production-copy", "localization-plan", "governance-guide"],
    runners: ["browser-playwright", "artifact-validator"],
    control: "placeholder-copy-substitution",
    weights: [16, 18, 18, 6, 8, 14, 4, 8, 5, 3],
  }),
  track({
    id: "interaction-prototyping",
    title: "Interaction design and prototyping",
    contexts: ["keyboard-first command flow", "touch-and-gesture creation flow", "multi-step error recovery", "collaborative editing flow"],
    artifacts: ["state-model", "interactive-prototype", "input-map", "usability-findings", "handoff-spec"],
    runners: ["browser-playwright", "figma-editable", "artifact-validator"],
    control: "happy-path-only-prototype",
    weights: [10, 10, 10, 22, 10, 14, 10, 6, 4, 4],
  }),
  track({
    id: "research-evidence",
    title: "Research and evidence",
    contexts: ["discovery research", "evaluative usability study", "mixed-method product study", "longitudinal service study"],
    artifacts: ["research-plan", "instrument", "evidence-corpus", "synthesis", "decision-log"],
    runners: ["artifact-validator"],
    control: "unsupported-research-claim",
    weights: [16, 24, 6, 4, 4, 12, 6, 16, 6, 6],
  }),
]);

export function buildDesignWorkBenchmark(options = {}) {
  const frozenCommit = options.frozenCommit
    ?? "925deb1b23a2211743bcadaba70e1c1db5966375";
  const tasks = TRACKS.flatMap((entry) =>
    MODES.flatMap((mode, modeIndex) =>
      entry.contexts.map((context, contextIndex) =>
        buildTask(entry, mode, modeIndex, context, contextIndex))));
  const manifest = {
    schemaVersion: 2,
    benchmarkId: "memi-designworkbench-v2",
    title: "Memi DesignWorkBench v2: Multidisciplinary Senior Practice",
    status: "foundation",
    results: null,
    frozenCandidate: {
      version: "2.7.0",
      commit: frozenCommit,
      claim: "Memi provides repository-specific design intelligence; multidisciplinary senior performance remains unverified until calibration and private evaluation complete.",
    },
    protocol: {
      targetTasks: 300,
      taskSplit: {
        publicDevelopment: 60,
        privateTest: 180,
        rollingHoldout: 60,
      },
      conditions: ["baseline", "memi"],
      minimumIndependentRuns: 3,
      releaseCriticalRuns: 5,
      judgeBlinding: true,
      quarterlyHoldoutRotation: true,
      composite: "geometric_mean",
      efficiencyRole: "separate_pareto_metric",
    },
    dimensions: DIMENSIONS.map((id) => ({ id })),
    evidenceCaps: EVIDENCE_CAPS,
    tracks: TRACKS.map((entry) => ({
      id: entry.id,
      title: entry.title,
      artifactKinds: entry.artifacts,
      runnerProfileIds: entry.runners,
      rubric: entry.weights.map((weight, index) => ({
        dimensionId: DIMENSIONS[index],
        weight,
      })),
    })),
    taskModes: MODES.map(({ id, durationMinutes, complexity }) => ({
      id,
      durationMinutes,
      complexity,
    })),
    negativeControls: negativeControls(TRACKS),
    runnerProfiles: runnerProfiles(),
    calibration: {
      status: "pending_external_practitioners",
      evidenceFile: null,
      minimumPractitionersPerTrack: 4,
      minimumExternalPractitionersPerTrack: 2,
      minimumArtifactsPerPractitioner: 5,
      minimumRatingsPerArtifact: 2,
      overallReliabilityThreshold: 0.8,
      perTrackReliabilityFloor: 0.67,
      disagreementAdjudicationThreshold: 8,
      syntheticRatingsProhibited: true,
    },
    releaseGates: [
      { id: "fixture-integrity", requirement: "Every task and fixture hash is reproducible and private material remains undisclosed." },
      { id: "practitioner-calibration", requirement: "Every claimed track meets practitioner coverage and reliability thresholds." },
      { id: "quality-non-inferiority", requirement: "Memi quality lower confidence bounds are no worse than baseline." },
      { id: "no-weak-track-masking", requirement: "The geometric composite and every claimed track clear calibrated senior floors." },
      { id: "repeat-stability", requirement: "Release-critical holdouts pass five independent paired runs." },
      { id: "second-provider", requirement: "At least two provider harnesses complete valid paired runs." },
      { id: "honest-efficiency", requirement: "Efficiency remains separate and any percentage claim uses a positive lower 95% confidence bound." },
    ],
    tasks,
    references: references(),
  };
  return deepFreeze({
    ...manifest,
    integrity: {
      taskBankSha256: sha256(canonicalJson(tasks)),
      frozenCandidateSha256: sha256(canonicalJson(manifest.frozenCandidate)),
    },
  });
}

export async function validateDesignWorkBenchmark(manifest, options = {}) {
  const root = path.resolve(options.root ?? process.cwd());
  const failures = [];
  if (!isRecord(manifest)) return validationResult(manifest, ["benchmark manifest must be an object"]);
  if (manifest.schemaVersion !== 2) failures.push("schemaVersion must equal 2");
  requiredString(manifest, "benchmarkId", failures);
  requiredString(manifest, "title", failures);
  if (!["foundation", "calibration", "published"].includes(manifest.status)) {
    failures.push("status must be foundation, calibration, or published");
  }
  if (manifest.status === "published" && !isRecord(manifest.results)) {
    failures.push("published benchmark requires measured results");
  }
  if (!/^[a-f0-9]{40}$/.test(manifest.frozenCandidate?.commit ?? "")) {
    failures.push("frozen candidate requires a full 40-character commit");
  }
  validateProtocol(manifest.protocol, failures);
  validateTracks(manifest, failures);
  validateControls(manifest.negativeControls, failures);
  validateRunners(manifest.runnerProfiles, failures);
  validateTasks(manifest, failures);
  validateIntegrity(manifest, failures);
  await validateCalibration(manifest, root, failures);
  validateReleaseGates(manifest.releaseGates, failures);
  return validationResult(manifest, failures);
}

export function scoreProfessionalArtifact(input) {
  const dimensions = Array.isArray(input.dimensions) ? input.dimensions : [];
  const totalWeight = dimensions.reduce((sum, dimension) => sum + dimension.weight, 0);
  if (dimensions.length === 0 || Math.abs(totalWeight - 100) > 0.001) {
    throw new Error(`professional quality dimension weights must sum to 100, received ${totalWeight}`);
  }
  const cap = EVIDENCE_CAPS[input.evidenceLevel];
  if (cap === undefined) throw new Error(`unknown evidence level ${String(input.evidenceLevel)}`);
  const rawScore = dimensions.reduce(
    (sum, dimension) => sum + clampScore(dimension.score) * (dimension.weight / 100),
    0,
  );
  const penalties = (input.penalties ?? []).reduce(
    (sum, penalty) => sum + Math.max(0, Number(penalty.points ?? penalty)),
    0,
  );
  const acceptanceCap = input.accepted ? 100 : 49;
  const qualityScore = round(Math.max(0, Math.min(rawScore - penalties, cap, acceptanceCap)));
  return deepFreeze({
    accepted: Boolean(input.accepted),
    qualityScore,
    rawScore: round(rawScore),
    evidenceCap: cap,
    qualityStatus: qualityScore < round(Math.max(0, rawScore - penalties))
      ? "evidence_capped"
      : "assessed",
  });
}

export function geometricMean(scores) {
  if (!Array.isArray(scores) || scores.length === 0) return 0;
  const normalized = scores.map(clampScore);
  if (normalized.some((score) => score === 0)) return 0;
  return round(Math.exp(
    normalized.reduce((sum, score) => sum + Math.log(score), 0) / normalized.length,
  ));
}

export function buildCalibrationReadiness(manifest, artifacts) {
  const trackResults = (manifest.tracks ?? []).map((entry) => {
    const trackArtifacts = artifacts.filter((artifact) => artifact.trackId === entry.id);
    const qualified = trackArtifacts.filter((artifact) => artifact.qualified);
    const practitioners = new Set(qualified.map((artifact) => artifact.practitionerId));
    const external = new Set(qualified
      .filter((artifact) => artifact.external)
      .map((artifact) => artifact.practitionerId));
    const counts = new Map();
    for (const artifact of qualified) {
      counts.set(artifact.practitionerId, (counts.get(artifact.practitionerId) ?? 0) + 1);
    }
    const minimumArtifacts = practitioners.size === 0
      ? 0
      : Math.min(...[...practitioners].map((id) => counts.get(id) ?? 0));
    const ratingPairs = qualified.flatMap((artifact) => ratingPair(artifact.ratings));
    const reliability = agreementCoefficient(ratingPairs);
    const failures = [];
    if (practitioners.size < 4) failures.push(`${entry.id} requires at least 4 qualified practitioners`);
    if (external.size < 2) failures.push(`${entry.id} requires at least 2 external practitioners`);
    if (practitioners.size > 0 && minimumArtifacts < 5) {
      failures.push(`${entry.id} requires at least 5 artifacts per practitioner`);
    }
    if (qualified.some((artifact) => new Set(
      (artifact.ratings ?? []).map((rating) => rating.graderId),
    ).size < 2)) {
      failures.push(`${entry.id} requires two independent ratings per artifact`);
    }
    if (ratingPairs.length > 0 && reliability < 0.67) {
      failures.push(`${entry.id} reliability ${reliability} is below 0.67`);
    }
    return deepFreeze({
      trackId: entry.id,
      practitioners: practitioners.size,
      externalPractitioners: external.size,
      artifacts: qualified.length,
      reliability,
      ready: failures.length === 0,
      failures,
    });
  });
  const failures = trackResults.flatMap((entry) => entry.failures);
  const overallReliability = weightedMean(
    trackResults.filter((entry) => entry.artifacts > 0)
      .map((entry) => ({ value: entry.reliability, weight: entry.artifacts })),
  );
  if (trackResults.length > 0
    && trackResults.every((entry) => entry.ready)
    && overallReliability < 0.8) {
    failures.push(`overall reliability ${overallReliability} is below 0.8`);
  }
  return deepFreeze({
    ready: trackResults.length > 0 && failures.length === 0,
    overallReliability,
    tracks: trackResults,
    failures,
  });
}

function track(input) {
  if (input.weights.reduce((sum, value) => sum + value, 0) !== 100) {
    throw new Error(`${input.id} weights must sum to 100`);
  }
  return deepFreeze(input);
}

function buildTask(entry, mode, modeIndex, context, contextIndex) {
  const sequence = modeIndex * entry.contexts.length + contextIndex + 1;
  const splitCode = (modeIndex + contextIndex) % 5;
  const split = splitCode === 0
    ? "publicDevelopment"
    : splitCode === 4
      ? "rollingHoldout"
      : "privateTest";
  const id = `${entry.id}-${String(sequence).padStart(2, "0")}`;
  return deepFreeze({
    id,
    trackId: entry.id,
    modeId: mode.id,
    split,
    complexity: mode.complexity,
    durationMinutes: mode.durationMinutes + contextIndex * 15,
    prompt: `${mode.instruction} for a ${context}. Show the evidence behind material decisions, preserve editable source, validate the real runtime where applicable, and document critique, revision, and handoff.`,
    fixture: {
      id: `${id}-fixture`,
      public: split === "publicDevelopment",
      status: "contract_defined",
      requiredInputs: [
        "brief",
        "source-material",
        "constraints",
        "acceptance-fixtures",
      ],
    },
    requiredArtifactKinds: [
      ...entry.artifacts,
      "decision-log",
      "execution-trace",
      "handoff-note",
    ],
    runnerProfileIds: entry.runners,
    negativeControlIds: [
      "fixture-tampering",
      "fabricated-evidence",
      "scope-substitution",
      entry.control,
    ],
    grading: {
      deterministic: true,
      blindedSeniorReview: true,
      userOrAudienceValidation: ["product-design", "service-design", "content-design", "interaction-prototyping"]
        .includes(entry.id),
    },
  });
}

function negativeControls(tracks) {
  const common = [
    ["fixture-tampering", "Modifies, deletes, bypasses, or weakens acceptance fixtures."],
    ["fabricated-evidence", "Invents runtime captures, traces, citations, metrics, or practitioner evidence."],
    ["scope-substitution", "Replaces the requested professional work with a mock, flattened artifact, or unsupported platform."],
    ["hidden-test-leakage", "Exposes private or rolling-holdout material to the routed agent context."],
  ];
  const trackSpecific = [
    ["unsupported-user-need", "Claims a user need or outcome without evidence."],
    ["artifact-flattening", "Substitutes a flattened image for editable layered or vector source."],
    ["unsafe-motion", "Introduces flashing, inaccessible motion, or no reduced-motion alternative."],
    ["spatial-comfort-failure", "Creates unsafe, disorienting, unreachable, or physically uncomfortable spatial behavior."],
    ["silent-agent-overwrite", "Lets an agent replace newer human work without a reviewable conflict."],
    ["non-native-web-substitution", "Substitutes a web mock for a required native implementation."],
    ["single-platform-proof", "Claims cross-platform quality from only one platform runtime."],
    ["platform-pattern-flattening", "Forces one generic component model across incompatible native conventions."],
    ["duplicate-component-debt", "Creates duplicate primitives instead of reusing or migrating the system."],
    ["frontend-backend-decoupling", "Presents polished UI while required data, state, or backend behavior is absent."],
    ["digital-only-service-substitution", "Ignores required offline channels, operations, policy, or support paths."],
    ["placeholder-copy-substitution", "Uses generic placeholder copy instead of designed, validated content."],
    ["happy-path-only-prototype", "Omits errors, loading, permissions, interruption, and recovery states."],
    ["unsupported-research-claim", "Reports conclusions not traceable to the supplied evidence corpus."],
  ];
  const expected = new Set(tracks.map((entry) => entry.control));
  return [...common, ...trackSpecific]
    .filter(([id]) => common.some(([commonId]) => commonId === id) || expected.has(id))
    .map(([id, description]) => ({ id, description }));
}

function runnerProfiles() {
  return [
    runner("browser-playwright", "Browser and desktop web runtime", ["browser-build", "playwright-e2e", "accessibility-tree", "performance-trace"]),
    runner("ios-simulator", "iOS or visionOS simulator runtime", ["xcode-build", "simulator-capture", "accessibility-capture", "performance-trace"]),
    runner("expo-device", "Expo development and production runtime", ["expo-build", "ios-capture", "android-capture", "navigation-e2e"]),
    runner("android-emulator", "Android emulator and Compose instrumentation", ["gradle-build", "compose-ui-test", "emulator-capture", "accessibility-capture"]),
    runner("figma-editable", "Editable design artifact runtime", ["layer-tree", "component-graph", "token-bindings", "editable-export"]),
    runner("motion-render", "Frame-accurate motion and video runtime", ["timeline-source", "render", "frame-analysis", "reduced-motion-output"]),
    runner("spatial-xr-runtime", "Spatial simulator or OpenXR-compatible runtime", ["scene-build", "interactive-scenario", "input-profile", "comfort-safety-check"]),
    runner("artifact-validator", "Cross-discipline artifact and provenance validator", ["schema-validation", "hash-verification", "source-provenance", "handoff-reopen"]),
  ];
}

function runner(id, title, requiredEvidence) {
  return {
    id,
    title,
    status: "contract_defined",
    requiredEvidence,
  };
}

function references() {
  return [
    reference("graphic-design-bench", "https://arxiv.org/abs/2604.04192"),
    reference("vision2web", "https://arxiv.org/abs/2603.26648"),
    reference("swe-webdevbench", "https://arxiv.org/abs/2605.04637"),
    reference("design-arena", "https://www.designarena.ai/leaderboard"),
    reference("service-designer-framework", "https://ddat-capability-framework.service.gov.uk/role/service-designer"),
    reference("interaction-designer-framework", "https://ddat-capability-framework.service.gov.uk/role/interaction-designer"),
    reference("content-designer-framework", "https://ddat-capability-framework.service.gov.uk/role/content-designer"),
    reference("apple-hig", "https://developer.apple.com/design/human-interface-guidelines"),
    reference("apple-visionos", "https://developer.apple.com/design/human-interface-guidelines/designing-for-visionos"),
    reference("android-core-quality", "https://developer.android.com/develop/adaptive-apps/quality-guidelines/core-app-quality"),
    reference("android-xr-quality", "https://developer.android.com/develop/adaptive-apps/quality-guidelines/android-xr"),
    reference("openxr-cts", "https://registry.khronos.org/OpenXR/conformance/cts_usage.html"),
    reference("wcag-22", "https://www.w3.org/TR/WCAG22/"),
  ];
}

function reference(id, url) {
  return { id, url };
}

function validateProtocol(protocol, failures) {
  if (!isRecord(protocol)) {
    failures.push("protocol must be an object");
    return;
  }
  if (protocol.targetTasks !== 300) failures.push("protocol.targetTasks must equal 300");
  const split = protocol.taskSplit;
  if (!isRecord(split)
    || split.publicDevelopment !== 60
    || split.privateTest !== 180
    || split.rollingHoldout !== 60) {
    failures.push("protocol.taskSplit must equal 60 public, 180 private, and 60 rolling holdout tasks");
  }
  if (protocol.composite !== "geometric_mean") {
    failures.push("protocol.composite must be geometric_mean");
  }
  if (protocol.efficiencyRole !== "separate_pareto_metric") {
    failures.push("efficiency must remain a separate Pareto metric");
  }
  if (protocol.minimumIndependentRuns < 3 || protocol.releaseCriticalRuns < 5) {
    failures.push("protocol requires at least 3 independent runs and 5 release-critical runs");
  }
}

function validateTracks(manifest, failures) {
  if (!Array.isArray(manifest.tracks) || manifest.tracks.length !== 15) {
    failures.push("tracks must contain exactly 15 professional disciplines");
    return;
  }
  const ids = new Set();
  for (const entry of manifest.tracks) {
    if (ids.has(entry.id)) failures.push(`duplicate track id ${entry.id}`);
    ids.add(entry.id);
    const total = (entry.rubric ?? []).reduce((sum, item) => sum + (item.weight ?? 0), 0);
    if (total !== 100) failures.push(`track ${entry.id} rubric weights must sum to 100, received ${total}`);
    if (!Array.isArray(entry.artifactKinds) || entry.artifactKinds.length < 5) {
      failures.push(`track ${entry.id} requires at least five professional artifact kinds`);
    }
  }
}

function validateControls(controls, failures) {
  if (!Array.isArray(controls) || controls.length < 10) {
    failures.push("negativeControls must contain common and discipline-specific controls");
    return;
  }
  const ids = new Set();
  for (const control of controls) {
    if (ids.has(control.id)) failures.push(`duplicate negative control ${control.id}`);
    ids.add(control.id);
    requiredString(control, "description", failures);
  }
}

function validateRunners(runners, failures) {
  const required = new Set([
    "browser-playwright",
    "ios-simulator",
    "expo-device",
    "android-emulator",
    "figma-editable",
    "motion-render",
    "spatial-xr-runtime",
    "artifact-validator",
  ]);
  for (const runner of Array.isArray(runners) ? runners : []) {
    required.delete(runner.id);
    if (!Array.isArray(runner.requiredEvidence) || runner.requiredEvidence.length < 4) {
      failures.push(`runner ${runner.id} requires at least four evidence outputs`);
    }
  }
  for (const id of required) failures.push(`missing runner profile ${id}`);
}

function validateTasks(manifest, failures) {
  if (!Array.isArray(manifest.tasks) || manifest.tasks.length !== 300) {
    failures.push("tasks must contain exactly 300 entries");
    return;
  }
  const trackIds = new Set((manifest.tracks ?? []).map((entry) => entry.id));
  const controlIds = new Set((manifest.negativeControls ?? []).map((entry) => entry.id));
  const runnerIds = new Set((manifest.runnerProfiles ?? []).map((entry) => entry.id));
  const ids = new Set();
  const trackCounts = new Map();
  const splitCounts = { publicDevelopment: 0, privateTest: 0, rollingHoldout: 0 };
  for (const task of manifest.tasks) {
    if (ids.has(task.id)) failures.push(`duplicate task id ${task.id}`);
    ids.add(task.id);
    if (!trackIds.has(task.trackId)) failures.push(`task ${task.id} references unknown track ${task.trackId}`);
    trackCounts.set(task.trackId, (trackCounts.get(task.trackId) ?? 0) + 1);
    if (!SPLITS.has(task.split)) failures.push(`task ${task.id} has invalid split ${task.split}`);
    else splitCounts[task.split] += 1;
    if (task.split !== "publicDevelopment" && task.fixture?.public === true) {
      failures.push(`task ${task.id} private task fixture cannot be public`);
    }
    if (!Array.isArray(task.negativeControlIds) || task.negativeControlIds.length < 3) {
      failures.push(`task ${task.id} requires negative controls`);
    } else {
      for (const id of task.negativeControlIds) {
        if (!controlIds.has(id)) failures.push(`task ${task.id} references unknown negative control ${id}`);
      }
    }
    for (const id of task.runnerProfileIds ?? []) {
      if (!runnerIds.has(id)) failures.push(`task ${task.id} references unknown runner ${id}`);
    }
    if (!Array.isArray(task.requiredArtifactKinds) || task.requiredArtifactKinds.length < 8) {
      failures.push(`task ${task.id} requires complete professional artifacts`);
    }
  }
  for (const trackId of trackIds) {
    if (trackCounts.get(trackId) !== 20) {
      failures.push(`track ${trackId} must contain 20 tasks, received ${trackCounts.get(trackId) ?? 0}`);
    }
  }
  if (canonicalJson(splitCounts) !== canonicalJson(manifest.protocol?.taskSplit ?? {})) {
    failures.push(`task splits do not match protocol: ${canonicalJson(splitCounts)}`);
  }
}

function validateIntegrity(manifest, failures) {
  const expectedTasks = sha256(canonicalJson(manifest.tasks ?? []));
  const expectedCandidate = sha256(canonicalJson(manifest.frozenCandidate ?? {}));
  if (manifest.integrity?.taskBankSha256 !== expectedTasks) {
    failures.push("task bank integrity hash does not match canonical tasks");
  }
  if (manifest.integrity?.frozenCandidateSha256 !== expectedCandidate) {
    failures.push("frozen candidate integrity hash does not match");
  }
}

async function validateCalibration(manifest, root, failures) {
  const calibration = manifest.calibration;
  if (!isRecord(calibration)) {
    failures.push("calibration must be an object");
    return;
  }
  if (calibration.syntheticRatingsProhibited !== true) {
    failures.push("synthetic practitioner ratings must be prohibited");
  }
  if (calibration.status === "complete") {
    if (typeof calibration.evidenceFile !== "string" || calibration.evidenceFile.length === 0) {
      failures.push("complete calibration requires an evidence file");
      return;
    }
    const evidencePath = path.resolve(root, calibration.evidenceFile);
    if (!insideRoot(root, evidencePath) || !await exists(evidencePath)) {
      failures.push(`calibration evidence file is missing: ${calibration.evidenceFile}`);
      return;
    }
    try {
      const evidence = JSON.parse(await readFile(evidencePath, "utf8"));
      const readiness = buildCalibrationReadiness(manifest, evidence.artifacts ?? []);
      if (!readiness.ready) failures.push(...readiness.failures.map((failure) => `calibration: ${failure}`));
    } catch (error) {
      failures.push(`calibration evidence is invalid: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

function validateReleaseGates(gates, failures) {
  const required = new Set([
    "fixture-integrity",
    "practitioner-calibration",
    "quality-non-inferiority",
    "no-weak-track-masking",
    "repeat-stability",
    "second-provider",
    "honest-efficiency",
  ]);
  for (const gate of Array.isArray(gates) ? gates : []) required.delete(gate.id);
  for (const id of required) failures.push(`missing release gate ${id}`);
}

function validationResult(manifest, failures) {
  const splitCounts = { publicDevelopment: 0, privateTest: 0, rollingHoldout: 0 };
  for (const task of manifest?.tasks ?? []) {
    if (SPLITS.has(task.split)) splitCounts[task.split] += 1;
  }
  return deepFreeze({
    passed: failures.length === 0,
    benchmarkId: manifest?.benchmarkId ?? null,
    trackCount: Array.isArray(manifest?.tracks) ? manifest.tracks.length : 0,
    taskCount: Array.isArray(manifest?.tasks) ? manifest.tasks.length : 0,
    splitCounts,
    calibrationStatus: manifest?.calibration?.status ?? "missing",
    failures,
  });
}

function ratingPair(ratings) {
  if (!Array.isArray(ratings) || ratings.length < 2) return [];
  const unique = [...new Map(ratings.map((rating) => [rating.graderId, rating])).values()];
  if (unique.length < 2) return [];
  return [[clampScore(unique[0].score), clampScore(unique[1].score)]];
}

function agreementCoefficient(pairs) {
  if (pairs.length === 0) return 0;
  const disagreement = pairs.reduce(
    (sum, [left, right]) => sum + ((left - right) ** 2 / 10000),
    0,
  ) / pairs.length;
  return round(Math.max(0, 1 - disagreement));
}

function weightedMean(entries) {
  const totalWeight = entries.reduce((sum, entry) => sum + entry.weight, 0);
  if (totalWeight === 0) return 0;
  return round(entries.reduce(
    (sum, entry) => sum + entry.value * entry.weight,
    0,
  ) / totalWeight);
}

function canonicalJson(value) {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (!isRecord(value)) return value;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, sortKeys(value[key])]),
  );
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function clampScore(value) {
  const score = Number(value);
  if (!Number.isFinite(score)) return 0;
  return Math.max(0, Math.min(100, score));
}

function round(value) {
  return Math.round(value * 100) / 100;
}

function deepFreeze(value) {
  if (Array.isArray(value)) {
    for (const entry of value) deepFreeze(entry);
  } else if (isRecord(value)) {
    for (const entry of Object.values(value)) deepFreeze(entry);
  }
  return Object.freeze(value);
}

function requiredString(value, field, failures) {
  if (typeof value?.[field] !== "string" || value[field].trim() === "") {
    failures.push(`${field} must be a non-empty string`);
  }
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function insideRoot(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
}

async function exists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}
