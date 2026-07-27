import { describe, expect, it } from "vitest";

import {
  BRIDGE_BIND_HOST,
  verifyBridgeCapability,
} from "../ws-server.js";

describe("Figma bridge security boundary", () => {
  it("binds the bridge only to loopback", () => {
    expect(BRIDGE_BIND_HOST).toBe("127.0.0.1");
  });

  it("accepts only the current per-session capability", () => {
    expect(verifyBridgeCapability("session-token", "session-token")).toBe(true);
    expect(verifyBridgeCapability("wrong-token", "session-token")).toBe(false);
    expect(verifyBridgeCapability(undefined, "session-token")).toBe(false);
  });
});
