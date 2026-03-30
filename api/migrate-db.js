/**
 * api/migrate-db.js — Crea le tabelle wca_directory e wca_profiles, migra i dati da wca_partners
 *
 * GET  /api/migrate-db           → mostra stato (tabelle esistenti, record)
 * GET  /api/migrate-db?run=yes   → esegue la migrazione
 */
const fetch = require("node-fetch");
const { SUPABASE_URL, SUPABASE_KEY } = require("./utils/auth");

const HEADERS = { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}` };

async function tableExists(name) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${name}?select=*&limit=1`, { headers: HEADERS });
  return r.ok;
}

async function countTable(name) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${name}?select=wca_id&limit=1`, {
    headers: { ...HEADERS, "Prefer": "count=exact" },
  });
  if (!r.ok) return 0;
  const range = r.headers.get("content-range") || "";
  const total = range.split("/")[1];
  return total ? parseInt(total) : 0;
}

async function loadAll(table, fields) {
  const all = [];
  let offset = 0;
  while (true) {
    const url = `${SUPABASE_URL}/rest/v1/${table}?select=${encodeURIComponent(fields)}&order=wca_id.asc&offset=${offset}&limit=1000`;
    const r = await fetch(url, { headers: HEADERS });
    if (!r.ok) break;
    const rows = await r.json();
    if (!rows || rows.length === 0) break;
    all.push(...rows);
    if (rows.length < 1000) break;
    offset += 1000;
  }
  return all;
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const dirExists = await tableExists("wca_directory");
    const profExists = await tableExists("wca_profiles");
    const oldExists = await tableExists("wca_partners");
    const oldCount = oldExists ? await countTable("wca_partners") : 0;

    // Solo stats
    if (req.query.run !== "yes") {
      return res.json({
        wca_partners: { exists: oldExists, count: oldCount },
        wca_directory: { exists: dirExists },
        wca_profiles: { exists: profExists },
        message: "Aggiungi ?run=yes per eseguire la migrazione. PRIMA crea le tabelle in Supabase SQL Editor.",
        sql: `
-- ESEGUI QUESTO SQL in Supabase SQL Editor PRIMA di ?run=yes:

CREATE TABLE IF NOT EXISTS wca_directory (
  wca_id INTEGER PRIMARY KEY,
  company_name TEXT,
  country_code TEXT,
  country_name TEXT,
  networks JSONB DEFAULT '[]',
  scrape_url TEXT,
  directory_synced_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS wca_profiles (
  wca_id INTEGER PRIMARY KEY,
  company_name TEXT,
  logo_url TEXT,
  branch TEXT,
  gm_coverage BOOLEAN,
  gm_status_text TEXT,
  enrolled_offices JSONB DEFAULT '[]',
  enrolled_since TEXT,
  expires TEXT,
  profile_text TEXT,
  address TEXT,
  mailing TEXT,
  phone TEXT,
  fax TEXT,
  emergency_call TEXT,
  website TEXT,
  email TEXT,
  contacts JSONB DEFAULT '[]',
  services JSONB DEFAULT '[]',
  certifications JSONB DEFAULT '[]',
  branch_cities JSONB DEFAULT '[]',
  country_code TEXT,
  country_name TEXT,
  city TEXT,
  member_since DATE,
  networks JSONB DEFAULT '[]',
  raw_data JSONB,
  access_limited BOOLEAN DEFAULT FALSE,
  enriched_from TEXT,
  enriched_domain TEXT,
  blacklist_status TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_directory_country ON wca_directory(country_code);
CREATE INDEX IF NOT EXISTS idx_profiles_country ON wca_profiles(country_code);
        `,
      });
    }

    // === MIGRAZIONE ===
    if (!dirExists || !profExists) {
      return res.json({ success: false, error: "Tabelle wca_directory e/o wca_profiles non esistono. Crea prima con l'SQL mostrato da GET /api/migrate-db" });
    }

    // Carica tutti i record da wca_partners
    const partners = await loadAll("wca_partners", "*");
    console.log(`[migrate] Loaded ${partners.length} records from wca_partners`);

    let dirSaved = 0, profSaved = 0, dirErrors = 0, profErrors = 0;

    // Migra in batch di 500
    for (let i = 0; i < partners.length; i += 500) {
      const batch = partners.slice(i, i + 500);

      // Directory rows
      const dirRows = batch.map(p => ({
        wca_id: p.wca_id,
        company_name: p.company_name || "",
        country_code: p.country_code || "",
        country_name: p.country_name || "",
        networks: p.networks || [],
        scrape_url: p.scrape_url || "",
        directory_synced_at: p.directory_synced_at || new Date().toISOString(),
        updated_at: p.updated_at || new Date().toISOString(),
      }));

      const dirResp = await fetch(`${SUPABASE_URL}/rest/v1/wca_directory?on_conflict=wca_id`, {
        method: "POST",
        headers: { ...HEADERS, "Content-Type": "application/json", "Prefer": "resolution=merge-duplicates,return=minimal" },
        body: JSON.stringify(dirRows),
      });
      if (dirResp.ok) dirSaved += batch.length;
      else { dirErrors += batch.length; console.log(`[migrate] dir error: ${await dirResp.text()}`); }

      // Profile rows (solo quelli con dati)
      const profBatch = batch.filter(p => p.email || p.phone || (Array.isArray(p.contacts) && p.contacts.length > 0));
      if (profBatch.length > 0) {
        const profRows = profBatch.map(p => ({
          wca_id: p.wca_id, company_name: p.company_name || "", logo_url: p.logo_url || null,
          branch: p.branch || "", gm_coverage: p.gm_coverage ?? null, gm_status_text: p.gm_status_text || "",
          enrolled_offices: p.enrolled_offices || [], enrolled_since: p.enrolled_since || "",
          expires: p.expires || "", profile_text: p.profile_text || "",
          address: p.address || "", mailing: p.mailing || "", phone: p.phone || "",
          fax: p.fax || "", emergency_call: p.emergency_call || "",
          website: p.website || "", email: p.email || "",
          contacts: p.contacts || [], services: p.services || [],
          certifications: p.certifications || [], branch_cities: p.branch_cities || [],
          country_code: p.country_code || "", country_name: p.country_name || "",
          city: p.city || "", member_since: p.member_since || null,
          networks: p.networks || [], raw_data: p.raw_data || null,
          access_limited: p.access_limited || false,
          blacklist_status: p.blacklist_status || null,
          updated_at: p.updated_at || new Date().toISOString(),
        }));

        const profResp = await fetch(`${SUPABASE_URL}/rest/v1/wca_profiles?on_conflict=wca_id`, {
          method: "POST",
          headers: { ...HEADERS, "Content-Type": "application/json", "Prefer": "resolution=merge-duplicates,return=minimal" },
          body: JSON.stringify(profRows),
        });
        if (profResp.ok) profSaved += profBatch.length;
        else { profErrors += profBatch.length; console.log(`[migrate] prof error: ${await profResp.text()}`); }
      }
    }

    return res.json({
      success: true,
      migrated: partners.length,
      directory: { saved: dirSaved, errors: dirErrors },
      profiles: { saved: profSaved, errors: profErrors },
      message: `Migrati ${partners.length} record. Directory: ${dirSaved}, Profiles: ${profSaved}`,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};
