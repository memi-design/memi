# iOS and SwiftUI agent workflow

Memi 2.6 adds Apple-platform design CI: compact planning context, predictable SwiftUI file creation, and explicit Xcode proof requirements for coding agents.

## 1. Prepare the brief

```bash
memi ios brief \
  --platform ios \
  --intent "Build an accessible settings screen with App Intents" \
  --detail compact \
  --json
```

The brief selects focused SwiftUI, App Intents, SwiftData, concurrency, testing, and build guidance from the stated intent. It does not run Xcode or claim that the project builds.

MCP clients call `prepare_apple_design_brief` with the same `platform`, `intent`, and `detail` inputs.

## 2. Preview files

```bash
memi ios scaffold Settings \
  --kind screen \
  --module AppModule \
  --deployment-target 17.0 \
  --output-root Sources \
  --tests-root Tests \
  --json
```

The dry-run plan contains:

- `.memoire/specs/ios/Settings.json`
- `Sources/Settings/SettingsModel.swift`
- `Sources/Settings/SettingsView.swift`, including `#Preview`
- `Tests/SettingsTests.swift`, using Swift Testing

For a reusable component, use `--kind component --level atom|molecule|organism|template`. Add `--liquid-glass` only when an iOS 26+ glass path and an earlier-system material fallback are appropriate.

## 3. Approve writes

Review every path and source body, then repeat with `--write`. MCP clients set `approved=true` on `scaffold_swiftui_files`.

Memi does not mutate `.xcodeproj` or `.xcworkspace`. Add generated files through the repository's existing XcodeGen, Tuist, SwiftPM, synchronized-folder, or project-file workflow. Existing files are never overwritten silently.

## 4. Verify the real project

Discover rather than guess:

```bash
xcodebuild -list -json
xcodebuild -version
xcrun simctl list devices available
```

Run the repository's canonical build and test commands. If it has none, select an explicit shared scheme and destination, retain the result bundle, and exercise the critical simulator flow.

The handoff must distinguish:

- source generated
- project integration completed
- build passed
- tests passed
- preview rendered
- simulator flow exercised
- performance profiled
- signing/archive/App Store proof

Only claim the stages that actually ran.

## Skills

Install the focused package skill:

```bash
npx skills add memi-design/memi --skill build-swiftui-interface
```

The broader [`memi-design/design-skills`](https://github.com/memi-design/design-skills) catalog provides the optional `ios-swift` collection with SwiftUI design engineering, Liquid Glass, concurrency, testing, SwiftData, App Intents, performance debugging, and Xcode build reliability skills.
