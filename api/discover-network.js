const fetch = require("node-fetch");
const cheerio = require("cheerio");
const { ssoLogin, getCachedCookies, saveCookiesToCache, testCookies, UA } = require("./utils/auth");

// Mappa completa network → dominio + siteId
const NETWORK_DOMAINS = {
  "wcaworld.com":              { siteId: 24,  base: "https://www.wcaworld.com" },
  "lognetglobal.com":          { siteId: 61,  base: "https://www.lognetglobal.com" },
  "globalaffinityalliance.com":{ siteId: 98,  base: "https://www.globalaffinityalliance.com" },
  "elitegln.com":              { siteId: 108, base: "https://www.elitegln.com" },
  "ifc8.network":              { siteId: 118, base: "https://ifc8.network" },
  "wcaprojects.com":           { siteId: 5,   base: "https://www.wcaprojects.com" },
  "wcadangerousgoods.com":     { siteId: 22,  base: "https://www.wcadangerousgoods.com" },
  "wcaperishables.com":        { siteId: 13,  base: "https://www.wcaperishables.com" },
  "wcatimecritical.com":       { siteId: 18,  base: "https://www.wcatimecritical.com" },
  "wcapharma.com":             { siteId: 16,  base: "https://www.wcapharma.com" },
  "wcarelocations.com":        { siteId: 15,  base: "https://www.wcarelocations.com" },
  "wcaecommercesolutions.com": { siteId: 107, base: "https://www.wcaecommercesolutions.com" },
  "wcaexpo.com":               { siteId: 124, base: "https://www.wcaexpo.com" },
};

function extractMembersFromHtml(html) {
  const members = [];
  const seenIds = new Set();
  const $ = cheerio.load(html);

  // Standard WCA directory listing
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

    // 1. Auth — SSO login sul dominio del network specifico
    const { base: baseUrl, siteId } = networkInfo;
    let cookies = await getCachedCookies(networkDomain);
    if (cookies) { const valid = await testCookies(cookies, baseUrl); if (!valid) cookies = null; }
    if (!cookies) {
      console.log(`[discover-network] SSO login su ${baseUrl}...`);
      const loginResult = await ssoLogin(null, null, baseUrl);
      if (!loginResult.success) return res.status(500).json({ error: `SSO login fallito su ${networkDomain}: ` + loginResult.error });
      cookies = loginResult.cookies;
      await saveCookiesToCache(cookies, networkDomain);
    }

    // 2. Build query string per il network specifico
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
    params.set("au", "");
    // Include il network ID come filtro
    params.set("networkIds", siteId);

    // 3. Fetch directory page
    const directoryUrl = `${baseUrl}/Directory?${params.toString()}`;
    console.log(`[discover-network] ${networkDomain} ${country} page=${page} → ${directoryUrl.substring(0, 120)}`);

    const resp = await fetch(directoryUrl, {
      headers: {
        "User-Agent": UA,
        "Cookie": cookies,
        "Referer": `${baseUrl}/Directory`,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
      redirect: "follow",
      timeout: 15000,
    });

    // Check login redirect
    if (resp.url.toLowerCase().includes("/login")) {
      return res.json({ success: false, error: "login_required", networkDomain, country });
    }

    const html = await resp.text();
    const isLoggedIn = !html.includes('type="password"') && !html.includes('ReturnUrl=/MemberSection');

    // 4. Parse members
    const { members, totalResults } = extractMembersFromHtml(html);

    // 5. If no members from HTML, try the API endpoint
    let apiMembers = [];
    if (members.length === 0) {
      try {
        // Extract wcaToken from page
        const tokenMatch = html.match(/window\.wca\.token\s*=\s*["']([^"']+)["']/) ||
                          html.match(/wca\.token\s*=\s*["']([^"']+)["']/);
        const wcaToken = tokenMatch ? tokenMatch[1] : null;

        if (wcaToken) {
          const apiUrl = `${baseUrl}/Api/directories/view?${params.toString()}`;
          const apiResp = await fetch(apiUrl, {
            headers: {
              "User-Agent": UA,
              "Cookie": cookies,
              "Authorization": `Basic ${wcaToken}`,
              "Accept": "application/json, text/html, */*",
              "X-Requested-With": "XMLHttpRequest",
              "Referer": `${baseUrl}/Directory`,
            },
            timeout: 15000,
          });
          if (apiResp.status === 200) {
            const apiText = await apiResp.text();
            const apiParsed = extractMembersFromHtml(apiText);
            apiMembers = apiParsed.members;
            console.log(`[discover-network] API fallback: ${apiMembers.length} members`);
          }
        }
      } catch (e) {
        console.log(`[discover-network] API fallback error: ${e.message}`);
      }
    }

    const allMembers = members.length > 0 ? members : apiMembers;
    const hasNext = allMembers.length >= pageSize;

    console.log(`[discover-network] ${networkDomain} ${country}: ${allMembers.length} members found, total=${totalResults}, loggedIn=${isLoggedIn}`);

    return res.json({
      success: true,
      networkDomain,
      country,
      page,
      pageSize,
      members: allMembers,
      totalResults,
      hasNext,
      isLoggedIn,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};
