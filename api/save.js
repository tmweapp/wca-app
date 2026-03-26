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
    const { profile } = req.body || {};
    if (!profile || !profile.wca_id) return res.status(400).json({ error: "profile con wca_id richiesto" });

    // Usa country_code ISO dal frontend, altrimenti indovina dall'indirizzo
    let cc = profile.country_code || "";
    if (!cc || cc.length > 2) {
      const addr = profile.address || "";
      const addrParts = addr.split(",");
      cc = addrParts.length > 1 ? addrParts[addrParts.length - 1].trim() : "";
    }

    const row = {
      wca_id: profile.wca_id, company_name: profile.company_name || "", logo_url: profile.logo_url || null,
      branch: profile.branch || "", gm_coverage: profile.gm_coverage ?? null,
      gm_status_text: profile.gm_status_text || "",
      enrolled_offices: profile.enrolled_offices || [], enrolled_since: profile.enrolled_since || "",
      expires: profile.expires || "", networks: profile.networks || [],
      profile_text: profile.profile_text || "",
      address: profile.address || "", mailing: profile.mailing || "", phone: profile.phone || "",
      fax: profile.fax || "", emergency_call: profile.emergency_call || "",
      website: profile.website || "", email: profile.email || "",
      contacts: profile.contacts || [], services: profile.services || [],
      certifications: profile.certifications || [], branch_cities: profile.branch_cities || [],
      country_code: cc.toUpperCase(), raw_data: profile, updated_at: new Date().toISOString(),
    };

    console.log(`[save] Saving wca_id=${profile.wca_id} company="${profile.company_name}"`);
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/wca_partners?on_conflict=wca_id`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json", "apikey": SUPABASE_KEY,
        "Authorization": `Bearer ${SUPABASE_KEY}`, "Prefer": "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify(row),
    });

    if (!resp.ok) {
      const err = await resp.text();
      console.log(`[save] Supabase error ${resp.status}: ${err}`);
      return res.json({ success: false, error: `Supabase ${resp.status}: ${err}` });
    }

    console.log(`[save] OK wca_id=${profile.wca_id}`);
    return res.json({ success: true, wca_id: profile.wca_id });
  } catch (err) {
    console.log(`[save] Exception: ${err.message}`);
    return res.status(500).json({ success: false, error: err.message });
  }
};
