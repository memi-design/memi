import { isIP } from "node:net";

export function isPrivateOrLocalHostname(rawHostname: string): boolean {
  const hostname = rawHostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
  if (hostname === "localhost" || hostname.endsWith(".localhost")) return true;

  const ipVersion = isIP(hostname);
  if (ipVersion === 4) return isPrivateIpv4(hostname);
  if (ipVersion !== 6) return false;

  const words = parseIpv6Words(hostname);
  if (!words) return true;
  if (words.every((word) => word === 0)) return true;
  if (words.slice(0, 7).every((word) => word === 0) && words[7] === 1) return true;

  // IPv4-mapped and IPv4-compatible literals are normalized by WHATWG URLs
  // into hexadecimal words (for example ::ffff:7f00:1).
  const mapped = words.slice(0, 5).every((word) => word === 0) && words[5] === 0xffff;
  const compatible = words.slice(0, 6).every((word) => word === 0);
  if (mapped || compatible) {
    const ipv4 = `${words[6] >> 8}.${words[6] & 0xff}.${words[7] >> 8}.${words[7] & 0xff}`;
    return isPrivateIpv4(ipv4);
  }

  const first = words[0];
  return (first & 0xfe00) === 0xfc00 // fc00::/7 unique local
    || (first & 0xffc0) === 0xfe80 // fe80::/10 link local
    || (first & 0xffc0) === 0xfec0 // fec0::/10 deprecated site local
    || (first & 0xff00) === 0xff00; // ff00::/8 multicast
}

function isPrivateIpv4(hostname: string): boolean {
  const octets = hostname.split(".").map(Number);
  if (octets.length !== 4 || octets.some((octet) => !Number.isInteger(octet) || octet < 0 || octet > 255)) {
    return true;
  }
  const [a, b] = octets;
  return a === 0
    || a === 10
    || a === 127
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || a >= 224;
}

function parseIpv6Words(hostname: string): number[] | null {
  let value = hostname;
  const ipv4Tail = value.match(/(?:^|:)(\d{1,3}(?:\.\d{1,3}){3})$/)?.[1];
  if (ipv4Tail) {
    const octets = ipv4Tail.split(".").map(Number);
    if (octets.some((octet) => octet < 0 || octet > 255)) return null;
    const replacement = `${((octets[0] << 8) | octets[1]).toString(16)}:${((octets[2] << 8) | octets[3]).toString(16)}`;
    value = value.slice(0, -ipv4Tail.length) + replacement;
  }

  const halves = value.split("::");
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(":") : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || missing < 0) return null;
  const parts = halves.length === 2 ? [...left, ...Array(missing).fill("0"), ...right] : left;
  if (parts.length !== 8 || parts.some((part) => !/^[0-9a-f]{1,4}$/i.test(part))) return null;
  return parts.map((part) => Number.parseInt(part, 16));
}
