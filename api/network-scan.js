const fetch = require("node-fetch");
const cheerio = require("cheerio");
const { ssoLogin, getCachedCookies, saveCookiesToCache, testCookies, UA } = require("./utils/auth");

// Tutti i network con sito dedicato (escluso wcaworld.com che è il fallback)
const SPECIALTY_NETWORKS = [
  { domain: "wcaprojects.com",           siteId: 5,   name: "WCA Projects" },
  { domain: "wcadangerousgoods.com",     siteId: 22,  name: "WCA Dangerous Goods" },
  { domain: "wcaperishables.com",        siteId: 13,  name: "WCA Perishables" },
  { domain: "wcatimecritical.com",       siteId: 18,  name: "WCA Time Critical" },
  { domain: "wcapharma.com",             siteId: 16,  name: "WCA Pharma" },
  { domain: "wcarelocations.com",        siteId: 15,  name: "WCA Relocations" },
  { domain: "wcaecommercesolutions.com", siteId: 107, name: "WCA eCommerce" },
  { domain: "wcaexpo.com",              siteId: 124, name: "WCA Expo" },
];

const AFFILIATED_NETWORKS = [
  { domain: "lognetglobal.com",           siteId: 61,  name: "Lognet Global" },
  { domain: "globalaffinityalliance.com", siteId: 98,  name: "GAA" },
  { domain: "elitegln.com",              siteId: 108, name: "EGLN" },
  { domain: "ifc8.network",             siteId: 118, name: "IFC8" },
];

const ALL_NETWORKS = [...SPECIALTY_NETWORKS, ...AFFILIATED_NETWORKS];

function extractMembersFromHtml(html) {
  const members = [];
  const seenIds = new Set();
  const $ = cheerio.load(html);
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href") || "";
    const match = href.match(/\/directory\/members\/(\d+)/i);
    if (match) {
      const id = parseInt(match[1]);
      if (!seenIds.has(id) && id > 0) {
        seenIds.add(id);
        members.push({ id, name: $(el).text().trim(), href });
      }
    }
  });
  let totalResults = null;
  const totalMatch = html.match(/(\d[\d,]*)\s*(results?|members?|companies|records?|found|total)/i);
  if (totalMatch) totalResults = parseInt(totalMatch[1].replace(/,/g, ""));
  return { members, totalResults };
}

async function discoverOnNetwork(network, country, cookies) {
  const base = network.domain === "ifc8.network"
    ? `https://${network.domain}`
    : `https://www.${network.domain}`;

  const params = new URLSearchParams({
    siteID: network.siteId,
    pageIndex: 1,
    pageNumber: 1,
    pageSize: 300,
    searchby: "CountryCode",
    countrycode: country,
    country: country,
    orderby: "CountryCity",
    submitted: "search",
    layout: "v1",
    au: "",
  });

  try {
    const directoryUrl = `${base}/Directory?${params.toString()}`;
    const resp = await fetch(directoryUrl, {
      headers: {
        "User-Agent": UA,
        "Cookie": cookies,
        "Referer": `${base}/Directory`,
        "Accept": "text/html,application/xhtml+xml",
      },
      redirect: "follow",
      timeout: 15000,
    });

    if (resp.url.toLowerCase().includes("/login")) {
      return { network: network.name, domain: network.domain, error: "login_required", members: [] };
    }

    const html = await resp.text();
    if (html.includes('type="password"')) {
      return { network: network.name, domain: network.domain, error: "login_required", members: [] };
    }

    const { members, totalResults } = extractMembersFromHtml(html);

    // Fallback: try API if no HTML members
    if (members.length === 0) {
      const tokenMatch = html.match(/window\.wca\.token\s*=\s*["']([^"']+)["']/) ||
                         html.match(/wca\.token\s*=\s*["']([^"']+)["']/);
      if (tokenMatch) {
        try {
          const apiUrl = `${base}/Api/directories/view?${params.toString()}`;
          const apiResp = await fetch(apiUrl, {
            headers: {
              "User-Agent": UA, "Cookie": cookies,
              "Authorization": `Basic ${tokenMatch[1]}`,
              "Accept": "application/json, text/html, */*",
              "X-Requested-With": "XMLHttpRequest",
              "Referer": `${base}/Directory`,
            },
            timeout: 15000,
          });
          if (apiResp.status === 200) {
            const apiHtml = await apiResp.text();
            const apiParsed = extractMembersFromHtml(apiHtml);
            if (apiParsed.members.length > 0) {
              return { network: network.name, domain: network.domain, members: apiParsed.members, total: apiParsed.totalResults };
            }
          }
        } catch (e) { /* ignore API fallback error */ }
      }
    }

    return {
      network: network.name,
      domain: network.domain,
      members,
      total: totalResults,
    };
  } catch (e) {
    return { network: network.name, domain: network.domain, error: e.message, members: [] };
  }
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  try {
    const { country } = req.body || {};
    if (!country) return res.status(400).json({ error: "country (ISO2) richiesto, es: ES, MT, IT" });

    // 1. Auth
    let cookies = await getCachedCookies();
    if (cookies) { const valid = await testCookies(cookies); if (!valid) cookies = null; }
    if (!cookies) {
      const loginResult = await ssoLogin();
      if (!loginResult.success) return res.status(500).json({ error: "SSO login fallito" });
      cookies = loginResult.cookies;
      await saveCookiesToCache(cookies);
    }

    console.log(`[network-scan] Scanning ${country} across ${ALL_NETWORKS.length} networks...`);

    // 2. Discover su tutti i network (sequenziale per evitare rate limiting)
    const networkResults = [];
    const allMemberIds = new Set();
    const memberNetworkMap = {}; // wcaId → [domains]

    for (const network of ALL_NETWORKS) {
      const result = await discoverOnNetwork(network, country, cookies);
      networkResults.push({
        network: result.network,
        domain: result.domain,
        memberCount: result.members.length,
        total: result.total || null,
        error: result.error || null,
      });

      for (const m of result.members) {
        allMemberIds.add(m.id);
        if (!memberNetworkMap[m.id]) memberNetworkMap[m.id] = { name: m.name, networks: [] };
        memberNetworkMap[m.id].networks.push(result.domain);
      }

      console.log(`[network-scan] ${result.domain}: ${result.members.length} members${result.error ? ` (error: ${result.error})` : ""}`);
    }

    // 3. Riepilogo
    const summary = {
      country,
      totalUniqueMembers: allMemberIds.size,
      networkBreakdown: networkResults,
      memberNetworkMap: Object.fromEntries(
        Object.entries(memberNetworkMap).map(([id, data]) => [id, { name: data.name, networks: data.networks }])
      ),
    };

    console.log(`[network-scan] ${country} complete: ${allMemberIds.size} unique members across ${ALL_NETWORKS.length} networks`);

    return res.json({ success: true, ...summary });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};
