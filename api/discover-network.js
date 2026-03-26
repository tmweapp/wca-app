/**
 * api/discover-network.js — Discover membri di un network specifico per paese
 *
 * REFACTORED: usa utils/extract.js per NETWORK_DOMAINS e extractMembersFromHtml
 */
const fetch = require("node-fetch");
const { ssoLogin, getCachedCookies, saveCookiesToCache, testCookies, UA } = require("./utils/auth");
const { extractMembersFromHtml, NETWORK_DOMAINS } = require("./utils/extract");

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

    const { base: baseUrl, siteId } = networkInfo;

    // Auth SSO sul network — getCachedCookies ritorna { cookies, ssoCookies } o null
    let cookies = null;
    const cached = await getCachedCookies(networkDomain);
    if (cached) {
      cookies = cached.cookies;
      const valid = await testCookies(cookies, baseUrl);
      if (!valid) cookies = null;
    }
    if (!cookies) {
      console.log(`[discover-network] SSO login su ${baseUrl}...`);
      const loginResult = await ssoLogin(null, null, baseUrl);
      if (!loginResult.success) return res.status(500).json({ error: `SSO login fallito su ${networkDomain}: ` + loginResult.error });
      cookies = loginResult.cookies;
      await saveCookiesToCache(cookies, networkDomain, loginResult.ssoCookies || "");
    }

    // Query string per directory
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
    params.set("networkIds", siteId);

    const directoryUrl = `${baseUrl}/Directory?${params.toString()}`;
    console.log(`[discover-network] ${networkDomain} ${country} page=${page} → ${directoryUrl.substring(0, 120)}`);

    const resp = await fetch(directoryUrl, {
      headers: { "User-Agent": UA, "Cookie": cookies, "Referer": `${baseUrl}/Directory`, "Accept": "text/html,application/xhtml+xml" },
      redirect: "follow", timeout: 15000,
    });

    if (resp.url.toLowerCase().includes("/login")) {
      return res.json({ success: false, error: "login_required", networkDomain, country });
    }

    const html = await resp.text();
    const isLoggedIn = !html.includes('type="password"') && !html.includes('ReturnUrl=/MemberSection');
    const { members, totalResults } = extractMembersFromHtml(html);

    // API fallback se nessun membro dal HTML
    let apiMembers = [];
    if (members.length === 0) {
      try {
        const tokenMatch = html.match(/window\.wca\.token\s*=\s*["']([^"']+)["']/) || html.match(/wca\.token\s*=\s*["']([^"']+)["']/);
        const wcaToken = tokenMatch ? tokenMatch[1] : null;
        if (wcaToken) {
          const apiUrl = `${baseUrl}/Api/directories/view?${params.toString()}`;
          const apiResp = await fetch(apiUrl, {
            headers: { "User-Agent": UA, "Cookie": cookies, "Authorization": `Basic ${wcaToken}`, "Accept": "application/json, text/html, */*", "X-Requested-With": "XMLHttpRequest", "Referer": `${baseUrl}/Directory` },
            timeout: 15000,
          });
          if (apiResp.status === 200) {
            const apiText = await apiResp.text();
            apiMembers = extractMembersFromHtml(apiText).members;
            console.log(`[discover-network] API fallback: ${apiMembers.length} members`);
          }
        }
      } catch (e) { console.log(`[discover-network] API fallback error: ${e.message}`); }
    }

    const allMembers = members.length > 0 ? members : apiMembers;
    const hasNext = allMembers.length >= pageSize;
    console.log(`[discover-network] ${networkDomain} ${country}: ${allMembers.length} members, total=${totalResults}, loggedIn=${isLoggedIn}`);

    return res.json({ success: true, networkDomain, country, page, pageSize, members: allMembers, totalResults, hasNext, isLoggedIn });
  } catch (err) { return res.status(500).json({ success: false, error: err.message }); }
};
