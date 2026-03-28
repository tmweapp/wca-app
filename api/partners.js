const fetch = require("node-fetch");
const { SUPABASE_URL, SUPABASE_KEY } = require("./utils/auth");

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const { country, search, page = 1, limit = 100, select, action } = req.query || {};

    // Conteggio partner per paese
    if (action === "country_counts") {
      const url = `${SUPABASE_URL}/rest/v1/rpc/count_by_country`;
      let resp;
      try {
        resp = await fetch(url, {
          method: "POST",
          headers: {
            "apikey": SUPABASE_KEY,
            "Authorization": `Bearer ${SUPABASE_KEY}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({}),
        });
      } catch(e) {}
      // Fallback: carica tutti i country_code e conta lato server
      if (!resp || !resp.ok) {
        const fallbackUrl = `${SUPABASE_URL}/rest/v1/wca_partners?select=country_code&limit=10000`;
        const fbResp = await fetch(fallbackUrl, {
          headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}` },
        });
        if (fbResp.ok) {
          const rows = await fbResp.json();
          const counts = {};
          for (const r of rows) {
            const cc = (r.country_code || "").toUpperCase().trim();
            if (cc) counts[cc] = (counts[cc] || 0) + 1;
          }
          return res.json({ success: true, counts });
        }
        return res.json({ success: true, counts: {} });
      }
      const data = await resp.json();
      const counts = {};
      for (const row of data) counts[row.country_code] = parseInt(row.count);
      return res.json({ success: true, counts });
    }

    const offset = (parseInt(page) - 1) * parseInt(limit);
    const fields = select || "*";

    let url = `${SUPABASE_URL}/rest/v1/wca_partners?select=${encodeURIComponent(fields)}&order=company_name.asc&offset=${offset}&limit=${limit}`;

    if (country) url += `&country_code=ilike.*${encodeURIComponent(country)}*`;
    if (search) url += `&company_name=ilike.*${encodeURIComponent(search)}*`;

    const resp = await fetch(url, {
      headers: {
        "apikey": SUPABASE_KEY,
        "Authorization": `Bearer ${SUPABASE_KEY}`,
        "Prefer": "count=exact",
      },
    });

    if (!resp.ok) {
      const err = await resp.text();
      return res.json({ success: false, error: `Supabase ${resp.status}: ${err}` });
    }

    const data = await resp.json();
    const total = resp.headers.get("content-range")?.split("/")?.[1] || data.length;

    return res.json({ success: true, partners: data, total: parseInt(total), page: parseInt(page) });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};
