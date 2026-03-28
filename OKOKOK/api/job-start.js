const fetch = require("node-fetch");

const SUPABASE_URL = (process.env.SUPABASE_URL || "https://dlldkrzoxvjxpgkkttxu.supabase.co").trim();
const SUPABASE_KEY = (process.env.SUPABASE_SERVICE_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRsbGRrcnpveHZqeHBna2t0dHh1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1ODcyMDU4NCwiZXhwIjoyMDc0Mjk2NTg0fQ.py_d96kA6Mqvi0ugBm4gmIlJSoOC_KbwUM7cgDR-O_E").trim();

const SB_HEADERS = {
  "apikey": SUPABASE_KEY,
  "Authorization": `Bearer ${SUPABASE_KEY}`,
  "Content-Type": "application/json",
};

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  try {
    const { action, jobId, countries, networks, searchTerm, searchBy } = req.body || {};

    // === PAUSA / RIPRENDI / ANNULLA ===
    if (action === "pause" && jobId) {
      await fetch(`${SUPABASE_URL}/rest/v1/wca_jobs?id=eq.${jobId}`, {
        method: "PATCH", headers: { ...SB_HEADERS, "Prefer": "return=minimal" },
        body: JSON.stringify({ status: "paused", last_activity: "Messo in pausa dall'utente", updated_at: new Date().toISOString() }),
      });
      return res.json({ success: true, action: "paused" });
    }
    if (action === "resume" && jobId) {
      await fetch(`${SUPABASE_URL}/rest/v1/wca_jobs?id=eq.${jobId}`, {
        method: "PATCH", headers: { ...SB_HEADERS, "Prefer": "return=minimal" },
        body: JSON.stringify({ status: "downloading", last_activity: "Ripreso dall'utente", updated_at: new Date().toISOString() }),
      });
      return res.json({ success: true, action: "resumed" });
    }
    if (action === "cancel" && jobId) {
      await fetch(`${SUPABASE_URL}/rest/v1/wca_jobs?id=eq.${jobId}`, {
        method: "PATCH", headers: { ...SB_HEADERS, "Prefer": "return=minimal" },
        body: JSON.stringify({ status: "cancelled", last_activity: "Annullato dall'utente", updated_at: new Date().toISOString() }),
      });
      return res.json({ success: true, action: "cancelled" });
    }

    // === NUOVO JOB ===
    if (!countries || !countries.length) return res.status(400).json({ error: "Seleziona almeno un paese" });

    // Annulla job attivi precedenti
    await fetch(`${SUPABASE_URL}/rest/v1/wca_jobs?status=in.(pending,discovering,downloading,enriching)`, {
      method: "PATCH", headers: { ...SB_HEADERS, "Prefer": "return=minimal" },
      body: JSON.stringify({ status: "cancelled", last_activity: "Sostituito da nuovo job" }),
    });

    const config = {
      countries,         // [{code:"SG", name:"Singapore"}, ...]
      networks: networks || [],
      searchTerm: searchTerm || "",
      searchBy: searchBy || "",
    };

    const resp = await fetch(`${SUPABASE_URL}/rest/v1/wca_jobs`, {
      method: "POST",
      headers: { ...SB_HEADERS, "Prefer": "return=representation" },
      body: JSON.stringify({
        status: "pending",
        config,
        discovered_members: [],
        current_country_idx: 0,
        current_member_idx: 0,
        delay_index: 0,
        total_scraped: 0,
        total_skipped: 0,
        consecutive_failures: 0,
        last_activity: `Job creato — ${countries.map(c => c.name).join(", ")}`,
        error_log: [],
      }),
    });

    if (!resp.ok) {
      const err = await resp.text();
      return res.json({ success: false, error: `Supabase: ${err}` });
    }

    const jobs = await resp.json();
    const job = jobs[0];

    // Trigger immediato del worker (fire-and-forget)
    const workerUrl = `https://${req.headers.host}/api/worker?jobId=${job.id}`;
    fetch(workerUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }).catch(() => {});

    return res.json({ success: true, jobId: job.id, status: "pending" });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};
