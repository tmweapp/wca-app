const fetch = require("node-fetch");
const SUPABASE_URL = process.env.SUPABASE_URL || "https://dlldkrzoxvjxpgkkttxu.supabase.co";
const SUPABASE_KEY = (process.env.SUPABASE_SERVICE_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRsbGRrcnpveHZqeHBna2t0dHh1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1ODcyMDU4NCwiZXhwIjoyMDc0Mjk2NTg0fQ.py_d96kA6Mqvi0ugBm4gmIlJSoOC_KbwUM7cgDR-O_E").trim();
const D={"wcaworld.com":"https://www.wcaworld.com","wcaprojects.com":"https://www.wcaprojects.com","wcadangerousgoods.com":"https://www.wcadangerousgoods.com","wcaperishables.com":"https://www.wcaperishables.com","wcatimecritical.com":"https://www.wcatimecritical.com","wcapharma.com":"https://www.wcapharma.com","wcarelocations.com":"https://www.wcarelocations.com","wcaecommercesolutions.com":"https://www.wcaecommercesolutions.com","wcaexpo.com":"https://www.wcaexpo.com","lognetglobal.com":"https://www.lognetglobal.com","globalaffinityalliance.com":"https://www.globalaffinityalliance.com","elitegln.com":"https://www.elitegln.com","ifc8.network":"https://ifc8.network","wca-first":"https://www.wcaworld.com","wca-advanced":"https://www.wcaworld.com","wca-chinaglobal":"https://www.wcaworld.com","wca-interglobal":"https://www.wcaworld.com","wca-vendors":"https://www.wcaworld.com"};
module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(200).end();
  try {
    const { country, force } = req.query || {};
    let allRows = [], offset = 0;
    while (true) {
      const cf = country ? "&country_code=eq." + country : "";
      const uf = force ? "" : "&or=(scrape_url.is.null,scrape_url.eq.)";
      const resp = await fetch(SUPABASE_URL + "/rest/v1/wca_directory?select=id,wca_id,networks" + cf + uf + "&order=id.asc&limit=1000&offset=" + offset, {
        headers: { "apikey": SUPABASE_KEY, "Authorization": "Bearer " + SUPABASE_KEY }
      });
      if (!resp.ok) return res.json({ success: false, error: "Supabase " + resp.status });
      const rows = await resp.json();
      allRows.push(...rows);
      if (rows.length < 1000) break;
      offset += 1000;
    }
    if (allRows.length === 0) return res.json({ success: true, updated: 0, message: "Nessun partner da aggiornare" });
    let updated = 0, noNet = 0;
    for (const row of allRows) {
      const nets = row.networks || [];
      const best = nets.length > 0 ? nets[0] : "wcaworld.com";
      if (nets.length === 0) noNet++;
      const base = D[best] || D["wcaworld.com"];
      const resp = await fetch(SUPABASE_URL + "/rest/v1/wca_directory?id=eq." + row.id, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "apikey": SUPABASE_KEY, "Authorization": "Bearer " + SUPABASE_KEY, "Prefer": "return=minimal" },
        body: JSON.stringify({ scrape_url: base + "/directory/members/" + row.wca_id }),
      });
      if (resp.ok) updated++;
    }
    return res.json({ success: true, updated, total: allRows.length, noNetwork: noNet });
  } catch (err) { return res.status(500).json({ success: false, error: err.message }); }
};
