import { describe, expect, it } from "vitest";
import { analyzeSwiftUiSources } from "../swiftui-static.js";

describe("analyzeSwiftUiSources", () => {
  it("ignores motion and gesture names inside comments and string literals", () => {
    const result = analyzeSwiftUiSources([{
      path: "Sources/QuietView.swift",
      content: `import SwiftUI
struct QuietView: View {
    var body: some View {
        // .keyframeAnimator and .onSpatialTap are documentation examples.
        Text(".phaseAnimator and withAnimation are not executable here")
    }
}
`,
    }]);

    expect(result.swiftUiFiles).toHaveLength(1);
    expect(result.issues).toEqual([]);
  });

  it("does not accept an unused reduced-motion environment value as a fallback", () => {
    const result = analyzeSwiftUiSources([{
      path: "Sources/UnusedEnvironmentView.swift",
      content: `import SwiftUI
struct UnusedEnvironmentView: View {
    @Environment(\\.accessibilityReduceMotion) private var reduceMotion
    var body: some View {
        Text("Motion")
            .animation(.spring, value: true)
    }
}
`,
    }]);

    expect(result.issues.map((issue) => issue.id)).toContain("swiftui.reduced-motion-missing");
  });

  it("keeps gesture wording narrow and file-local", () => {
    const result = analyzeSwiftUiSources([
      {
        path: "Sources/GestureView.swift",
        content: `import SwiftUI
struct GestureView: View {
    var body: some View {
        Color.clear.onSpatialTap { _ in }
    }
}
`,
      },
      {
        path: "Sources/OtherView.swift",
        content: `import SwiftUI
struct OtherView: View {
    var body: some View {
        Text("Other").accessibilityAction { }
    }
}
`,
      },
    ]);
    const finding = result.issues.find((issue) => issue.id === "swiftui.gesture-accessibility-action-missing");

    expect(finding?.detail).toContain("in the same SwiftUI source file");
    expect(finding?.affectedFiles).toEqual(["Sources/GestureView.swift"]);
  });

  it("does not let an unrelated file satisfy reduced-motion coverage", () => {
    const result = analyzeSwiftUiSources([
      {
        path: "Sources/MotionOnlyView.swift",
        content: `import SwiftUI
struct MotionOnlyView: View {
    var body: some View {
        Text("Motion")
            .phaseAnimator([false, true]) { view, active in
                view.opacity(active ? 1 : 0)
            }
    }
}
`,
      },
      {
        path: "Sources/OtherReducedMotionView.swift",
        content: `import SwiftUI
struct OtherReducedMotionView: View {
    @Environment(\\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        Text(reduceMotion ? "Reduced" : "Full")
    }
}
`,
      },
    ]);

    const finding = result.issues.find((issue) => issue.id === "swiftui.reduced-motion-missing");

    expect(finding?.affectedFiles).toEqual(["Sources/MotionOnlyView.swift"]);
    expect(finding?.detail).toContain("same SwiftUI source file");
  });

  it("does not accept an unrelated reduce-motion branch in the same file", () => {
    const result = analyzeSwiftUiSources([{
      path: "Sources/MixedView.swift",
      content: `import SwiftUI
struct MixedView: View {
    @Environment(\\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        VStack {
            if reduceMotion {
                Text("Reduced motion is enabled")
            }
            Text("Motion")
                .phaseAnimator([false, true]) { view, active in
                    view.opacity(active ? 1 : 0)
                }
        }
    }
}
`,
    }]);

    const finding = result.issues.find((issue) => issue.id === "swiftui.reduced-motion-missing");

    expect(finding?.affectedFiles).toEqual(["Sources/MixedView.swift"]);
    expect(finding?.evidenceLocations?.[0]).toMatchObject({
      file: "Sources/MixedView.swift",
      line: 11,
    });
  });

  it("reports a later unguarded motion site when an earlier site is directly gated", () => {
    const result = analyzeSwiftUiSources([{
      path: "Sources/TwoMotionsView.swift",
      content: `import SwiftUI
struct TwoMotionsView: View {
    @Environment(\\.accessibilityReduceMotion) private var reduceMotion
    let trigger: Int

    var body: some View {
        VStack {
            Text("Guarded")
                .keyframeAnimator(initialValue: 0.0, trigger: reduceMotion ? 0 : trigger) { view, _ in
                    view
                }
            Text("Unguarded")
                .phaseAnimator([false, true]) { view, active in
                    view.opacity(active ? 1 : 0)
                }
        }
    }
}
`,
    }]);

    const finding = result.issues.find((issue) => issue.id === "swiftui.reduced-motion-missing");

    expect(finding?.evidenceLocations).toEqual([
      expect.objectContaining({
        file: "Sources/TwoMotionsView.swift",
        line: 13,
      }),
    ]);
  });
});
