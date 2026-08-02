import { describe, expect, it } from "vitest";
import { assertEnvKey, upsertEnvValue } from "../env.js";

describe("environment file helpers", () => {
  it("updates only an exact environment key and safely quotes its value", () => {
    const updated = upsertEnvValue(
      "FIGMA_TOKEN_OLD=preserve\nFIGMA_TOKEN=old\n",
      "FIGMA_TOKEN",
      'next"value',
    );

    expect(updated).toBe('FIGMA_TOKEN_OLD=preserve\nFIGMA_TOKEN="next\\"value"\n');
  });

  it("rejects invalid keys and multiline values before writing a dotenv file", () => {
    expect(() => assertEnvKey("FIGMA.TOKEN")).toThrow(/environment key/i);
    expect(() => upsertEnvValue("", "FIGMA_TOKEN", "first\nINJECTED=value")).toThrow(/single line/i);
  });
});
