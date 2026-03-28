/**
 * api/discover-network.js — Discover membri di un network specifico per paese
 *
 * STRATEGY (in order):
 *   1. API endpoint /Api/directories/view con cookies SSO → HTML parziale con li.directoyname
 *   2. API endpoint senza auth (directory pubblica per listing base)
 *   3. Full HTML page /Directory con scraping classico
 *   4. Fallback: JSON API se disponibile
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

    // ═══ AUTH ═══
    let cookies = null;
    let ssoCookies = null;
    let wcaToken = null;
    let authMethod = "none";

    const cached = await getCachedCookies(networkDomain);
    if (cached) {
      cookies = cached.cookies;
      ssoCookies = cached.ssoCookies || null;
      const valid = await testCookies(cookies, baseUrl);
      if (valid) {
        authMethod = "cached";
      } else {
        cookies = null;
        ssoCookies = null;
      }
    }
    if (!cookies) {
      console.log(`[discover-network] SSO login su ${baseUrl}...`);
      const loginResult = await ssoLogin(null, null, baseUrl);
      if (loginResult.success) {
        cookies = loginResult.cookies;
        ssoCookies = loginResult.ssoCookies || null;
        wcaToken = loginResult.wcaToken || null;
        authMethod = "sso";
        console.log(`[discover-network] SSO OK, cookies=${cookies?.length}ch, hasAuth=${cookies?.includes('.ASPXAUTH')}, token=${!!wcaToken}`);
        await saveCookiesToCache(cookies, networkDomain, ssoCookies || "");
      } else {
        console.log(`[discover-network] SSO fallito: ${loginResult.error}`);
        authMethod = "sso_failed";
      }
    }

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
    params.set("au", "");
    params.set("networkIds", siteId);

    const debug = {
      authMethod,
      cookiesLength: cookies?.length || 0,
      hasASPXAUTH: cookies?.includes('.ASPXAUTH') || false,
      ssoCookiesLength: ssoCookies?.length || 0,
      hasWcaToken: !!wcaToken,
      strategies: [],
    };

    let allMembers = [];
    let totalResults = null;
    let isLoggedIn = false;
    let winningStrategy = "none";

    // ═══ STRATEGY 1: API endpoint con cookies (ritorna HTML parziale) ═══
    if (cookies) {
      try {
        const apiUrl = `${baseUrl}/Api/directories/view?${params.toString()}`;
        const headers = {
          "User-Agent": UA,
          "Cookie": cookies,
          "Accept": "application/json, text/html, */*",
          "X-Requested-With": "XMLHttpRequest",
          "Referer": `${baseUrl}/Directory`,
        };
        if (wcaToken) headers["Authorization"] = `Basic ${wcaToken}`;

        const apiResp = await fetch(apiUrl, { headers, timeout: 15000 });
        const apiText = await apiResp.text();
        const apiResult = extractMembersFromHtml(apiText);
        debug.strategies.push({
          name: "api_with_cookies",
          status: apiResp.status,
          membersFound: apiResult.members.length,
          totalResults: apiResult.totalResults,
          responseLength: apiText.length,
          snippet: apiText.substring(0, 500),
        });
        console.log(`[discover-network] Strategy 1 (API+cookies): status=${apiResp.status} members=${apiResult.members.length} total=${apiResult.totalResults}`);
        if (apiResult.members.length > 0) {
          allMembers = apiResult.members;
          totalResults = apiResult.totalResults;
          isLoggedIn = true;
          winningStrategy = "api_with_cookies";
        }
      } catch (e) {
        debug.strategies.push({ name: "api_with_cookies", error: e.message });
        console.log(`[discover-network] Strategy 1 error: ${e.message}`);
      }
    }

    // ═══ STRATEGY 2: API con cookies combinati (target + SSO) ═══
    if (allMembers.length === 0 && cookies && ssoCookies) {
      try {
        const combinedCookies = cookies + "; " + ssoCookies;
        const apiUrl = `${baseUrl}/Api/directories/view?${params.toString()}`;
        const headers = {
          "User-Agent": UA,
          "Cookie": combinedCookies,
          "Accept": "application/json, text/html, */*",
          "X-Requested-With": "XMLHttpRequest",
          "Referer": `${baseUrl}/Directory`,
        };
        if (wcaToken) headers["Authorization"] = `Basic ${wcaToken}`;

        const apiResp = await fetch(apiUrl, { headers, timeout: 15000 });
        const apiText = await apiResp.text();
        const apiResult = extractMembersFromHtml(apiText);
        debug.strategies.push({
          name: "api_combined_cookies",
          status: apiResp.status,
          membersFound: apiResult.members.length,
          totalResults: apiResult.totalResults,
          responseLength: apiText.length,
          snippet: apiText.substring(0, 500),
        });
        console.log(`[discover-network] Strategy 2 (API+combined): status=${apiResp.status} members=${apiResult.members.length}`);
        if (apiResult.members.length > 0) {
          allMembers = apiResult.members;
          totalResults = apiResult.totalResults;
          isLoggedIn = true;
          winningStrategy = "api_combined_cookies";
        }
      } catch (e) {
        debug.strategies.push({ name: "api_combined_cookies", error: e.message });
      }
    }

    // ═══ STRATEGY 3: API senza auth (directory pubblica?) ═══
    if (allMembers.length === 0) {
      try {
        const apiUrl = `${baseUrl}/Api/directories/view?${params.toString()}`;
        const apiResp = await fetch(apiUrl, {
          headers: {
            "User-Agent": UA,
            "Accept": "application/json, text/html, */*",
            "X-Requested-With": "XMLHttpRequest",
            "Referer": `${baseUrl}/Directory`,
          },
          timeout: 15000,
        });
        const apiText = await apiResp.text();
        const apiResult = extractMembersFromHtml(apiText);
        debug.strategies.push({
          name: "api_no_auth",
          status: apiResp.status,
          membersFound: apiResult.members.length,
          totalResults: apiResult.totalResults,
          responseLength: apiText.length,
          snippet: apiText.substring(0, 500),
        });
        console.log(`[discover-network] Strategy 3 (API no auth): status=${apiResp.status} members=${apiResult.members.length}`);
        if (apiResult.members.length > 0) {
          allMembers = apiResult.members;
          totalResults = apiResult.totalResults;
          winningStrategy = "api_no_auth";
        }
      } catch (e) {
        debug.strategies.push({ name: "api_no_auth", error: e.message });
      }
    }

    // ═══ STRATEGY 4: Full HTML page /Directory ═══
    if (allMembers.length === 0) {
      try {
        const directoryUrl = `${baseUrl}/Directory?${params.toString()}`;
        const headers = { "User-Agent": UA, "Accept": "text/html,application/xhtml+xml" };
        if (cookies) {
          headers["Cookie"] = cookies;
          headers["Referer"] = `${baseUrl}/Directory`;
        }

        const resp = await fetch(directoryUrl, { headers, redirect: "follow", timeout: 15000 });

        if (resp.url.toLowerCase().includes("/login")) {
          debug.strategies.push({ name: "html_page", redirectedToLogin: true });
        } else {
          const html = await resp.text();
          isLoggedIn = !html.includes('type="password"') && !html.includes('ReturnUrl=/MemberSection');
          const hasLogout = /logout|sign.?out/i.test(html);
          const htmlResult = extractMembersFromHtml(html);

          // Cerchiamo wcaToken nel HTML per un ultimo tentativo API
          if (!wcaToken) {
            const tokenMatch = html.match(/window\.wca\.token\s*=\s*["']([^"']+)["']/) || html.match(/wca\.token\s*=\s*["']([^"']+)["']/);
            if (tokenMatch) wcaToken = tokenMatch[1];
          }

          debug.strategies.push({
            name: "html_page",
            status: resp.status,
            finalUrl: resp.url?.substring(0, 150),
            membersFound: htmlResult.members.length,
            totalResults: htmlResult.totalResults,
            isLoggedIn,
            hasLogout,
            hasWcaToken: !!wcaToken,
            htmlLength: html.length,
            // Diagnostica HTML: cerca elementi chiave
            hasLiDirectoyname: (html.match(/class="directoyname"/g) || []).length,
            hasLiDirectoryname: (html.match(/class="directoryname"/g) || []).length,
            hasDirectoryMembers: (html.match(/\/directory\/members\//gi) || []).length,
            hasPasswordField: html.includes('type="password"'),
            hasReturnUrl: html.includes('ReturnUrl=/MemberSection'),
            snippet: html.substring(0, 800),
          });

          if (htmlResult.totalResults && !totalResults) totalResults = htmlResult.totalResults;

          console.log(`[discover-network] Strategy 4 (HTML): status=${resp.status} members=${htmlResult.members.length} total=${htmlResult.totalResults} loggedIn=${isLoggedIn} logout=${hasLogout}`);
          if (htmlResult.members.length > 0) {
            allMembers = htmlResult.members;
            totalResults = htmlResult.totalResults;
            winningStrategy = "html_page";
          }
        }
      } catch (e) {
        debug.strategies.push({ name: "html_page", error: e.message });
      }
    }

    // ═══ STRATEGY 5: API con wcaToken estratto dal HTML (ultimo tentativo) ═══
    if (allMembers.length === 0 && wcaToken) {
      try {
        const apiUrl = `${baseUrl}/Api/directories/view?${params.toString()}`;
        const apiResp = await fetch(apiUrl, {
          headers: {
            "User-Agent": UA,
            "Cookie": cookies || "",
            "Authorization": `Basic ${wcaToken}`,
            "Accept": "application/json, text/html, */*",
            "X-Requested-With": "XMLHttpRequest",
            "Referer": `${baseUrl}/Directory`,
          },
          timeout: 15000,
        });
        const apiText = await apiResp.text();
        const apiResult = extractMembersFromHtml(apiText);
        debug.strategies.push({
          name: "api_with_token",
          status: apiResp.status,
          membersFound: apiResult.members.length,
          totalResults: apiResult.totalResults,
          responseLength: apiText.length,
          snippet: apiText.substring(0, 500),
        });
        console.log(`[discover-network] Strategy 5 (API+token): status=${apiResp.status} members=${apiResult.members.length}`);
        if (apiResult.members.length > 0) {
          allMembers = apiResult.members;
          totalResults = apiResult.totalResults;
          isLoggedIn = true;
          winningStrategy = "api_with_token";
        }
      } catch (e) {
        debug.strategies.push({ name: "api_with_token", error: e.message });
      }
    }

    const hasNext = allMembers.length >= pageSize;
    debug.winningStrategy = winningStrategy;
    debug.totalMembers = allMembers.length;

    console.log(`[discover-network] ${networkDomain} ${country}: ${allMembers.length} members via ${winningStrategy}, total=${totalResults}, auth=${authMethod}`);

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
      debug,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};
