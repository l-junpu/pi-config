// Subnet sweep: probes every IPv4 host in a CIDR range for a reachable
// pi-analysis-agent.exe on /health, concurrently in batches.

const BATCH_SIZE = 32;
const MAX_HOSTS = 1024; // caps sweep size (e.g. /22 and smaller)

function ipToInt(ip) {
  const parts = ip.split(".").map(Number);
  return ((parts[0] << 24) | (parts[1] << 16) | (parts[2] << 8) | parts[3]) >>> 0;
}

function intToIp(int) {
  return [(int >>> 24) & 255, (int >>> 16) & 255, (int >>> 8) & 255, int & 255].join(".");
}

/** Returns every usable host IP (excludes network + broadcast addresses) in an IPv4 CIDR. */
export function hostsInCidr(cidr) {
  const [base, prefixStr] = cidr.split("/");
  const prefix = Number(prefixStr);
  if (!base || Number.isNaN(prefix) || prefix < 0 || prefix > 32) {
    throw new Error(`Invalid CIDR: ${cidr}`);
  }

  const baseInt = ipToInt(base);
  const hostBits = 32 - prefix;
  const size = 2 ** hostBits;
  if (size > MAX_HOSTS + 2) {
    throw new Error(`CIDR ${cidr} is too large to sweep (${size - 2} hosts, max ${MAX_HOSTS})`);
  }

  const networkInt = baseInt & (~0 << hostBits >>> 0);
  const ips = [];
  const start = hostBits <= 1 ? networkInt : networkInt + 1;
  const end = hostBits <= 1 ? networkInt + size - 1 : networkInt + size - 2;
  for (let i = start; i <= end; i++) ips.push(intToIp(i));
  return ips;
}

async function probeHealth(ip, port, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`http://${ip}:${port}/health`, { signal: controller.signal });
    if (!res.ok) return null;
    const data = await res.json();
    return { ip, port, host: data.host ?? null, username: data.username ?? null };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/** Sweeps a CIDR range, batched, and returns results for every host that responded. */
export async function sweep({ cidr, port, timeout_ms }) {
  const ips = hostsInCidr(cidr);
  const timeoutMs = timeout_ms ?? 500;
  const found = [];

  for (let i = 0; i < ips.length; i += BATCH_SIZE) {
    const batch = ips.slice(i, i + BATCH_SIZE);
    const results = await Promise.all(batch.map((ip) => probeHealth(ip, port, timeoutMs)));
    for (const r of results) if (r) found.push(r);
  }

  return found;
}
