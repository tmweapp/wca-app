/**
 * api/clear-cache.js — Svuota cache sessione WCA in Supabase
 * Forza un fresh login al prossimo scrape
 */
const { SUPABASE_URL, SUPABASE_KEY } = require("./utils/auth");
const fetch = require("node-fetch");

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    // Cancella TUTTE le righe dalla tabella wca_session
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/wca_session?id=gte.0`, {
      method: "DELETE",
      headers: {
        "apikey": SUPABASE_KEY,
        "Authorization": `Bearer ${SUPABASE_KEY}`,
        "Prefer": "return=representation",
      },
      timeout: 5000,
    });
    const deleted = await resp.json().catch(() => []);
    console.log(`[clear-cache] Cancellate ${deleted.length} sessioni cached`);

    // Info env vars
    const hasEnvUser = !!process.env.WCA_USERNAME;
    const hasEnvPwd = !!process.env.WCA_PASSWORD;
    const username = process.env.WCA_USERNAME || "tmsrlmin";

    return res.json({
      success: true,
      deleted: deleted.length,
      env: { hasEnvUser, hasEnvPwd, username },
      message: "Cache svuotata. Il prossimo scrape farà un fresh SSO login."
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
