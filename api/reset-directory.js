/**
 * api/reset-directory.js — Resetta i dati directory in Supabase
 *
 * Imposta networks=[] e directory_synced_at=null per tutti i partner.
 * I profili (contatti, dettagli, enriched data) restano intatti.
 */
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
    // Update tutti i record: networks=[], directory_synced_at=null
    const resp = await fetch(
      `${SUPABASE_URL}/rest/v1/wca_partners?directory_synced_at=not.is.null`,
      {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "apikey": SUPABASE_KEY,
          "Authorization": `Bearer ${SUPABASE_KEY}`,
          "Prefer": "return=headers-only,count=exact",
        },
        body: JSON.stringify({
          networks: [],
          directory_synced_at: null,
        }),
      }
    );

    if (!resp.ok) {
      const err = await resp.text();
      console.log(`[reset-directory] Supabase error ${resp.status}: ${err.substring(0, 200)}`);
      return res.json({ success: false, error: `Supabase ${resp.status}` });
    }

    const count = resp.headers.get("content-range");
    const updated = count ? parseInt(count.split("/")[1]) || 0 : 0;
    console.log(`[reset-directory] Reset completato: ${updated} partner aggiornati`);
    return res.json({ success: true, updated });
  } catch (err) {
    console.log(`[reset-directory] Exception: ${err.message}`);
    return res.status(500).json({ success: false, error: err.message });
  }
};
