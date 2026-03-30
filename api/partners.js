const fetch = require("node-fetch");
const { SUPABASE_URL, SUPABASE_KEY } = require("./utils/auth");

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const { country, search, page = 1, limit = 100, select, action } = req.query || {};

    // Lista wca_id già presenti per un paese (per evitare re-download)
    if (action === "existing_ids" && country) {
      const ids = [];
      let offset = 0;
      const batchSize = 1000;
      while (true) {
        const url = `${SUPABASE_URL}/rest/v1/wca_profiles?select=wca_id&country_code=ilike.${encodeURIComponent(country)}&order=wca_id.asc&offset=${offset}&limit=${batchSize}`;
        const r = await fetch(url, {
          headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}` },
        });
        if (!r.ok) break;
        const rows = await r.json();
        if (!rows || rows.length === 0) break;
        for (const row of rows) if (row.wca_id) ids.push(row.wca_id);
        if (rows.length < batchSize) break;
        offset += batchSize;
      }
      return res.json({ success: true, ids, count: ids.length });
    }

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
      // Fallback: carica tutti i country_code con paginazione e conta lato server
      if (!resp || !resp.ok) {
        const counts = {};
        let offset = 0;
        const batchSize = 1000;
        while (true) {
          const fallbackUrl = `${SUPABASE_URL}/rest/v1/wca_profiles?select=country_code&order=wca_id.asc&offset=${offset}&limit=${batchSize}`;
          const fbResp = await fetch(fallbackUrl, {
            headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}` },
          });
          if (!fbResp.ok) break;
          const rows = await fbResp.json();
          if (!rows || rows.length === 0) break;
          for (const r of rows) {
            const cc = (r.country_code || "").toUpperCase().trim();
            if (cc) counts[cc] = (counts[cc] || 0) + 1;
          }
          if (rows.length < batchSize) break;
          offset += batchSize;
        }
        return res.json({ success: true, counts });
      }
      const data = await resp.json();
      const counts = {};
      for (const row of data) counts[row.country_code] = parseInt(row.count);
      return res.json({ success: true, counts });
    }

    const reqLimit = parseInt(limit);
    const reqPage = parseInt(page);
    const fields = select || "*";

    let filters = "";
    if (country) filters += `&country_code=ilike.*${encodeURIComponent(country)}*`;
    if (search) filters += `&company_name=ilike.*${encodeURIComponent(search)}*`;

    // Se il limit richiesto è > 1000, pagina automaticamente (Supabase max 1000/request)
    if (reqLimit > 1000) {
      const allData = [];
      let off = 0;
      const batchSize = 1000;
      while (true) {
        const url = `${SUPABASE_URL}/rest/v1/wca_profiles?select=${encodeURIComponent(fields)}&order=company_name.asc&offset=${off}&limit=${batchSize}${filters}`;
        const r = await fetch(url, {
          headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}` },
        });
        if (!r.ok) break;
        const rows = await r.json();
        if (!rows || rows.length === 0) break;
        allData.push(...rows);
        if (rows.length < batchSize) break;
        off += batchSize;
      }
      return res.json({ success: true, partners: allData, total: allData.length, page: 1 });
    }

    const offset = (reqPage - 1) * reqLimit;
    const url = `${SUPABASE_URL}/rest/v1/wca_profiles?select=${encodeURIComponent(fields)}&order=company_name.asc&offset=${offset}&limit=${reqLimit}${filters}`;

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

    return res.json({ success: true, partners: data, total: parseInt(total), page: reqPage });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};
