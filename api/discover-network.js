/**
 * api/discover-network.js — Scopri membri di un network per paese
 *
 * SEMPLICE: il browser è già loggato. Fa una GET a /Directory con i parametri,
 * estrae i membri dal JSON o HTML, e li ritorna.
 */
const fetch = require("node-fetch");
const { extractMembersFromHtml, NETWORK_DOMAINS } = require("./utils/extract");

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  try {
    const { networkDomain, country, page = 1, pageSize = 300 } = req.body || {};
    if (!networkDomain) return res.status(400).json({ error: "networkDomain richiesto" });
    if (!country) return res.status(400).json({ error: "country (ISO2) richiesto" });

    const networkInfo = NETWORK_DOMAINS[networkDomain];
    if (!networkInfo) return res.status(400).json({ error: `Network sconosciuto: ${networkDomain}` });

    const baseUrl = networkInfo.base;
    const siteId = networkInfo.siteId;

    // ═══ QUERY PARAMS ═══
    const params = new URLSearchParams();
    params.set("siteID", siteId);
    params.set("pageIndex", page);
    params.set("pageNumber", page);
    params.set("pageSize", pageSize);
    params.set("searchby", "CountryCode");
    params.set("countrycode", country);
    params.set("country", country);
    params.set("orderby", "CountryCity");
    params.set("submitted", "search");
    params.set("layout", "v1");
    params.append("networkIds", siteId);

    const directoryUrl = `${baseUrl}/Directory?${params.toString()}`;
    console.log(`[discover-network] Fetching ${networkDomain} ${country} → ${directoryUrl.substring(0, 100)}...`);

    // ═══ FETCH DIRECTORY PAGE ═══
    const resp = await fetch(directoryUrl, {
      headers: {
        "User-Agent": UA,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Referer": `${baseUrl}/Directory`,
      },
      redirect: "follow",
      timeout: 15000,
    });

    const html = await resp.text();
    console.log(`[discover-network] Response status=${resp.status} htmlLength=${html.length}`);

    // ═══ EXTRACT MEMBERS ═══
    const { members, totalResults } = extractMembersFromHtml(html);

    // Check if logged in (presence of logout link)
    const isLoggedIn = /logout|sign.?out/i.test(html) && !html.includes('type="password"');

    const hasNext = members.length >= pageSize;
    console.log(`[discover-network] ${networkDomain} ${country}: ${members.length} members, total=${totalResults}, loggedIn=${isLoggedIn}`);

    return res.json({
      success: true,
      networkDomain,
      country,
      page,
      pageSize,
      members,
      totalResults,
      hasNext,
      isLoggedIn,
    });
  } catch (err) {
    console.error(`[discover-network] Error: ${err.message}`);
    return res.status(500).json({ success: false, error: err.message });
  }
};
