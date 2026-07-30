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
    const ratingUnits = qualified
      .map((artifact) => ratingUnit(artifact.ratings))
      .filter((ratings) => ratings.length >= 2);
    const reliability = krippendorffAlphaInterval(ratingUnits);
    const failures = calibrationFailures(
      entry.id,
      qualified,
      practitioners,
      external,
      minimumArtifacts,
      ratingUnits,
      reliability,
    );
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

export function buildDesignWorkReadiness(manifest, calibrationArtifacts = []) {
  const tasks = Array.isArray(manifest?.tasks) ? manifest.tasks : [];
  const tracks = Array.isArray(manifest?.tracks) ? manifest.tracks : [];
  const runners = Array.isArray(manifest?.runnerProfiles) ? manifest.runnerProfiles : [];
  const splitCounts = {
    publicDevelopment: tasks.filter((task) => task.split === "publicDevelopment").length,
    privateTest: tasks.filter((task) => task.split === "privateTest").length,
    rollingHoldout: tasks.filter((task) => task.split === "rollingHoldout").length,
  };
  const verifiedFixtures = tasks.filter((task) => task.fixture?.status === "verified").length;
  const contractFixtures = tasks.filter(
    (task) => task.fixture?.status === "contract_defined",
  ).length;
  const verifiedRunners = runners.filter((runner) => runner.status === "verified").length;
  const contractRunners = runners.filter(
    (runner) => runner.status === "contract_defined",
  ).length;
  const calibration = buildCalibrationReadiness(manifest, calibrationArtifacts);
  const practitioners = new Set(
    calibrationArtifacts.filter((artifact) => artifact.qualified)
      .map((artifact) => artifact.practitionerId),
  ).size;
  const calibratedTracks = calibration.tracks.filter((entry) => entry.ready).length;
  const foundationReady = tracks.length === 15
    && tasks.length === 300
    && splitCounts.publicDevelopment === 60
    && splitCounts.privateTest === 180
    && splitCounts.rollingHoldout === 60
    && runners.length === 8;
  const blockers = readinessBlockers(
    contractFixtures,
    contractRunners,
    calibration.ready,
    manifest?.results,
  );
  return deepFreeze({
    benchmarkId: manifest?.benchmarkId ?? null,
    frozenCandidate: manifest?.frozenCandidate ?? null,
    foundationReady,
    releaseReady: foundationReady
      && verifiedFixtures === tasks.length
      && verifiedRunners === runners.length
      && calibration.ready
      && isRecord(manifest?.results),
    completed: {
      tracks: tracks.length,
      taskContracts: tasks.length,
      publicTasks: splitCounts.publicDevelopment,
      privateTasks: splitCounts.privateTest,
      holdoutTasks: splitCounts.rollingHoldout,
      runnerContracts: runners.length,
    },
    verified: {
      fixtures: verifiedFixtures,
      runners: verifiedRunners,
      practitioners,
      calibratedTracks,
    },
    calibration,
    blockers,
  });
}

export function krippendorffAlphaInterval(units) {
  if (!Array.isArray(units) || units.length === 0) return 0;
  const normalizedUnits = units
    .map((unit) => Array.isArray(unit)
      ? unit.map(clampScore).filter((score) => Number.isFinite(score))
      : [])
    .filter((unit) => unit.length >= 2);
  if (normalizedUnits.length === 0) return 0;
  const observed = pairwiseSquaredDisagreement(normalizedUnits);
  const allRatings = normalizedUnits.flat();
  const expected = pairwiseSquaredDisagreement([allRatings]);
  if (expected === 0) return observed === 0 ? 1 : 0;
  return round(1 - (observed / expected));
}

function calibrationFailures(
  trackId,
  artifacts,
  practitioners,
  external,
  minimumArtifacts,
  ratingUnits,
  reliability,
) {
  const failures = [];
  if (practitioners.size < 4) failures.push(`${trackId} requires at least 4 qualified practitioners`);
  if (external.size < 2) failures.push(`${trackId} requires at least 2 external practitioners`);
  if (practitioners.size > 0 && minimumArtifacts < 5) {
    failures.push(`${trackId} requires at least 5 artifacts per practitioner`);
  }
  if (artifacts.some((artifact) => new Set(
    (artifact.ratings ?? []).map((rating) => rating.graderId),
  ).size < 2)) {
    failures.push(`${trackId} requires two independent ratings per artifact`);
  }
  if (artifacts.some((artifact) =>
    typeof artifact.consentRef !== "string"
    || artifact.consentRef.length === 0
    || typeof artifact.qualificationRef !== "string"
    || artifact.qualificationRef.length === 0
    || !/^[a-f0-9]{64}$/.test(artifact.artifactSha256 ?? ""))) {
    failures.push(`${trackId} has practitioner artifacts without consent or qualification provenance`);
  }
  if (artifacts.some((artifact) => (artifact.ratings ?? []).some((rating) =>
    rating.blinded !== true
    || typeof rating.receiptRef !== "string"
    || rating.receiptRef.length === 0))) {
    failures.push(`${trackId} has ratings without blinded review receipts`);
  }
  if (ratingUnits.length > 0 && reliability < 0.67) {
    failures.push(`${trackId} reliability ${reliability} is below 0.67`);
  }
  return failures;
}

function readinessBlockers(contractFixtures, contractRunners, calibrationReady, results) {
  const blockers = [];
  if (contractFixtures > 0) {
    blockers.push(`${contractFixtures} task fixtures remain contract_defined`);
  }
  if (contractRunners > 0) {
    blockers.push(`${contractRunners} runner profiles remain contract_defined`);
  }
  if (!calibrationReady) blockers.push("practitioner calibration is pending");
  if (results === null || results === undefined) {
    blockers.push("private and holdout benchmark results are not measured");
  }
  return blockers;
}

function ratingUnit(ratings) {
  if (!Array.isArray(ratings) || ratings.length < 2) return [];
  const unique = [...new Map(ratings.map((rating) => [rating.graderId, rating])).values()];
  if (unique.length < 2) return [];
  return unique.map((rating) => clampScore(rating.score));
}

function pairwiseSquaredDisagreement(units) {
  let total = 0;
  let pairs = 0;
  for (const unit of units) {
    for (let left = 0; left < unit.length; left += 1) {
      for (let right = left + 1; right < unit.length; right += 1) {
        total += (unit[left] - unit[right]) ** 2;
        pairs += 1;
      }
    }
  }
  return pairs === 0 ? 0 : total / pairs;
}

function weightedMean(entries) {
  const totalWeight = entries.reduce((sum, entry) => sum + entry.weight, 0);
  if (totalWeight === 0) return 0;
  return round(entries.reduce(
    (sum, entry) => sum + entry.value * entry.weight,
    0,
  ) / totalWeight);
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

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
