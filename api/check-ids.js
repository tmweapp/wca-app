const fetch = require("node-fetch");

const SUPABASE_URL = process.env.SUPABASE_URL || "https://dlldkrzoxvjxpgkkttxu.supabase.co";
const SUPABASE_KEY = (process.env.SUPABASE_SERVICE_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRsbGRrcnpveHZqeHBna2t0dHh1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1ODcyMDU4NCwiZXhwIjoyMDc0Mjk2NTg0fQ.py_d96kA6Mqvi0ugBm4gmIlJSoOC_KbwUM7cgDR-O_E").trim();

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const start = Date.now();
  try {
    const { ids, country } = req.body || {};
    if (!ids || !Array.isArray(ids)) return res.status(400).json({ error: "ids array richiesto" });

    // METODO VELOCE: query Supabase con filtro IN per gli ID specifici
    // Supabase supporta filtro "in" nella query string — max ~300 ID per batch
    const existing = new Set();
    const BATCH = 300;

    for (let i = 0; i < ids.length; i += BATCH) {
      const batch = ids.slice(i, i + BATCH);
      const inFilter = batch.join(",");
      let url = `${SUPABASE_URL}/rest/v1/wca_partners?select=wca_id&wca_id=in.(${inFilter})`;

      const resp = await fetch(url, {
        headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}` },
      });
      if (!resp.ok) {
        console.log(`[check-ids] Supabase error batch ${i}: ${resp.status}`);
        continue;
      }
      const rows = await resp.json();
      for (const r of rows) existing.add(String(r.wca_id));
    }

    const missing = ids.filter(id => !existing.has(String(id)));
    const elapsed = Date.now() - start;

    console.log(`[check-ids] ${ids.length} ID, ${existing.size} in DB, ${missing.length} mancanti — ${elapsed}ms`);
    return res.json({
      success: true,
      total_in_db: existing.size,
      checked: ids.length,
      found: existing.size,
      missing,
      elapsed_ms: elapsed,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message, elapsed_ms: Date.now() - start });
  }
};
// lun 23 mar 2026 18:43:46 +07
