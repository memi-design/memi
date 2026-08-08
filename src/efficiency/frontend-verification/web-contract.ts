export type WebArtifactKind =
  | "screenshot"
  | "interaction-trace"
  | "keyboard-focus"
  | "axe";

export type WebViewport = "desktop" | "mobile";
export type WebColorScheme = "light" | "dark";
export type WebReducedMotion = "no-preference" | "reduce";
export type WebUiState = "default" | "loading" | "empty" | "error";

export interface WebVerificationRequirement {
  readonly id: string;
  readonly kind: WebArtifactKind;
  readonly browser: "chromium";
  readonly viewport: WebViewport;
  readonly colorScheme: WebColorScheme;
  readonly reducedMotion: WebReducedMotion;
  readonly state: WebUiState;
  readonly mimeType: "image/png" | "application/zip" | "application/json";
}

const requirements: readonly WebVerificationRequirement[] = [
  screenshot("desktop-default", "desktop", "light", "no-preference", "default"),
  screenshot("mobile-default", "mobile", "light", "no-preference", "default"),
  screenshot("theme-dark", "desktop", "dark", "no-preference", "default"),
  screenshot("reduced-motion", "desktop", "light", "reduce", "default"),
  screenshot("state-loading", "desktop", "light", "no-preference", "loading"),
  screenshot("state-empty", "desktop", "light", "no-preference", "empty"),
  screenshot("state-error", "desktop", "light", "no-preference", "error"),
  evidence("interaction-trace", "interaction-trace", "application/zip"),
  evidence("keyboard-focus", "keyboard-focus", "application/json"),
  evidence("axe", "axe", "application/json"),
];

/** Frozen capture plan. Drivers must return one artifact for every entry. */
export const WEB_VERIFICATION_REQUIREMENTS = Object.freeze(
  requirements.map((requirement) => Object.freeze(requirement)),
);

export type WebVerificationRequirementId =
  (typeof WEB_VERIFICATION_REQUIREMENTS)[number]["id"];

function screenshot(
  id: string,
  viewport: WebViewport,
  colorScheme: WebColorScheme,
  reducedMotion: WebReducedMotion,
  state: WebUiState,
): WebVerificationRequirement {
  return {
    id,
    kind: "screenshot",
    browser: "chromium",
    viewport,
    colorScheme,
    reducedMotion,
    state,
    mimeType: "image/png",
  };
}

function evidence(
  id: string,
  kind: Exclude<WebArtifactKind, "screenshot">,
  mimeType: "application/zip" | "application/json",
): WebVerificationRequirement {
  return {
    id,
    kind,
    browser: "chromium",
    viewport: "desktop",
    colorScheme: "light",
    reducedMotion: "no-preference",
    state: "default",
    mimeType,
  };
}
