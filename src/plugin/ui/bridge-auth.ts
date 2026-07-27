import {
  BRIDGE_AUTH_SCHEME,
  BRIDGE_CLIENT_PROOF_DOMAIN,
  BRIDGE_PROTOCOL_VERSION,
  BRIDGE_SERVER_PROOF_DOMAIN,
} from "../shared/bridge-auth.js";
import type { BridgeIdentifyEnvelope } from "../shared/bridge.js";

export async function authenticateBridgeIdentify(
  capability: string,
  identify: Partial<BridgeIdentifyEnvelope>,
): Promise<string> {
  if (
    identify.auth !== BRIDGE_AUTH_SCHEME
    || identify.minimumProtocolVersion !== BRIDGE_PROTOCOL_VERSION
    || !identify.challenge
    || !identify.serverProof
  ) {
    throw new Error("Bridge requires a securely paired protocol-v3 plugin.");
  }
  const trustedServer = await verifyBridgeServerProof(
    capability,
    identify.challenge,
    identify.serverProof,
  );
  if (!trustedServer) {
    throw new Error("Server authentication proof did not match the installed capability.");
  }
  return createBridgeAuthenticationProof(capability, identify.challenge);
}

export async function createBridgeAuthenticationProof(
  capability: string,
  challenge: string,
): Promise<string> {
  const [key, encoder] = await importHmacKey(capability);
  const signature = await globalThis.crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(`${BRIDGE_CLIENT_PROOF_DOMAIN}${challenge}`),
  );
  return bytesToBase64Url(new Uint8Array(signature));
}

export async function verifyBridgeServerProof(
  capability: string,
  challenge: string,
  serverProof: string,
): Promise<boolean> {
  const [key, encoder] = await importHmacKey(capability);
  return globalThis.crypto.subtle.verify(
    "HMAC",
    key,
    base64UrlToBytes(serverProof),
    encoder.encode(`${BRIDGE_SERVER_PROOF_DOMAIN}${challenge}`),
  );
}

async function importHmacKey(capability: string): Promise<[CryptoKey, TextEncoder]> {
  const encoder = new TextEncoder();
  const key = await globalThis.crypto.subtle.importKey(
    "raw",
    encoder.encode(capability),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
  return [key, encoder];
}

function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/u, "");
}

function base64UrlToBytes(value: string): ArrayBuffer {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padding = (4 - (normalized.length % 4)) % 4;
  const padded = normalized + "=".repeat(padding);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes.buffer;
}
