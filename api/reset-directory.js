/**
 * api/reset-directory.js — Resetta i dati directory in Supabase
 *
 * Imposta networks=[] e directory_synced_at=null per tutti i partner.
 * I profili (contatti, dettagli, enriched data) restano intatti.
 */
const fetch = require("node-fetch");
const { SUPABASE_URL, SUPABASE_KEY } = require("./utils/auth");

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  try {
    // CANCELLA tutti i record directory da Supabase (quelli con directory_synced_at not null)
    const resp = await fetch(
      `${SUPABASE_URL}/rest/v1/wca_partners?directory_synced_at=not.is.null`,
      {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json",
          "apikey": SUPABASE_KEY,
          "Authorization": `Bearer ${SUPABASE_KEY}`,
          "Prefer": "return=representation,count=exact",
        }
      }
    );

    if (!resp.ok) {
      const err = await resp.text();
      console.log(`[reset-directory] Supabase error ${resp.status}: ${err.substring(0, 200)}`);
      return res.json({ success: false, error: `Supabase ${resp.status}` });
    }

    const count = resp.headers.get("content-range");
    const deleted = count ? parseInt(count.split("/")[1]) || 0 : 0;
    console.log(`[reset-directory] Cancellati ${deleted} record directory da Supabase`);
    return res.json({ success: true, deleted });
  } catch (err) {
    console.log(`[reset-directory] Exception: ${err.message}`);
    return res.status(500).json({ success: false, error: err.message });
  }
};
