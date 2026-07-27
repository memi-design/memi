import type { LookupAddress } from "node:dns";
import { lookup as dnsLookup } from "node:dns/promises";
import { request as httpRequest, type IncomingHttpHeaders, type IncomingMessage } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";

import { isPrivateOrLocalHostname } from "./network-address.js";

export interface PublicFetchOptions {
  maxBytes: number;
  timeoutMs?: number;
  maxRedirects?: number;
  headers?: Record<string, string>;
}

export interface PublicFetchResponse {
  url: string;
  status: number;
  ok: boolean;
  headers: IncomingHttpHeaders;
  body: Buffer;
}

export interface PublicTextResponse extends Omit<PublicFetchResponse, "body"> {
  text: string;
}

export type PublicDnsResolver = (
  hostname: string,
  options: { all: true; verbatim: true },
) => Promise<LookupAddress[]>;

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_MAX_REDIRECTS = 3;

export async function resolvePublicNetworkAddresses(
  rawHostname: string,
  resolver: PublicDnsResolver = dnsLookup,
): Promise<LookupAddress[]> {
  const hostname = rawHostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (isPrivateOrLocalHostname(hostname)) {
    throw new Error(`Public URL resolved to a private, local, or loopback address: ${rawHostname}`);
  }

  const literalFamily = isIP(hostname);
  const addresses = literalFamily
    ? [{ address: hostname, family: literalFamily }]
    : await resolver(hostname, { all: true, verbatim: true });

  if (addresses.length === 0) {
    throw new Error(`Public URL hostname did not resolve: ${rawHostname}`);
  }

  if (addresses.some(({ address }) => isPrivateOrLocalHostname(address))) {
    throw new Error(`Public URL resolved to a private, local, or loopback address: ${rawHostname}`);
  }

  return addresses.map(({ address, family }) => ({ address, family }));
}

export async function readBoundedBody(
  source: AsyncIterable<Uint8Array | string>,
  maxBytes: number,
  contentLength?: number,
): Promise<Buffer> {
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw new Error(`Invalid response byte limit: ${maxBytes}`);
  }
  if (contentLength !== undefined && contentLength > maxBytes) {
    destroyReadable(source, new Error(`Remote response exceeds limit of ${maxBytes} bytes`));
    throw new Error(`Remote response exceeds limit of ${maxBytes} bytes`);
  }

  const chunks: Buffer[] = [];
  let totalBytes = 0;
  for await (const chunk of source) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    totalBytes += bytes.length;
    if (totalBytes > maxBytes) {
      const error = new Error(`Remote response exceeds limit of ${maxBytes} bytes`);
      destroyReadable(source, error);
      throw error;
    }
    chunks.push(bytes);
  }
  return Buffer.concat(chunks, totalBytes);
}

export async function fetchPublicResource(
  input: string,
  options: PublicFetchOptions,
): Promise<PublicFetchResponse> {
  const maxRedirects = options.maxRedirects ?? DEFAULT_MAX_REDIRECTS;
  let currentUrl = parsePublicHttpUrl(input);

  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount++) {
    const addresses = await resolvePublicNetworkAddresses(currentUrl.hostname);
    const response = await requestPinned(currentUrl, addresses[0], options);

    if (isRedirect(response.statusCode) && response.headers.location) {
      response.destroy();
      if (redirectCount === maxRedirects) {
        throw new Error(`Public URL exceeded redirect limit of ${maxRedirects}`);
      }
      currentUrl = parsePublicHttpUrl(new URL(response.headers.location, currentUrl).href);
      continue;
    }

    const contentEncoding = response.headers["content-encoding"]?.trim().toLowerCase();
    if (contentEncoding && contentEncoding !== "identity") {
      response.destroy();
      throw new Error(`Public URL returned unsupported content encoding: ${contentEncoding}`);
    }
    const contentLength = parseContentLength(response.headers["content-length"]);
    const body = await readBoundedBody(response, options.maxBytes, contentLength);
    const status = response.statusCode ?? 0;
    return {
      url: currentUrl.href,
      status,
      ok: status >= 200 && status < 300,
      headers: response.headers,
      body,
    };
  }

  throw new Error(`Public URL exceeded redirect limit of ${maxRedirects}`);
}

export async function fetchPublicText(
  input: string,
  options: PublicFetchOptions,
): Promise<PublicTextResponse> {
  const response = await fetchPublicResource(input, options);
  return {
    url: response.url,
    status: response.status,
    ok: response.ok,
    headers: response.headers,
    text: response.body.toString("utf8"),
  };
}

function parsePublicHttpUrl(input: string): URL {
  const parsed = new URL(input);
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error(`Public URL must use http(s): ${input}`);
  }
  if (parsed.username || parsed.password) {
    throw new Error(`Public URL must not contain credentials: ${input}`);
  }
  return parsed;
}

function requestPinned(
  url: URL,
  address: LookupAddress,
  options: PublicFetchOptions,
): Promise<IncomingMessage> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const request = url.protocol === "https:" ? httpsRequest : httpRequest;

  return new Promise((resolve, reject) => {
    const req = request(url, {
      method: "GET",
      headers: {
        ...options.headers,
        "Accept-Encoding": "identity",
      },
      agent: false,
      lookup: (_hostname, lookupOptions, callback) => {
        if (typeof lookupOptions === "object" && lookupOptions.all) {
          (callback as (error: null, addresses: LookupAddress[]) => void)(null, [address]);
          return;
        }
        (callback as (error: null, resolvedAddress: string, family: number) => void)(
          null,
          address.address,
          address.family,
        );
      },
    }, resolve);
    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`Public URL request timed out after ${timeoutMs}ms`));
    });
    req.once("error", reject);
    req.end();
  });
}

function parseContentLength(value: string | undefined): number | undefined {
  if (!value || !/^\d+$/.test(value)) return undefined;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : undefined;
}

function isRedirect(status: number | undefined): boolean {
  return status === 301
    || status === 302
    || status === 303
    || status === 307
    || status === 308;
}

function destroyReadable(source: AsyncIterable<unknown>, error: Error): void {
  if ("destroy" in source && typeof source.destroy === "function") {
    source.destroy(error);
  }
}
