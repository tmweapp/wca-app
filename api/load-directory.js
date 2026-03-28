/**
 * api/load-directory.js — Carica la directory da Supabase
 *
 * Restituisce tutti i partner per un paese (o tutti se nessun paese specificato)
 * con dati minimi: wca_id, company_name, country_code, networks.
 * Usato dal frontend per popolare la cache al boot.
 */
const fetch = require("node-fetch");

const SUPABASE_URL = process.env.SUPABASE_URL || "https://dlldkrzoxvjxpgkkttxu.supabase.co";
const SUPABASE_KEY = (process.env.SUPABASE_SERVICE_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRsbGRrcnpveHZqeHBna2t0dHh1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1ODcyMDU4NCwiZXhwIjoyMDc0Mjk2NTg0fQ.py_d96kA6Mqvi0ugBm4gmIlJSoOC_KbwUM7cgDR-O_E").trim();

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const { country, mode } = req.query || {};

    // mode=stats → solo conteggi per paese (per header counters)
    if (mode === "stats") {
      // Conta partner per paese e totale
      const resp = await fetch(
        `${SUPABASE_URL}/rest/v1/wca_partners?select=country_code,wca_id&directory_synced_at=not.is.null`,
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
      const byCountry = {};
      for (const r of rows) {
        const cc = r.country_code || "??";
        byCountry[cc] = (byCountry[cc] || 0) + 1;
      }
      const totalPartners = rows.length;
      const totalCountries = Object.keys(byCountry).length;
      return res.json({ success: true, totalPartners, totalCountries, byCountry });
    }

    // mode=countries → lista paesi con directory_synced_at
    if (mode === "countries") {
      const resp = await fetch(
        `${SUPABASE_URL}/rest/v1/wca_partners?select=country_code&directory_synced_at=not.is.null`,
        {
          headers: {
            "apikey": SUPABASE_KEY,
            "Authorization": `Bearer ${SUPABASE_KEY}`,
          },
        }
      );
      if (!resp.ok) return res.json({ success: false, error: `Supabase ${resp.status}` });
      const rows = await resp.json();
      const countries = [...new Set(rows.map(r => r.country_code).filter(Boolean))];
      return res.json({ success: true, countries, total: countries.length });
    }

    // Carica directory per un paese specifico
    if (!country) {
      return res.status(400).json({ error: "country param richiesto (o mode=stats|countries)" });
    }

    // Fetch tutti i partner del paese con dati directory
    let allRows = [];
    let offset = 0;
    const LIMIT = 1000;
    while (true) {
      const url = `${SUPABASE_URL}/rest/v1/wca_partners?country_code=eq.${country}&select=wca_id,company_name,networks,directory_synced_at&order=wca_id.asc&limit=${LIMIT}&offset=${offset}`;
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
    }));

    const networkCounts = {};
    for (const m of members) {
      for (const n of m.networks) {
        networkCounts[n] = (networkCounts[n] || 0) + 1;
      }
    }

    console.log(`[load-directory] ${country}: ${members.length} members loaded from Supabase`);
    return res.json({
      success: true,
      countryCode: country,
      members,
      networks: networkCounts,
      total: members.length,
    });
  } catch (err) {
    console.log(`[load-directory] Exception: ${err.message}`);
    return res.status(500).json({ success: false, error: err.message });
  }
};
