import { Router } from "express";
import * as config from "../config.js";
import * as discovered from "../discovered.js";
import * as discovery from "../discovery.js";

const router = Router();

// GET /api/discovered -> persisted list, no re-scan
router.get("/api/discovered", (req, res) => {
  res.json(discovered.loadDiscovered());
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
