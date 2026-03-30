const fetch = require("node-fetch");
const { SUPABASE_URL, SUPABASE_KEY } = require("./utils/auth");
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

    // 1. Cancella TUTTI i profili
    const r1a = await fetch(`${SUPABASE_URL}/rest/v1/wca_profiles?wca_id=gt.0`, {
      method: "DELETE", headers: { ...SB, "Prefer": "return=representation,count=exact" },
    });
    results.profiles = { status: r1a.status, deleted: r1a.headers.get("content-range") || "all" };

    // 2. Cancella TUTTA la directory
    const r1b = await fetch(`${SUPABASE_URL}/rest/v1/wca_directory?wca_id=gt.0`, {
      method: "DELETE", headers: { ...SB, "Prefer": "return=representation,count=exact" },
    });
    results.directory = { status: r1b.status, deleted: r1b.headers.get("content-range") || "all" };

    // 3. Cancella TUTTI i job
    const r2 = await fetch(`${SUPABASE_URL}/rest/v1/wca_jobs?id=gt.0`, {
      method: "DELETE", headers: { ...SB, "Prefer": "return=minimal" },
    });
    results.jobs = { status: r2.status };

    // 4. Cancella la sessione cached
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
