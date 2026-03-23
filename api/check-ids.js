const fetch = require("node-fetch");

const SUPABASE_URL = process.env.SUPABASE_URL || "https://dlldkrzoxvjxpgkkttxu.supabase.co";
const SUPABASE_KEY = (process.env.SUPABASE_SERVICE_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRsbGRrcnpveHZqeHBna2t0dHh1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1ODcyMDU4NCwiZXhwIjoyMDc0Mjk2NTg0fQ.py_d96kA6Mqvi0ugBm4gmIlJSoOC_KbwUM7cgDR-O_E").trim();

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  try {
    const { ids } = req.body || {};
    if (!ids || !Array.isArray(ids)) return res.status(400).json({ error: "ids array richiesto" });

    // Carica TUTTI gli wca_id da Supabase
    const existing = new Set();
    let page = 0;
    while (true) {
      const url = `${SUPABASE_URL}/rest/v1/wca_partners?select=wca_id&limit=1000&offset=${page * 1000}`;
      const resp = await fetch(url, {
        headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}` },
      });
      if (!resp.ok) break;
      const rows = await resp.json();
      if (!rows?.length) break;
      for (const r of rows) existing.add(String(r.wca_id));
      if (rows.length < 1000) break;
      page++;
    }

    // Confronta: quali ID mancano?
    const missing = ids.filter(id => !existing.has(String(id)));
    const found = ids.length - missing.length;

    console.log(`[check-ids] Richiesti: ${ids.length}, In DB: ${existing.size}, Trovati: ${found}, Mancanti: ${missing.length}`);
    return res.json({ success: true, total_in_db: existing.size, checked: ids.length, found, missing });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};
