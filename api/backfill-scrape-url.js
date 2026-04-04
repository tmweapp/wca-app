/**
 * api/backfill-scrape-url.js — Calcola scrape_url per tutti i record wca_directory
 *
 * Legge networks[] da ogni record e calcola il miglior scrape_url.
 * Aggiorna SOLO i record con scrape_url vuoto (non sovrascrive quelli già popolati).
 */
const fetch = require("node-fetch");
const { SUPABASE_URL, SUPABASE_KEY } = require("./utils/auth");
const { NETWORK_DOMAINS } = require("./utils/extract");

const VIRTUAL_NETS = new Set(["wca-first","wca-advanced","wca-chinaglobal","wca-interglobal","wca-vendors"]);
const BADGE_NETS = new Set(["allworldshipping","cass","qs","iata"]);

function computeScrapeUrl(wcaId, networks) {
  if (!networks || networks.length === 0) return "";
  // Cerca primo network con dominio reale
  let bestDomain = null;
  for (const n of networks) {
    if (!VIRTUAL_NETS.has(n) && !BADGE_NETS.has(n) && n.includes(".")) {
      bestDomain = n;
      break;
    }
  }
  // Se solo virtuali, usa il primo
  if (!bestDomain) bestDomain = networks[0];

  let base = "https://www.wcaworld.com";
  if (bestDomain && bestDomain !== "wcaworld.com") {
    if (bestDomain === "ifc8.network") base = "https://ifc8.network";
    else if (bestDomain.startsWith("wca-") || !bestDomain.includes(".")) base = "https://www.wcaworld.com";
    else base = "https://www." + bestDomain;
  }
  return base + "/directory/members/" + wcaId;
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    // Carica tutti i record con scrape_url vuoto o nullo
    let allRows = [];
    let offset = 0;
    const LIMIT = 1000;
    while (true) {
      const url = `${SUPABASE_URL}/rest/v1/wca_directory?select=wca_id,networks,scrape_url&or=(scrape_url.is.null,scrape_url.eq.)&order=wca_id.asc&limit=${LIMIT}&offset=${offset}`;
      const resp = await fetch(url, {
        headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}` },
      });
      if (!resp.ok) return res.json({ success: false, error: `Supabase ${resp.status}` });
      const rows = await resp.json();
      allRows.push(...rows);
      if (rows.length < LIMIT) break;
      offset += LIMIT;
    }

    if (allRows.length === 0) {
      return res.json({ success: true, message: "Tutti i record hanno già scrape_url", updated: 0 });
    }

    // Calcola scrape_url e aggiorna in batch
    const BATCH_SIZE = 500;
    let updated = 0;
    let errors = 0;

    for (let i = 0; i < allRows.length; i += BATCH_SIZE) {
      const batch = allRows.slice(i, i + BATCH_SIZE);
      const rows = batch.map(r => ({
        wca_id: r.wca_id,
        scrape_url: computeScrapeUrl(r.wca_id, r.networks),
      }));

      const resp = await fetch(`${SUPABASE_URL}/rest/v1/wca_directory?on_conflict=wca_id`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": SUPABASE_KEY,
          "Authorization": `Bearer ${SUPABASE_KEY}`,
          "Prefer": "resolution=merge-duplicates,return=minimal",
        },
        body: JSON.stringify(rows),
      });

      if (resp.ok) updated += batch.length;
      else errors += batch.length;
    }

    console.log(`[backfill-scrape-url] Updated ${updated}, errors ${errors}, total ${allRows.length}`);
    return res.json({ success: true, updated, errors, total: allRows.length });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};
