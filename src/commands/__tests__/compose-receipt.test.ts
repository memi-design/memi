import { describe, expect, it } from "vitest";
import { deriveComposeStopReason } from "../compose-receipt.js";

describe("compose receipt stop reasons", () => {
  it("distinguishes preflight, exhausted execution, and missing verification evidence", () => {
    expect(deriveComposeStopReason(true, "completed")).toBe("preflight-failed");
    expect(deriveComposeStopReason(false, "failed")).toBe("attempt-limit-reached");
    expect(deriveComposeStopReason(false, "partial")).toBe("attempt-limit-reached");
    expect(deriveComposeStopReason(false, "completed")).toBe("verification-failed");
  });
});
