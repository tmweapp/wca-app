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
    if (action === "existing_ids") {
      // Carica TUTTI gli wca_id presenti in wca_profiles (senza filtro country)
      // La directory sa già quali ID servono per il paese — qui serve solo sapere
      // cosa esiste GIÀ nel DB, indipendentemente dal country_code salvato
      // (evita ri-download di profili orfani con country_code sbagliato)
      const ids = [];
      let offset = 0;
      const batchSize = 1000;
      while (true) {
        const url = `${SUPABASE_URL}/rest/v1/wca_profiles?select=wca_id&order=wca_id.asc&offset=${offset}&limit=${batchSize}`;
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
        let orphans = 0;
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
            // Solo codici ISO 2 lettere validi
            if (cc && cc.length === 2 && /^[A-Z]{2}$/.test(cc)) {
              counts[cc] = (counts[cc] || 0) + 1;
            } else {
              orphans++;
            }
          }
          if (rows.length < batchSize) break;
          offset += batchSize;
        }
        return res.json({ success: true, counts, orphans });
      }
      const data = await resp.json();
      const counts = {};
      let orphans = 0;
      for (const row of data) {
        const cc = (row.country_code || "").toUpperCase().trim();
        if (cc && cc.length === 2 && /^[A-Z]{2}$/.test(cc)) {
          counts[cc] = parseInt(row.count);
        } else {
          orphans += parseInt(row.count);
        }
      }
      return res.json({ success: true, counts, orphans });
    }

    // Trova profili orfani (country_code invalido o mancante)
    if (action === "orphan_profiles") {
      const orphans = [];
      let offset = 0;
      const batchSize = 1000;
      while (true) {
        const url = `${SUPABASE_URL}/rest/v1/wca_profiles?select=wca_id,company_name,country_code&order=wca_id.asc&offset=${offset}&limit=${batchSize}`;
        const r = await fetch(url, {
          headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}` },
        });
        if (!r.ok) break;
        const rows = await r.json();
        if (!rows || rows.length === 0) break;
        for (const row of rows) {
          const cc = (row.country_code || "").toUpperCase().trim();
          if (!cc || cc.length !== 2 || !/^[A-Z]{2}$/.test(cc)) {
            orphans.push({ wca_id: row.wca_id, company_name: row.company_name, country_code: row.country_code });
          }
        }
        if (rows.length < batchSize) break;
        offset += batchSize;
      }
      return res.json({ success: true, orphans, count: orphans.length });
    }

    // Correggi orfani: assegna country_code dalla directory o elimina
    if (action === "fix_orphans") {
      if (req.method !== "GET") return res.status(405).json({ error: "GET only" });
      // Carica mappa wca_id → country_code dalla directory
      const dirMap = {};
      let offset = 0;
      const batchSize = 1000;
      while (true) {
        const url = `${SUPABASE_URL}/rest/v1/wca_directory?select=wca_id,country_code&order=wca_id.asc&offset=${offset}&limit=${batchSize}`;
        const r = await fetch(url, {
          headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}` },
        });
        if (!r.ok) break;
        const rows = await r.json();
        if (!rows || rows.length === 0) break;
        for (const row of rows) dirMap[row.wca_id] = row.country_code;
        if (rows.length < batchSize) break;
        offset += batchSize;
      }

      // Trova orfani
      const orphans = [];
      offset = 0;
      while (true) {
        const url = `${SUPABASE_URL}/rest/v1/wca_profiles?select=wca_id,company_name,country_code&order=wca_id.asc&offset=${offset}&limit=${batchSize}`;
        const r = await fetch(url, {
          headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}` },
        });
        if (!r.ok) break;
        const rows = await r.json();
        if (!rows || rows.length === 0) break;
        for (const row of rows) {
          const cc = (row.country_code || "").toUpperCase().trim();
          if (!cc || cc.length !== 2 || !/^[A-Z]{2}$/.test(cc)) {
            orphans.push(row);
          }
        }
        if (rows.length < batchSize) break;
        offset += batchSize;
      }

      let fixed = 0, deleted = 0, failed = 0;
      for (const o of orphans) {
        const dirCC = dirMap[o.wca_id];
        if (dirCC && dirCC.length === 2) {
          // Fix: aggiorna country_code dalla directory
          const patchUrl = `${SUPABASE_URL}/rest/v1/wca_profiles?wca_id=eq.${encodeURIComponent(o.wca_id)}`;
          const pr = await fetch(patchUrl, {
            method: "PATCH",
            headers: {
              "Content-Type": "application/json",
              "apikey": SUPABASE_KEY,
              "Authorization": `Bearer ${SUPABASE_KEY}`,
              "Prefer": "return=minimal",
            },
            body: JSON.stringify({ country_code: dirCC }),
          });
          if (pr.ok) fixed++;
          else failed++;
        } else {
          // Non in directory → elimina profilo orfano
          const delUrl = `${SUPABASE_URL}/rest/v1/wca_profiles?wca_id=eq.${encodeURIComponent(o.wca_id)}`;
          const dr = await fetch(delUrl, {
            method: "DELETE",
            headers: {
              "apikey": SUPABASE_KEY,
              "Authorization": `Bearer ${SUPABASE_KEY}`,
            },
          });
          if (dr.ok) deleted++;
          else failed++;
        }
      }

      return res.json({ success: true, total: orphans.length, fixed, deleted, failed });
    }

    // Trova profili mancanti: in wca_directory ma NON in wca_profiles
    // + record directory con networks vuoti
    if (action === "network_orphans") {
      // 1. Carica tutti gli wca_id da wca_profiles
      const profileIds = new Set();
      let off1 = 0;
      while (true) {
        const url = `${SUPABASE_URL}/rest/v1/wca_profiles?select=wca_id&order=wca_id.asc&offset=${off1}&limit=1000`;
        const r = await fetch(url, { headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}` } });
        if (!r.ok) break;
        const rows = await r.json();
        if (!rows || rows.length === 0) break;
        for (const row of rows) profileIds.add(row.wca_id);
        if (rows.length < 1000) break;
        off1 += 1000;
      }

      // 2. Carica wca_directory e trova: mancanti (non in profiles) + senza network
      const missing = [];   // in directory, non in profiles
      const noNetwork = []; // in directory, networks vuoto
      let off2 = 0;
      while (true) {
        const url = `${SUPABASE_URL}/rest/v1/wca_directory?select=wca_id,company_name,country_code,networks&order=country_code.asc,wca_id.asc&offset=${off2}&limit=1000`;
        const r = await fetch(url, { headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}` } });
        if (!r.ok) break;
        const rows = await r.json();
        if (!rows || rows.length === 0) break;
        for (const row of rows) {
          const hasNet = row.networks && Array.isArray(row.networks) && row.networks.length > 0;
          if (!profileIds.has(row.wca_id)) {
            missing.push({ wca_id: row.wca_id, company_name: row.company_name, country_code: row.country_code, hasNetwork: hasNet });
          }
          if (!hasNet) {
            noNetwork.push({ wca_id: row.wca_id, company_name: row.company_name, country_code: row.country_code });
          }
        }
        if (rows.length < 1000) break;
        off2 += 1000;
      }

      // 3. Raggruppa mancanti per paese
      const byCountry = {};
      for (const m of missing) {
        const cc = m.country_code || "??";
        if (!byCountry[cc]) byCountry[cc] = { missing: [], noNetwork: 0 };
        byCountry[cc].missing.push({ wca_id: m.wca_id, company_name: m.company_name, hasNetwork: m.hasNetwork });
      }
      // Conta anche no-network per paese
      for (const n of noNetwork) {
        const cc = n.country_code || "??";
        if (!byCountry[cc]) byCountry[cc] = { missing: [], noNetwork: 0 };
        byCountry[cc].noNetwork++;
      }

      return res.json({
        success: true,
        totalMissing: missing.length,
        totalNoNetwork: noNetwork.length,
        totalProfiles: profileIds.size,
        byCountry
      });
    }

    // Conteggio DIRECTORY per paese (wca_directory)
    // Migrate: add company_group column if not exists
    if (action === "migrate_company_group") {
      try {
        // Try to read column first
        const testUrl = `${SUPABASE_URL}/rest/v1/wca_business_cards?select=company_group&limit=1`;
        const testR = await fetch(testUrl, {
          headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}` },
        });
        if (testR.ok) {
          return res.json({ success: true, message: "column already exists" });
        }
        // Column doesn't exist — create via rpc/sql
        const sqlUrl = `${SUPABASE_URL}/rest/v1/rpc/exec_sql`;
        const sqlR = await fetch(sqlUrl, {
          method: "POST",
          headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({ query: "ALTER TABLE wca_business_cards ADD COLUMN IF NOT EXISTS company_group TEXT DEFAULT NULL" }),
        });
        if (sqlR.ok) {
          return res.json({ success: true, message: "column created via rpc" });
        }
        // Fallback: try direct SQL via pg (service_role has permission)
        // If rpc doesn't work, we'll store in notes field as fallback
        return res.json({ success: true, message: "column may need manual creation", fallback: true });
      } catch (e) {
        return res.json({ success: false, error: e.message });
      }
    }

    if (action === "directory_counts") {
      const counts = {};
      let offset = 0;
      const batchSize = 1000;
      while (true) {
        const url = `${SUPABASE_URL}/rest/v1/wca_directory?select=country_code&order=wca_id.asc&offset=${offset}&limit=${batchSize}`;
        const resp = await fetch(url, {
          headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}` },
        });
        if (!resp.ok) break;
        const rows = await resp.json();
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
