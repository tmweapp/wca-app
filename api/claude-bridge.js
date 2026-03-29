/**
 * api/claude-bridge.js — Relay tra Claude e Chrome Extension
 *
 * Usa la tabella wca_session esistente come message queue.
 * Usa il campo `id` (TEXT PRIMARY KEY) per gli slot.
 *
 * GET ?action=cmd&js=...       → Claude invia comando JS
 * GET ?action=nav&url=...      → Claude invia URL da navigare
 * GET ?action=poll             → Extension prende il comando pendente
 * GET ?action=done&result=...  → Extension scrive il risultato
 * GET ?action=read             → Claude legge l'ultimo risultato
 * GET ?action=status           → Stato del bridge
 * GET ?action=tabs&result=...  → Extension scrive lista tab
 * GET ?action=gettabs          → Claude legge lista tab
 * GET ?action=ping             → Healthcheck
 */
const fetch = require("node-fetch");

const SUPABASE_URL = process.env.SUPABASE_URL || "https://dlldkrzoxvjxpgkkttxu.supabase.co";
const SUPABASE_KEY = (process.env.SUPABASE_SERVICE_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRsbGRrcnpveHZqeHBna2t0dHh1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1ODcyMDU4NCwiZXhwIjoyMDc0Mjk2NTg0fQ.py_d96kA6Mqvi0ugBm4gmIlJSoOC_KbwUM7cgDR-O_E").trim();

const HEADERS = {
  "apikey": SUPABASE_KEY,
  "Authorization": `Bearer ${SUPABASE_KEY}`,
  "Content-Type": "application/json",
  "Prefer": "resolution=merge-duplicates,return=minimal",
};

// Slot IDs — usa il campo `id` (TEXT PK) della tabella wca_session
const SLOT_IDS = {
  "__claude_cmd":    "__claude_cmd",
  "__claude_result": "__claude_result",
  "__claude_tabs":   "__claude_tabs",
};

async function setSlot(slotName, data) {
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/wca_session?on_conflict=id`, {
    method: "POST",
    headers: HEADERS,
    body: JSON.stringify({
      id: SLOT_IDS[slotName],
      cookies: JSON.stringify(data),
      updated_at: new Date().toISOString(),
    }),
  });
  if (!resp.ok) {
    const err = await resp.text();
    console.error(`[claude-bridge] setSlot(${slotName}) error ${resp.status}: ${err.substring(0, 200)}`);
  }
  return resp.ok;
}

async function getSlot(slotName) {
  const resp = await fetch(
    `${SUPABASE_URL}/rest/v1/wca_session?id=eq.${SLOT_IDS[slotName]}&select=cookies,updated_at`,
    { headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}` } }
  );
  if (!resp.ok) return null;
  const rows = await resp.json();
  if (rows.length === 0) return null;
  try { return JSON.parse(rows[0].cookies); } catch { return rows[0].cookies; }
}

async function clearSlot(slotName) {
  await fetch(`${SUPABASE_URL}/rest/v1/wca_session?id=eq.${SLOT_IDS[slotName]}`, {
    method: "DELETE",
    headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}` },
  });
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const { action, js, url, result, tabId } = req.query || {};

    // ── Ping ──
    if (action === "ping") {
      return res.json({ ok: true, ts: Date.now(), version: "1.1" });
    }

    // ── Claude invia comando JS ──
    if (action === "cmd") {
      if (!js) return res.json({ error: "js parameter required" });
      const ok = await setSlot("__claude_cmd", {
        type: "js",
        code: js,
        tabId: tabId ? parseInt(tabId) : null,
        ts: Date.now(),
      });
      return res.json({ ok, action: "cmd_queued" });
    }

    // ── Claude invia navigazione ──
    if (action === "nav") {
      if (!url) return res.json({ error: "url parameter required" });
      const ok = await setSlot("__claude_cmd", {
        type: "nav",
        url,
        tabId: tabId ? parseInt(tabId) : null,
        ts: Date.now(),
      });
      return res.json({ ok, action: "nav_queued" });
    }

    // ── Extension prende il comando pendente ──
    if (action === "poll") {
      const cmd = await getSlot("__claude_cmd");
      if (!cmd) return res.json({ empty: true });
      await clearSlot("__claude_cmd");
      return res.json({ ok: true, command: cmd });
    }

    // ── Extension scrive il risultato ──
    if (action === "done") {
      if (!result) return res.json({ error: "result parameter required" });
      let parsed;
      try { parsed = JSON.parse(result); } catch { parsed = result; }
      const ok = await setSlot("__claude_result", { data: parsed, ts: Date.now() });
      return res.json({ ok, action: "result_saved" });
    }

    // ── Claude legge l'ultimo risultato ──
    if (action === "read") {
      const r = await getSlot("__claude_result");
      if (!r) return res.json({ empty: true });
      await clearSlot("__claude_result");
      return res.json({ ok: true, ...r });
    }

    // ── Extension scrive lista tab ──
    if (action === "tabs") {
      if (!result) return res.json({ error: "result parameter required" });
      let parsed;
      try { parsed = JSON.parse(result); } catch { parsed = result; }
      const ok = await setSlot("__claude_tabs", { tabs: parsed, ts: Date.now() });
      return res.json({ ok, action: "tabs_saved" });
    }

    // ── Claude legge lista tab ──
    if (action === "gettabs") {
      const t = await getSlot("__claude_tabs");
      if (!t) return res.json({ empty: true });
      return res.json({ ok: true, ...t });
    }

    // ── Stato ──
    if (action === "status") {
      const cmd = await getSlot("__claude_cmd");
      const r = await getSlot("__claude_result");
      const t = await getSlot("__claude_tabs");
      return res.json({
        ok: true,
        hasPendingCommand: !!cmd,
        hasResult: !!r,
        tabCount: t?.tabs?.length || 0,
        lastUpdate: t?.ts || null,
      });
    }

    return res.json({ error: "action required: ping|cmd|nav|poll|done|read|tabs|gettabs|status" });
  } catch (err) {
    console.error(`[claude-bridge] Error: ${err.message}`);
    return res.status(500).json({ error: err.message });
  }
};
