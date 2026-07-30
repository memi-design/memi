import { createHash } from "node:crypto";

const DISCLOSURE = "This is benchmark-authored synthetic source material, not observed user or production evidence.";
const CAPTURED_AT = "2026-07-30T00:00:00.000Z";

const PROFILES = Object.freeze({
  "product-design": profile(
    "People completing an unfamiliar, consequential workflow",
    ["completion rate", "time to confidence", "recovery rate"],
    ["browser", "mobile"],
    ["screen-reader task completion", "keyboard-only recovery"],
    "Incorrect decisions must remain reversible and explainable",
  ),
  "graphic-brand-design": profile(
    "A public audience encountering a multi-format identity",
    ["recognition", "legibility", "production error rate"],
    ["print", "responsive web", "social export"],
    ["contrast-safe typography", "meaning without color"],
    "Exports must not misrepresent public information",
  ),
  "motion-design": profile(
    "People following temporal information with varied motion tolerance",
    ["comprehension", "frame continuity", "reduced-motion parity"],
    ["web video", "mobile playback"],
    ["reduced-motion equivalent", "captioned temporal cues"],
    "Motion must not obscure warnings or trigger unsafe flashing",
  ),
  "spatial-xr": profile(
    "People navigating a shared spatial environment",
    ["task reachability", "comfort duration", "input recovery"],
    ["room-scale XR", "seated XR", "AR"],
    ["seated reach alternative", "non-gesture input path"],
    "Locomotion, occlusion, and collision risks require explicit safeguards",
  ),
  "agentic-design": profile(
    "People delegating work while retaining meaningful control",
    ["approval accuracy", "intervention rate", "recovery success"],
    ["agent desktop", "browser review"],
    ["keyboard approval flow", "plain-language trace"],
    "Irreversible or privileged actions require explicit approval",
  ),
  "ios-swiftui": profile(
    "iPhone users expecting native behavior across access settings",
    ["launch reliability", "navigation completion", "frame latency"],
    ["iOS simulator", "iPhone"],
    ["Dynamic Type XXXL", "VoiceOver rotor order"],
    "Offline and permission-denied states must preserve user work",
  ),
  "cross-platform-mobile": profile(
    "iOS and Android users sharing one product model",
    ["platform parity", "offline recovery", "navigation reliability"],
    ["Expo iOS", "Expo Android"],
    ["screen-reader labels on both platforms", "large-text reflow"],
    "Platform-specific permissions cannot silently diverge",
  ),
  "android-compose": profile(
    "Android users across phones, tablets, and foldables",
    ["predictive-back success", "adaptive-layout completion", "jank rate"],
    ["Android emulator", "foldable emulator"],
    ["TalkBack order", "font-scale 200 percent"],
    "Back navigation and offline state must never discard work",
  ),
  "native-design-kits": profile(
    "Product teams implementing platform-specific component behavior",
    ["component adoption", "platform conformance", "override debt"],
    ["Apple platforms", "Material 3", "desktop"],
    ["native focus semantics", "high-contrast variants"],
    "Shared tokens must not flatten platform safety conventions",
  ),
  "design-systems": profile(
    "Multiple product teams migrating a governed component system",
    ["token adoption", "duplicate reduction", "accessibility compliance"],
    ["Figma library", "web components", "native mappings"],
    ["semantic token coverage", "component-state accessibility"],
    "Migration must preserve production behavior and rollback",
  ),
  "design-engineering": profile(
    "People using a production interface under realistic data load",
    ["task completion", "visual-regression rate", "interaction latency"],
    ["responsive browser", "desktop shell"],
    ["keyboard completion", "zoom at 200 percent"],
    "Source, runtime behavior, and visual evidence must agree",
  ),
  "service-design": profile(
    "Customers and staff moving across digital and human channels",
    ["handoff success", "failure demand", "resolution time"],
    ["web", "phone", "in-person service"],
    ["assisted-service path", "language-access handoff"],
    "A digital success cannot conceal failure in an offline channel",
  ),
  "content-design": profile(
    "People interpreting high-stakes content under time pressure",
    ["comprehension", "error recovery", "support escalation"],
    ["responsive product", "email", "support"],
    ["plain-language alternative", "localization expansion"],
    "Content must not imply eligibility, safety, or legal guarantees",
  ),
  "interaction-prototyping": profile(
    "People completing keyboard, pointer, touch, and recovery flows",
    ["state coverage", "input parity", "error recovery"],
    ["interactive prototype", "browser runtime"],
    ["keyboard-only flow", "touch target compliance"],
    "Prototype behavior must cover interruption and destructive actions",
  ),
  "research-evidence": profile(
    "Decision makers evaluating mixed qualitative and quantitative evidence",
    ["evidence traceability", "sampling validity", "decision confidence"],
    ["research repository", "analysis workbook"],
    ["accessible research materials", "alternative participation mode"],
    "Claims must separate observed evidence, inference, and uncertainty",
  ),
});

