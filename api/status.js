/**
 * api/status.js — Monitor salute sessioni WCA + statistiche scraping
 * Polling ogni 5s dalla pagina monitor.html
 */
const fetch = require("node-fetch");
const { SUPABASE_URL, SUPABASE_KEY } = require("./utils/auth");

// Mappa ID → dominio (deve coincidere con domainToId in auth.js)
function domainToId(domain) {
  if (!domain || domain === "wcaworld.com") return 1;
  let hash = 100;
  for (let i = 0; i < domain.length; i++) hash = ((hash * 31 + domain.charCodeAt(i)) % 9000) + 100;
  return hash;
}

const KNOWN_DOMAINS = [
  "wcaworld.com", "lognetglobal.com", "globalaffinityalliance.com",
  "elitegln.com", "ifc8.network", "wcaprojects.com", "wcadangerousgoods.com",
  "wcaperishables.com", "wcatimecritical.com", "wcapharma.com",
  "wcarelocations.com", "wcaecommercesolutions.com", "wcaexpo.com",
  "wca-first", "wca-advanced", "wca-chinaglobal", "wca-interglobal", "wca-vendors"
];

const ID_TO_DOMAIN = {};
for (const d of KNOWN_DOMAINS) ID_TO_DOMAIN[domainToId(d)] = d;

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Cache-Control", "no-store");

  try {
    // ── 1. Leggi tutte le sessioni da Supabase ──
    const sessResp = await fetch(`${SUPABASE_URL}/rest/v1/wca_session?select=*&order=updated_at.desc`, {
      headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}` },
      timeout: 8000,
    });
    const sessions = sessResp.ok ? await sessResp.json() : [];

    const now = Date.now();
    const TTL_MS = 10 * 60 * 1000; // 10 min

    const sessionStatus = (Array.isArray(sessions) ? sessions : []).map(s => {
      const age = now - new Date(s.updated_at).getTime();
      const ageMin = +(age / 60000).toFixed(1);
      const hasASPX = !!(s.cookies && s.cookies.includes(".ASPXAUTH"));
      const fresh = age < TTL_MS;
      const warning = age > TTL_MS * 0.7 && age < TTL_MS; // >7min
      const domain = ID_TO_DOMAIN[s.id] || `id_${s.id}`;
      return {
        id: s.id,
        domain,
        age_seconds: Math.round(age / 1000),
        age_min: ageMin,
        hasASPX,
        fresh,
        warning,
        expired: !fresh,
        status: !fresh ? "SCADUTA" : warning ? "IN SCADENZA" : "OK",
        updated_at: s.updated_at,
        cookie_len: s.cookies ? s.cookies.length : 0,
        has_sso: !!(s.sso_cookies && s.sso_cookies.length > 10),
      };
    });

    // ── 2. Leggi eventi recenti dalla tabella wca_events (se esiste) ──
    let events = [];
    try {
      const evResp = await fetch(
        `${SUPABASE_URL}/rest/v1/wca_events?select=*&order=ts.desc&limit=100`,
        { headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}` }, timeout: 5000 }
      );
      if (evResp.ok) {
        const ev = await evResp.json();
        if (Array.isArray(ev)) events = ev;
      }
    } catch (e) { /* tabella non esiste ancora */ }

    // ── 3. Stats DB rapide ──
    let dbStats = {};
    try {
      const countResp = await fetch(
        `${SUPABASE_URL}/rest/v1/wca_profiles?select=wca_id&limit=1`,
        { headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}`, "Prefer": "count=exact" }, timeout: 5000 }
      );
      const ct = countResp.headers.get("content-range");
      dbStats.total_profiles = ct ? parseInt(ct.split("/")[1]) || 0 : 0;
    } catch (e) {}

    return res.json({
      success: true,
      ts: new Date().toISOString(),
      sessions: sessionStatus,
      events,
      db: dbStats,
      ttl_min: 10,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};
