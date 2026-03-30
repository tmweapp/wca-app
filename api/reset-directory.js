/**
 * api/reset-directory.js — Resetta la tabella wca_directory in Supabase
 *
 * Cancella TUTTI i record dalla tabella wca_directory.
 * NON tocca wca_profiles.
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
    const resp = await fetch(
      `${SUPABASE_URL}/rest/v1/wca_directory?wca_id=gt.0`,
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
    console.log(`[reset-directory] Cancellati ${deleted} record da wca_directory`);
    return res.json({ success: true, deleted });
  } catch (err) {
    console.log(`[reset-directory] Exception: ${err.message}`);
    return res.status(500).json({ success: false, error: err.message });
  }
};