export function buildPublicFixtureCandidates(manifest) {
  const publicTasks = (manifest.tasks ?? []).filter(
    (task) => task.split === "publicDevelopment",
  );
  const trackCounts = new Map();
  return deepFreeze(publicTasks.map((task) => {
    const variant = trackCounts.get(task.trackId) ?? 0;
    trackCounts.set(task.trackId, variant + 1);
    return buildCandidate(manifest, task, variant);
  }));
}

export function validatePublicFixtureCandidates(manifest, candidates) {
  const failures = [];
  const publicTasks = new Map(
    (manifest.tasks ?? [])
      .filter((task) => task.split === "publicDevelopment")
      .map((task) => [task.id, task]),
  );
  const allTasks = new Map((manifest.tasks ?? []).map((task) => [task.id, task]));
  const seen = new Set();
  const trackCounts = new Map();
  if (!Array.isArray(candidates) || candidates.length !== 60) {
    failures.push(`public fixture candidates must contain 60 packs, received ${candidates?.length ?? 0}`);
  }
  for (const candidate of candidates ?? []) {
    const label = candidate?.taskId ?? "unknown";
    const task = publicTasks.get(candidate?.taskId);
    if (!task) {
      failures.push(`${label} is not a public development task`);
    }
    if (seen.has(candidate?.taskId)) failures.push(`${label} is duplicated`);
    seen.add(candidate?.taskId);
    if (candidate?.trackId) {
      trackCounts.set(candidate.trackId, (trackCounts.get(candidate.trackId) ?? 0) + 1);
    }
    if (!candidate?.disclosure?.includes("benchmark-authored synthetic")) {
      failures.push(`${label} requires explicit synthetic disclosure`);
    }
    if (candidate?.status !== "candidate") failures.push(`${label} status must remain candidate`);
    if (!validProvenance(candidate?.provenance)) failures.push(`${label} provenance is incomplete`);
    if ((candidate?.inputs?.sourceMaterial?.evidence?.length ?? 0) < 4) {
      failures.push(`${label} requires at least four source evidence records`);
    }
    if ((candidate?.inputs?.constraints?.accessibility?.length ?? 0) < 2) {
      failures.push(`${label} requires accessibility constraints`);
    }
    if ((candidate?.inputs?.constraints?.safety?.length ?? 0) < 1) {
      failures.push(`${label} requires safety constraints`);
    }
    if (task && canonicalJson(candidate?.inputs?.acceptanceFixtures?.requiredArtifactKinds)
      !== canonicalJson(task.requiredArtifactKinds)) {
      failures.push(`${label} required artifacts do not match the task`);
    }
    if (task && canonicalJson(candidate?.inputs?.acceptanceFixtures?.negativeControlIds)
      !== canonicalJson(task.negativeControlIds)) {
      failures.push(`${label} negative controls do not match the task`);
    }
    if (allTasks.get(candidate?.taskId)?.trackId !== candidate?.trackId) {
      failures.push(`${label} track does not match the task`);
    }
    if (candidate?.candidateSha256 !== candidateHash(candidate)) {
      failures.push(`${label} candidate hash does not match`);
    }
  }
  for (const track of manifest.tracks ?? []) {
    if ((trackCounts.get(track.id) ?? 0) !== 4) {
      failures.push(`${track.id} requires four public fixture candidates`);
    }
  }
  return deepFreeze({
    passed: failures.length === 0,
    candidateCount: candidates?.length ?? 0,
    failures,
  });
}

export function approvePublicFixtureCandidate(candidate, review) {
  if (candidateHash(candidate) !== candidate?.candidateSha256) {
    throw new Error("fixture candidate hash is invalid");
  }
  if (review?.independent !== true) {
    throw new Error("fixture approval requires an independent reviewer");
  }
  if (review?.candidateSha256 !== candidate?.candidateSha256) {
    throw new Error("fixture approval does not match the candidate hash");
  }
  if (review?.taskId !== candidate?.taskId) {
    throw new Error("fixture approval does not match the task");
  }
  for (const field of ["reviewerId", "qualificationRef", "reviewReceiptRef", "reviewedAt"]) {
    if (typeof review?.[field] !== "string" || review[field].trim() === "") {
      throw new Error(`fixture approval requires ${field}`);
    }
  }
  if (review.decision !== "approved") throw new Error("fixture approval decision must be approved");
  if (!Number.isFinite(Date.parse(review.reviewedAt))) {
    throw new Error("fixture approval reviewedAt must be a timestamp");
  }
  const approval = {
    schemaVersion: 1,
    status: "approved",
    taskId: candidate.taskId,
    candidateSha256: candidate.candidateSha256,
    reviewerId: review.reviewerId,
    qualificationRef: review.qualificationRef,
    reviewReceiptRef: review.reviewReceiptRef,
    reviewedAt: review.reviewedAt,
  };
  return deepFreeze({
    ...approval,
    approvalSha256: sha256(canonicalJson(approval)),
  });
}

