import { Router } from "express";
import * as config from "../config.js";
import * as discovered from "../discovered.js";
import * as discovery from "../discovery.js";

const router = Router();

// GET /api/discovered -> persisted list, no re-scan
router.get("/api/discovered", (req, res) => {
  res.json(discovered.loadDiscovered());
});

function withPreview(subnet) {
  try {
    const ips = discovery.hostsInCidr(subnet.cidr);
    return { ...subnet, preview: { count: ips.length, first: ips[0] ?? null, last: ips[ips.length - 1] ?? null } };
  } catch (e) {
    return { ...subnet, preview: null, error: String(e.message ?? e) };
  }
}

// GET /api/subnet -> current config/subnet.json contents, plus a computed preview
// (host count + first/last address in range) so the UI can show what a sweep would cover.
router.get("/api/subnet", (req, res) => {
  let subnet;
  try {
    subnet = config.loadSubnet();
  } catch (e) {
    return res.status(500).json({ detail: `Could not load subnet.json: ${e}` });
  }
  res.json(withPreview(subnet));
});

// PUT /api/subnet { cidr, port, timeout_ms } -> validates the CIDR (same rules the
// sweep itself enforces) before persisting, returns the saved config with its preview.
router.put("/api/subnet", (req, res) => {
  const { cidr, port, timeout_ms } = req.body ?? {};
  if (!cidr || typeof cidr !== "string" || !cidr.trim()) {
    return res.status(400).json({ detail: "cidr is required" });
  }
  const portNum = Number(port);
  if (!Number.isInteger(portNum) || portNum < 1 || portNum > 65535) {
    return res.status(400).json({ detail: "port must be between 1 and 65535" });
  }
  const timeoutNum = Number(timeout_ms);
  if (!Number.isInteger(timeoutNum) || timeoutNum < 1) {
    return res.status(400).json({ detail: "timeout_ms must be a positive integer" });
  }

  let ips;
  try {
    ips = discovery.hostsInCidr(cidr.trim());
  } catch (e) {
    return res.status(400).json({ detail: String(e.message ?? e) });
  }

  const subnet = { cidr: cidr.trim(), port: portNum, timeout_ms: timeoutNum };
  config.saveSubnet(subnet);
  res.json({ ...subnet, preview: { count: ips.length, first: ips[0] ?? null, last: ips[ips.length - 1] ?? null } });
});

// POST /api/discover -> sweeps config/subnet.json's CIDR, merges results into the
// persisted store (existing names are never overwritten), returns the updated list.
router.post("/api/discover", async (req, res) => {
  let subnet;
  try {
    subnet = config.loadSubnet();
  } catch (e) {
    return res.status(500).json({ detail: `Could not load subnet.json: ${e}` });
  }

  let results;
  try {
    results = await discovery.sweep(subnet);
  } catch (e) {
    return res.status(400).json({ detail: String(e.message ?? e) });
  }

  const data = discovered.mergeDiscovered(results);
  res.json({ ...data, found: results.length });
});

// PATCH /api/discovered/:ip { name }
router.patch("/api/discovered/:ip", (req, res) => {
  const { ip } = req.params;
  const { name } = req.body ?? {};
  if (!name || typeof name !== "string" || !name.trim()) {
    return res.status(400).json({ detail: "name is required" });
  }

  const entry = discovered.renameDiscovered(ip, name.trim());
  if (!entry) return res.status(404).json({ detail: `Unknown discovered host '${ip}'` });
  res.json(entry);
});

export default router;
