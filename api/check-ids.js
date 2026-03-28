const fetch = require("node-fetch");
const { SUPABASE_URL, SUPABASE_KEY } = require("./utils/auth");

async function loadIdsByCountry(country) {
  const existing = new Set();
  let offset = 0;
  const LIMIT = 1000;
  while (true) {
    let url = `${SUPABASE_URL}/rest/v1/wca_partners?select=wca_id&limit=${LIMIT}&offset=${offset}`;
    if (country) url += `&country_code=eq.${country}`;
    const resp = await fetch(url, {
      headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}` },
    });
    if (!resp.ok) { console.log(`[check-ids] Supabase ${resp.status} offset=${offset}`); break; }
    const rows = await resp.json();
    if (!rows || !rows.length) break;
    for (const r of rows) existing.add(String(r.wca_id));
    if (rows.length < LIMIT) break;
    offset += LIMIT;
  }
  return existing;
}

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

    const existing = await loadIdsByCountry(country || "");

    const missing = ids.filter(id => !existing.has(String(id)));
    const elapsed = Date.now() - start;

    console.log(`[check-ids] country=${country||"ALL"} | richiesti=${ids.length} | in_db=${existing.size} | mancanti=${missing.length} | ${elapsed}ms`);
    return res.json({
      success: true,
      total_in_db: existing.size,
      checked: ids.length,
      found: ids.length - missing.length,
      missing,
      elapsed_ms: elapsed,
    });
  } catch (err) {
    console.log(`[check-ids] ERROR: ${err.message}`);
    return res.status(500).json({ success: false, error: err.message, elapsed_ms: Date.now() - start });
  }
};
