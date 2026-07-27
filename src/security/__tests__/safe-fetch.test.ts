import { Readable } from "node:stream";
import { describe, expect, it } from "vitest";

import {
  readBoundedBody,
  resolvePublicNetworkAddresses,
} from "../safe-fetch.js";

describe("safe public resource fetching", () => {
  it("rejects a hostname when any resolved address is private", async () => {
    await expect(resolvePublicNetworkAddresses("mixed.example", async () => [
      { address: "93.184.216.34", family: 4 },
      { address: "127.0.0.1", family: 4 },
    ])).rejects.toThrow(/private|loopback|local/i);
  });

  it("accepts a hostname only when every resolved address is public", async () => {
    await expect(resolvePublicNetworkAddresses("public.example", async () => [
      { address: "93.184.216.34", family: 4 },
      { address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 },
    ])).resolves.toEqual([
      { address: "93.184.216.34", family: 4 },
      { address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 },
    ]);
  });

  it("rejects response bodies incrementally above the configured byte budget", async () => {
    const body = Readable.from([
      Buffer.alloc(8, "a"),
      Buffer.alloc(9, "b"),
    ]);

    await expect(readBoundedBody(body, 16)).rejects.toThrow(/16 bytes|too large/i);
  });

  it("preserves response bodies at the configured byte budget", async () => {
    const body = Readable.from([
      Buffer.alloc(8, "a"),
      Buffer.alloc(8, "b"),
    ]);

    await expect(readBoundedBody(body, 16)).resolves.toHaveLength(16);
  });
});
