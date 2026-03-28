const fetch = require("node-fetch");

const SUPABASE_URL = process.env.SUPABASE_URL || "https://dlldkrzoxvjxpgkkttxu.supabase.co";
const SUPABASE_KEY = (process.env.SUPABASE_SERVICE_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRsbGRrcnpveHZqeHBna2t0dHh1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1ODcyMDU4NCwiZXhwIjoyMDc0Mjk2NTg0fQ.py_d96kA6Mqvi0ugBm4gmIlJSoOC_KbwUM7cgDR-O_E").trim();
const SB = { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json" };

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  try {
    const { confirm } = req.body || {};
    if (confirm !== "RESET_ALL") {
      return res.status(400).json({ error: "Invia { confirm: 'RESET_ALL' } per confermare" });
    }

    const results = {};

    // 1. Cancella TUTTI i partner
    const r1 = await fetch(`${SUPABASE_URL}/rest/v1/wca_partners?wca_id=gt.0`, {
      method: "DELETE", headers: { ...SB, "Prefer": "return=representation,count=exact" },
    });
    results.partners = { status: r1.status, deleted: r1.headers.get("content-range") || "all" };

    // 2. Cancella TUTTI i job
    const r2 = await fetch(`${SUPABASE_URL}/rest/v1/wca_jobs?id=gt.0`, {
      method: "DELETE", headers: { ...SB, "Prefer": "return=minimal" },
    });
    results.jobs = { status: r2.status };

    // 3. Cancella la sessione cached
    const r3 = await fetch(`${SUPABASE_URL}/rest/v1/wca_session?id=gt.0`, {
      method: "DELETE", headers: { ...SB, "Prefer": "return=minimal" },
    });
    results.session = { status: r3.status };

    console.log("[reset] Full reset completed:", JSON.stringify(results));
    return res.json({ success: true, message: "Database completamente svuotato", results });
  } catch (err) {
    console.log(`[reset] Exception: ${err.message}`);
    return res.status(500).json({ success: false, error: err.message });
  }
};
