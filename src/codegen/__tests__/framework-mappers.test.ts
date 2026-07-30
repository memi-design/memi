import { describe, expect, it } from "vitest";
import { ComponentSpecSchema, type ComponentSpec } from "../../specs/types.js";
import { generateSvelteComponent } from "../svelte-mapper.js";
import { generateVueComponent } from "../vue-mapper.js";

describe.each([
  {
    framework: "Vue",
    extension: "vue",
    generate: generateVueComponent,
  },
  {
    framework: "Svelte",
    extension: "svelte",
    generate: generateSvelteComponent,
  },
])("$framework component mapper", ({ framework, extension, generate }) => {
  it("generates accessible card composition with typed optional and boolean props", () => {
    const result = generate(makeSpec({
      name: "ProfileCard",
      props: {
        title: "string",
        description: "string?",
        featured: "boolean?",
        score: "number",
      },
      shadcnBase: ["Card", "Badge"],
      accessibility: {
        role: "region",
        ariaLabel: "required",
      },
    }));

    expect(result.component).toContain("title");
    expect(result.component).toContain("description");
    expect(result.component).toContain("featured");
    expect(result.component).toContain("role=\"region\"");
    expect(result.component).toContain("aria-label");
    expect(result.component).not.toContain("undefined");
    expect(result.barrel).toBe(
      `export { default as ProfileCard } from "./ProfileCard.${extension}"\n`,
    );
  });

  it("generates variant-aware buttons with a label and framework-native defaults", () => {
    const result = generate(makeSpec({
      name: "ActionButton",
      props: {
        label: "ReactNode",
        disabled: "boolean?",
      },
      variants: ["default", "quiet", "destructive"],
      shadcnBase: ["Button"],
      accessibility: {
        role: "button",
        ariaLabel: "required",
      },
    }));

    expect(result.component).toContain("ActionButtonVariant");
    expect(result.component).toContain("default");
    expect(result.component).toContain("quiet");
    expect(result.component).toContain("label");
    expect(result.component).toContain("Button");
    expect(result.component).not.toContain("<slot />");
  });

  it("falls back to a semantic generic container for custom components", () => {
    const result = generate(makeSpec({
      name: "MetricPanel",
      props: {
        name: "string",
        visible: "boolean",
        metadata: "Record<string, unknown>",
      },
      variants: ["default"],
      shadcnBase: [],
      accessibility: {
        role: "group",
        ariaLabel: "optional",
      },
    }));

    expect(result.component).toContain("group");
    expect(result.component).toContain("visible");
    expect(result.component).toContain("metadata");
    expect(result.component).not.toContain("variant =");
    expect(result.barrel).toContain(`MetricPanel.${extension}`);
    expect(framework).toMatch(/Vue|Svelte/);
  });
});

function makeSpec(
  input: {
    name: string;
    props: Record<string, string>;
    variants?: string[];
    shadcnBase: string[];
    accessibility: {
      role: string;
      ariaLabel: "required" | "optional" | "none";
    };
  },
): ComponentSpec {
  return ComponentSpecSchema.parse({
    type: "component",
    level: "atom",
    purpose: `Render ${input.name}`,
    variants: ["default"],
    ...input,
  });
}
