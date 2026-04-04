const fetch = require("node-fetch");
const { SUPABASE_URL, SUPABASE_KEY } = require("./utils/auth");

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const wcaId = req.query.id || req.query.wca_id;
  if (!wcaId) return res.json({ error: "?id=XXXX richiesto" });

  try {
    // Check wca_directory
    const r1 = await fetch(`${SUPABASE_URL}/rest/v1/wca_directory?select=*&wca_id=eq.${wcaId}`, {
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }
    });
    const dir = await r1.json();

    // Check wca_profiles
    const r2 = await fetch(`${SUPABASE_URL}/rest/v1/wca_profiles?select=wca_id,company_name,networks,email,phone,contacts&wca_id=eq.${wcaId}`, {
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }
    });
    const prof = await r2.json();

    // Stats: conteggio networks vuoti vs pieni
    const rAll = await fetch(`${SUPABASE_URL}/rest/v1/wca_directory?select=wca_id,networks,scrape_url`, {
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, Range: "0-99999" }
    });
    const allDir = await rAll.json();
    const total = allDir.length;
    const emptyNet = allDir.filter(r => !r.networks || r.networks.length === 0).length;
    const hasNet = total - emptyNet;
    const emptyScrapeUrl = allDir.filter(r => !r.scrape_url).length;
    const onlyVirtual = allDir.filter(r => r.networks?.length > 0 && !r.networks.some(n => n.includes("."))).length;
    const hasRealDomain = allDir.filter(r => r.networks?.some(n => n.includes("."))).length;

    // Distribuzione network
    const netCounts = {};
    for (const r of allDir) {
      for (const n of (r.networks || [])) {
        netCounts[n] = (netCounts[n] || 0) + 1;
      }
    }

    return res.json({
      directory: dir,
      profile: prof.map(p => ({ ...p, contacts: p.contacts?.length + " contatti" })),
      stats: { total, emptyNet, hasNet, emptyScrapeUrl, onlyVirtual, hasRealDomain },
      network_distribution: netCounts,
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
