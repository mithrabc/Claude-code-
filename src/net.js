import { networkInterfaces } from "node:os";

const PRIVATE = [
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./, // 172.16.0.0 – 172.31.255.255
];

/**
 * Best-guess LAN IPv4 address for reaching this host from another device on the
 * same network (e.g. a phone). Prefers RFC-1918 private addresses; skips
 * loopback, internal, and link-local (169.254.x) addresses. Returns null if
 * nothing suitable is found.
 */
export function getLanIp() {
  const candidates = [];
  for (const addrs of Object.values(networkInterfaces())) {
    for (const a of addrs || []) {
      const family = typeof a.family === "number" ? a.family === 4 : a.family === "IPv4";
      if (!family || a.internal) continue;
      if (a.address.startsWith("169.254.")) continue;
      candidates.push(a.address);
    }
  }
  const priv = candidates.find((ip) => PRIVATE.some((re) => re.test(ip)));
  return priv || candidates[0] || null;
}
