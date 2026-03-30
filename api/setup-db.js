const fetch = require("node-fetch");
const { SUPABASE_URL, SUPABASE_KEY } = require("./utils/auth");

async function testTable(name) {
  try {
    const r = await fetch(`${SUPABASE_URL}/rest/v1/${name}?select=*&limit=1`, {
      headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}` },
    });
    return { exists: r.ok, status: r.status, body: (await r.text()).substring(0, 200) };
  } catch (e) { return { exists: false, error: e.message }; }
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(200).end();

  const results = {};
  results.wca_directory = await testTable("wca_directory");
  results.wca_profiles = await testTable("wca_profiles");
  results.wca_session = await testTable("wca_session");
  results.wca_jobs = await testTable("wca_jobs");

  // Istruzioni SQL da eseguire manualmente se le tabelle non esistono
  results.sql_if_missing = `
-- Esegui in Supabase SQL Editor se le tabelle non esistono:

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

CREATE TABLE IF NOT EXISTS wca_session (
  id TEXT PRIMARY KEY DEFAULT 'default',
  cookies TEXT,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS wca_jobs (
  id SERIAL PRIMARY KEY,
  status TEXT DEFAULT 'pending',
  config JSONB DEFAULT '{}',
  discovered_members JSONB DEFAULT '[]',
  current_country_idx INTEGER DEFAULT 0,
  current_member_idx INTEGER DEFAULT 0,
  delay_index INTEGER DEFAULT 0,
  total_scraped INTEGER DEFAULT 0,
  total_skipped INTEGER DEFAULT 0,
  consecutive_failures INTEGER DEFAULT 0,
  last_activity TEXT,
  error_log JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_directory_country ON wca_directory(country_code);
CREATE INDEX IF NOT EXISTS idx_profiles_country ON wca_profiles(country_code);
  `;

  return res.json(results);
};
