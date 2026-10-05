// Outbound-URL validation for server-side fetches.
//
// `/api/summarize` fetches a caller-supplied URL from the server and returns
// the fetched body to the caller. Without a host/IP allow-list that is a
// textbook SSRF: `http://169.254.169.254/...` reads cloud instance credentials,
// and a private-range host turns the function into an internal port scanner.
//
// `src/lib/profileLinks.ts` already validates user-submitted URLs correctly for
// href rendering; this module is the fetch-side counterpart.

const BLOCKED_HOSTNAMES = new Set([
  "localhost",
  "localhost.localdomain",
  "metadata.google.internal",
  "metadata.goog",
  "instance-data",
]);

function isPrivateIPv4(host: string): boolean {
  const parts = host.split(".");
  if (parts.length !== 4) return false;
  const nums = parts.map((p) => Number(p));
  if (nums.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return false;
  const [a, b] = nums;

  if (a === 0) return true; // 0.0.0.0/8   "this network"
  if (a === 10) return true; // 10.0.0.0/8  private
  if (a === 127) return true; // 127.0.0.0/8 loopback
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local (cloud metadata)
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 private
  if (a === 192 && b === 168) return true; // 192.168.0.0/16 private
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 CGNAT
  if (a >= 224) return true; // multicast + reserved + broadcast
  return false;
}

function isPrivateIPv6(host: string): boolean {
  const h = host.replace(/^\[/, "").replace(/\]$/, "").toLowerCase();
  if (h === "::1" || h === "::") return true;
  if (h.startsWith("fe80")) return true; // link-local
  if (/^f[cd]/.test(h)) return true; // unique local fc00::/7
  // IPv4-mapped (::ffff:127.0.0.1) must be checked against the v4 rules.
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(h);
  if (mapped) return isPrivateIPv4(mapped[1]);
  return false;
}

export type SafeUrlResult =
  | { ok: true; url: URL }
  | { ok: false; reason: string };

/**
 * Parse and vet a caller-supplied absolute http(s) URL.
 *
 * Rejects: non-http(s) schemes, embedded credentials, hostnames without a dot,
 * bare hostnames, and literal private/loopback/link-local addresses. Hostnames
 * that resolve to private space (DNS rebinding) still need an egress proxy to
 * block; we mitigate that by using `redirect: "manual"` at the call site so a
 * public host cannot bounce us onto an internal one.
 */
export function validateOutboundUrl(raw: unknown): SafeUrlResult {
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return { ok: false, reason: "A url string is required." };
  }
  if (raw.length > 2048) {
    return { ok: false, reason: "Url is too long." };
  }

  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return { ok: false, reason: "Url is not a valid absolute URL." };
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    return { ok: false, reason: "Only http(s) urls are allowed." };
  }
  if (url.username || url.password) {
    return { ok: false, reason: "Urls with embedded credentials are not allowed." };
  }

  const host = url.hostname.toLowerCase().replace(/\.$/, "");

  if (BLOCKED_HOSTNAMES.has(host)) {
    return { ok: false, reason: "That host is not allowed." };
  }
  if (!host.includes(".")) {
    return { ok: false, reason: "Host must be a fully qualified domain name." };
  }
  // IPv6 literals arrive bracketed from URL parsing.
  if (host.startsWith("[") || host.includes(":")) {
    return isPrivateIPv6(host)
      ? { ok: false, reason: "Private network addresses are not allowed." }
      : { ok: true, url };
  }
  if (isPrivateIPv4(host)) {
    return { ok: false, reason: "Private network addresses are not allowed." };
  }

  return { ok: true, url };
}

/** Guard an inbound JSON field that must be a Firestore uid / public id. */
export function isSafeKey(value: unknown, maxLength = 128): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= maxLength &&
    !value.includes("/") &&
    !value.includes("\\") &&
    !value.includes("..") &&
    !/[\x00-\x1f]/.test(value)
  );
}