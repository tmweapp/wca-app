/**
 * api/discover-global.js — Scopri TUTTI i membri di un paese (directory globale)
 * Usa siteID=24, au=m per ottenere head offices + branch offices
 * NON tocca discover-network.js
 */
const fetch = require("node-fetch");
const { extractMembersFromHtml } = require("./utils/extract");

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  try {
    const { country, page = 1, pageSize = 50 } = req.body || {};
    if (!country) return res.status(400).json({ error: "country (ISO2) richiesto" });

    const params = new URLSearchParams();
    params.set("siteID", 24);
    params.set("pageIndex", page);
    params.set("pageNumber", page);
    params.set("pageSize", pageSize);
    params.set("searchby", "CountryCode");
    params.set("countrycode", country);
    params.set("country", country);
    params.set("orderby", "CountryCity");
    params.set("submitted", "search");
    params.set("layout", "v1");
    params.set("au", "m");

    // Tutti i networkIds
    const allNetworkIds = [1,2,3,4,5,13,15,16,18,22,38,61,98,107,108,118,124];
    for (const nid of allNetworkIds) {
      params.append("networkIds", nid);
    }

    const directoryUrl = `https://www.wcaworld.com/Directory?${params.toString()}`;
    console.log(`[discover-global] Fetching ${country} p${page} → ${directoryUrl.substring(0, 120)}...`);

    const resp = await fetch(directoryUrl, {
      headers: {
        "User-Agent": UA,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Referer": "https://www.wcaworld.com/Directory",
      },
      redirect: "follow",
      timeout: 15000,
    });

    const html = await resp.text();
    const { members, totalResults } = extractMembersFromHtml(html);
    // Calculate hasNext properly using totalResults when available
    const fetched = (page - 1) * pageSize + members.length;
    const hasNext = totalResults > 0
      ? fetched < totalResults && members.length > 0
      : members.length >= pageSize;

    console.log(`[discover-global] ${country} p${page}: ${members.length} members, fetched=${fetched}, total=${totalResults}, hasNext=${hasNext}`);

    return res.json({
      success: true,
      country,
      page,
      members,
      totalResults,
      hasNext,
    });
  } catch (err) {
    console.error(`[discover-global] Error: ${err.message}`);
    return res.status(500).json({ success: false, error: err.message });
  }
};
