/**
 * api/load-directory.js — Carica la directory da Supabase
 *
 * Restituisce tutti i partner per un paese (o tutti se nessun paese specificato)
 * con dati minimi: wca_id, company_name, country_code, networks.
 * Usato dal frontend per popolare la cache al boot.
 */
const fetch = require("node-fetch");
const { SUPABASE_URL, SUPABASE_KEY } = require("./utils/auth");

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const { country, mode } = req.query || {};

    // mode=stats → conteggi per paese (TUTTI i record, non solo directory_synced)
    if (mode === "stats") {
      // Pagina tutti i record per contare per paese
      let allRows = [];
      let offset = 0;
      const LIMIT = 1000;
      while (true) {
        const resp = await fetch(
          `${SUPABASE_URL}/rest/v1/wca_directory?select=country_code,wca_id&order=wca_id.asc&limit=${LIMIT}&offset=${offset}`,
          {
            headers: {
              "apikey": SUPABASE_KEY,
              "Authorization": `Bearer ${SUPABASE_KEY}`,
            },
          }
        );
        if (!resp.ok) {
          return res.json({ success: false, error: `Supabase ${resp.status}` });
        }
        const rows = await resp.json();
        allRows.push(...rows);
        if (rows.length < LIMIT) break;
        offset += LIMIT;
      }
      const byCountry = {};
      for (const r of allRows) {
        const cc = r.country_code || "??";
        byCountry[cc] = (byCountry[cc] || 0) + 1;
      }
      const totalPartners = allRows.length;
      const totalCountries = Object.keys(byCountry).length;
      console.log(`[load-directory] stats: ${totalPartners} total partners, ${totalCountries} countries`);
      return res.json({ success: true, totalPartners, totalCountries, byCountry });
    }

    // mode=countries → lista tutti i paesi
    if (mode === "countries") {
      let allRows = [];
      let offset = 0;
      const LIMIT = 1000;
      while (true) {
        const resp = await fetch(
          `${SUPABASE_URL}/rest/v1/wca_directory?select=country_code&order=wca_id.asc&limit=${LIMIT}&offset=${offset}`,
          {
            headers: {
              "apikey": SUPABASE_KEY,
              "Authorization": `Bearer ${SUPABASE_KEY}`,
            },
          }
        );
        if (!resp.ok) return res.json({ success: false, error: `Supabase ${resp.status}` });
        const rows = await resp.json();
        allRows.push(...rows);
        if (rows.length < LIMIT) break;
        offset += LIMIT;
      }
      const countries = [...new Set(allRows.map(r => r.country_code).filter(Boolean))];
      return res.json({ success: true, countries, total: countries.length });
    }

    // Carica tutti i partner (senza country) o per un paese specifico
    // SOLO quelli con directory_synced_at valorizzato (escludi resettati)
    const countryFilter = country ? `country_code=eq.${country}&` : "";

    // Fetch partner con paginazione
    let allRows = [];
    let offset = 0;
    const LIMIT = 1000;
    while (true) {
      const url = `${SUPABASE_URL}/rest/v1/wca_directory?${countryFilter}directory_synced_at=not.is.null&select=wca_id,company_name,country_code,networks,scrape_url,directory_synced_at&order=wca_id.asc&limit=${LIMIT}&offset=${offset}`;
      const resp = await fetch(url, {
        headers: {
          "apikey": SUPABASE_KEY,
          "Authorization": `Bearer ${SUPABASE_KEY}`,
        },
      });
      if (!resp.ok) {
        return res.json({ success: false, error: `Supabase ${resp.status}` });
      }
      const rows = await resp.json();
      allRows.push(...rows);
      if (rows.length < LIMIT) break;
      offset += LIMIT;
    }

    // Trasforma in formato directory
    const members = allRows.map(r => ({
      id: r.wca_id,
      name: r.company_name || "",
      href: `/directory/members/${r.wca_id}`,
      networks: r.networks || [],
      scrape_url: r.scrape_url || "",
      countryCode: r.country_code || "",
    }));

    const networkCounts = {};
    for (const m of members) {
      for (const n of m.networks) {
        networkCounts[n] = (networkCounts[n] || 0) + 1;
      }
    }

    console.log(`[load-directory] ${country || "ALL"}: ${members.length} members loaded from Supabase`);
    return res.json({
      success: true,
      countryCode: country || "ALL",
      members,
      networks: networkCounts,
      total: members.length,
    });
  } catch (err) {
    console.log(`[load-directory] Exception: ${err.message}`);
    return res.status(500).json({ success: false, error: err.message });
  }
};
