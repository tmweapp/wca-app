const fetch = require("node-fetch");
const { SUPABASE_URL, SUPABASE_KEY } = require("./utils/auth");

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const wcaId = req.query.id || req.query.wca_id;
  if (!wcaId) return res.json({ error: "?id=XXXX richiesto" });

  try {
    // Check wca_directory
    const r1 = await fetch(`${SUPABASE_URL}/rest/v1/wca_directory?select=wca_id,networks,scrape_url,scrape_domain,country,name&wca_id=eq.${wcaId}`, {
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }
    });
    const dir = await r1.json();

    // Check wca_profiles
    const r2 = await fetch(`${SUPABASE_URL}/rest/v1/wca_profiles?select=wca_id,company_name,networks,email,phone,contacts&wca_id=eq.${wcaId}`, {
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }
    });
    const prof = await r2.json();

    // Sample: 5 random directory entries WITH networks to see format
    const r3 = await fetch(`${SUPABASE_URL}/rest/v1/wca_directory?select=wca_id,networks,scrape_url&limit=5&order=wca_id.desc&scrape_url=neq.`, {
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` }
    });
    const sample = await r3.json();

    return res.json({
      directory: dir,
      profile: prof.map(p => ({ ...p, contacts: p.contacts?.length + " contatti" })),
      sample_directory: sample.map(s => ({ wca_id: s.wca_id, networks: s.networks, scrape_url: s.scrape_url?.substring(0, 80) })),
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
};