function buildCandidate(manifest, task, variant) {
  const track = (manifest.tracks ?? []).find((entry) => entry.id === task.trackId);
  const source = PROFILES[task.trackId];
  if (!source || !track) throw new Error(`fixture profile is missing for ${task.trackId}`);
  const candidate = {
    schemaVersion: 1,
    fixtureId: task.fixture.id,
    taskId: task.id,
    trackId: task.trackId,
    split: "publicDevelopment",
    status: "candidate",
    disclosure: DISCLOSURE,
    provenance: {
      source: "Memi DesignWorkBench v2",
      owner: "Memi Design",
      license: "MIT",
      sourceType: "benchmark_owned_synthetic",
      capturedAt: CAPTURED_AT,
    },
    inputs: {
      brief: {
        taskPrompt: task.prompt,
        audience: source.audience,
        mode: task.modeId,
        complexity: task.complexity,
        durationMinutes: task.durationMinutes,
        successMeasures: source.measures,
      },
      sourceMaterial: {
        scenarioVariant: variant + 1,
        evidence: sourceEvidence(source, task, variant),
        existingSystem: {
          maturity: ["fragmented", "emerging", "governed", "legacy"][variant],
          supportedPlatforms: source.platforms,
          knownDebt: `${track.title} behavior is inconsistent at the interruption and recovery boundary`,
        },
      },
      constraints: {
        platforms: source.platforms,
        accessibility: source.accessibility,
        safety: [source.safety],
        scope: [
          "Preserve evidence that remains valid",
          "Do not substitute a different product or platform",
          "Keep editable source and a decision log",
        ],
      },
      acceptanceFixtures: {
        requiredArtifactKinds: task.requiredArtifactKinds,
        runnerProfileIds: task.runnerProfileIds,
        negativeControlIds: task.negativeControlIds,
        deterministicChecks: [
          "all required artifacts are present",
          "artifact references resolve",
          "runtime evidence matches the claimed platform",
          "handoff reopens without hidden dependencies",
        ],
      },
    },
  };
  return deepFreeze({
    ...candidate,
    candidateSha256: sha256(canonicalJson(candidate)),
  });
}

function sourceEvidence(source, task, variant) {
  return [
    {
      id: "qualitative-observation",
      type: "benchmark-authored interview synthesis",
      finding: `${source.audience} lose confidence when the ${task.modeId} flow hides system status`,
      confidence: "candidate",
    },
    {
      id: "quantitative-baseline",
      type: "benchmark-authored baseline",
      finding: `${source.measures[variant % source.measures.length]} is below the scenario target`,
      value: 42 + variant * 7,
      unit: "scenario index",
      confidence: "candidate",
    },
    {
      id: "system-inventory",
      type: "benchmark-authored system inventory",
      finding: `${source.platforms.join(" and ")} share structure but diverge at error recovery`,
      confidence: "candidate",
    },
    {
      id: "edge-case",
      type: "benchmark-authored risk review",
      finding: source.safety,
      confidence: "candidate",
    },
  ];
}

function profile(audience, measures, platforms, accessibility, safety) {
  return deepFreeze({ audience, measures, platforms, accessibility, safety });
}

function candidateHash(candidate) {
  if (!candidate || typeof candidate !== "object") return "";
  const value = { ...candidate };
  delete value.candidateSha256;
  return sha256(canonicalJson(value));
}

function validProvenance(value) {
  return value?.source === "Memi DesignWorkBench v2"
    && value?.owner === "Memi Design"
    && value?.license === "MIT"
    && value?.sourceType === "benchmark_owned_synthetic"
    && Number.isFinite(Date.parse(value?.capturedAt));
}

function canonicalJson(value) {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value === null || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value).sort().map((key) => [key, sortKeys(value[key])]),
  );
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function deepFreeze(value) {
  if (Array.isArray(value)) {
    for (const entry of value) deepFreeze(entry);
  } else if (value !== null && typeof value === "object") {
    for (const entry of Object.values(value)) deepFreeze(entry);
  }
  return Object.freeze(value);
}
