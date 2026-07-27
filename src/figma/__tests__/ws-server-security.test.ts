import { describe, expect, it } from "vitest";

import {
  BRIDGE_BIND_HOST,
  isAllowedBridgeOrigin,
  verifyBridgeCapability,
} from "../ws-server.js";

describe("Figma bridge security boundary", () => {
  it("binds the bridge only to loopback", () => {
    expect(BRIDGE_BIND_HOST).toBe("127.0.0.1");
  });

  it("compares authentication proofs without accepting missing values", () => {
    expect(verifyBridgeCapability("session-token", "session-token")).toBe(true);
    expect(verifyBridgeCapability("wrong-token", "session-token")).toBe(false);
    expect(verifyBridgeCapability(undefined, "session-token")).toBe(false);
  });

  it("allows native and Figma origins while rejecting ordinary browser pages", () => {
    expect(isAllowedBridgeOrigin(undefined)).toBe(true);
    expect(isAllowedBridgeOrigin("null")).toBe(true);
    expect(isAllowedBridgeOrigin("https://www.figma.com")).toBe(true);
    expect(isAllowedBridgeOrigin("https://desktop.figma.com")).toBe(true);
    expect(isAllowedBridgeOrigin("https://attacker.example")).toBe(false);
    expect(isAllowedBridgeOrigin("https://figma.com.attacker.example")).toBe(false);
    expect(isAllowedBridgeOrigin("http://figma.com")).toBe(false);
  });
});
