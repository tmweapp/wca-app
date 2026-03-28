/**
 * api/discover-network.js — Discover membri di un network specifico per paese
 *
 * STRATEGY:
 *   1. JSON API /Api/directories/view con Basic auth (credentials dirette)
 *   2. JSON API con cookies SSO
 *   3. HTML page /Directory (fallback)
 */
const fetch = require("node-fetch");
const { ssoLogin, getCachedCookies, saveCookiesToCache, testCookies, UA } = require("./utils/auth");
const { extractMembersFromHtml, NETWORK_DOMAINS } = require("./utils/extract");

// Credenziali per Basic auth diretto
const WCA_USER = process.env.WCA_USERNAME || "tmsrlmin";
const WCA_PASS = process.env.WCA_PASSWORD || "G0u3v!VvCn";
const BASIC_TOKEN = Buffer.from(`${WCA_USER}:${WCA_PASS}`).toString("base64");

// Parsa la risposta JSON dell'API WCA e estrai i membri
function parseApiJson(json) {
  const members = [];
  if (!json || !json.Companies || !Array.isArray(json.Companies)) return { members, totalResults: null };

  for (const company of json.Companies) {
    const id = company.CompanyId || company.Id || company.companyId;
    if (!id) continue;
    const name = company.CompanyName || company.Name || company.companyName || "";
    const networks = [];
    if (company.Networks && Array.isArray(company.Networks)) {
      for (const n of company.Networks) {
        const netName = n.NetworkName || n.Name || n.networkName || "";
        if (netName) networks.push(netName.toLowerCase().replace(/\s+/g, ""));
      }
    }
    if (company.NetworkLogos && Array.isArray(company.NetworkLogos)) {
      for (const logo of company.NetworkLogos) {
        const alt = logo.Alt || logo.alt || "";
        if (alt && !networks.includes(alt.toLowerCase())) networks.push(alt.toLowerCase());
      }
    }
    members.push({
      id: parseInt(id),
      name: name.trim(),
      href: `/directory/members/${id}`,
      networks,
    });
  }

  let totalResults = json.TotalCount || json.TotalResults || json.totalCount || json.Ede?.TotalCount || null;
  if (!totalResults && json.Companies) totalResults = json.Companies.length;

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

    const { base: baseUrl, siteId } = networkInfo;

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

    const debug = { strategies: [] };
    let allMembers = [];
    let totalResults = null;
    let isLoggedIn = false;
    let winningStrategy = "none";

    // ═══ STRATEGY 1: JSON API con Basic auth diretto ═══
    try {
      const apiUrl = `${baseUrl}/Api/directories/view?${params.toString()}`;
      const apiResp = await fetch(apiUrl, {
        headers: {
          "User-Agent": UA,
          "Authorization": `Basic ${BASIC_TOKEN}`,
          "Accept": "application/json, text/html, */*",
          "X-Requested-With": "XMLHttpRequest",
          "Referer": `${baseUrl}/Directory`,
        },
        timeout: 15000,
      });
      const apiText = await apiResp.text();
      let apiJson = null;
      try { apiJson = JSON.parse(apiText); } catch (e) { /* not json */ }

      if (apiJson) {
        const jsonResult = parseApiJson(apiJson);
        debug.strategies.push({
          name: "api_basic_auth",
          status: apiResp.status,
          isLoggedIn: apiJson.IsLoggedIn || false,
          membersFound: jsonResult.members.length,
          totalResults: jsonResult.totalResults,
          companiesCount: apiJson.Companies?.length || 0,
          keys: Object.keys(apiJson).join(","),
          snippet: apiText.substring(0, 500),
        });
        console.log(`[discover] Strategy 1 (Basic auth): status=${apiResp.status} loggedIn=${apiJson.IsLoggedIn} members=${jsonResult.members.length}`);
        if (jsonResult.members.length > 0) {
          allMembers = jsonResult.members;
          totalResults = jsonResult.totalResults;
          isLoggedIn = true;
          winningStrategy = "api_basic_auth";
        }
      } else {
        // Risposta HTML — prova extractMembersFromHtml
        const htmlResult = extractMembersFromHtml(apiText);
        debug.strategies.push({
          name: "api_basic_auth_html",
          status: apiResp.status,
          membersFound: htmlResult.members.length,
          totalResults: htmlResult.totalResults,
          responseLength: apiText.length,
          snippet: apiText.substring(0, 500),
        });
        if (htmlResult.members.length > 0) {
          allMembers = htmlResult.members;
          totalResults = htmlResult.totalResults;
          isLoggedIn = true;
          winningStrategy = "api_basic_auth_html";
        }
      }
    } catch (e) {
      debug.strategies.push({ name: "api_basic_auth", error: e.message });
    }

    // ═══ STRATEGY 2: JSON API con SSO cookies ═══
    if (allMembers.length === 0) {
      let cookies = null;
      try {
        const cached = await getCachedCookies(networkDomain);
        if (cached) {
          cookies = cached.cookies;
          const valid = await testCookies(cookies, baseUrl);
          if (!valid) cookies = null;
        }
        if (!cookies) {
          const loginResult = await ssoLogin(null, null, baseUrl);
          if (loginResult.success) {
            cookies = loginResult.cookies;
            await saveCookiesToCache(cookies, networkDomain, loginResult.ssoCookies || "");
          }
        }
      } catch (e) { /* ignore auth errors */ }

      if (cookies) {
        try {
          const apiUrl = `${baseUrl}/Api/directories/view?${params.toString()}`;
          const apiResp = await fetch(apiUrl, {
            headers: {
              "User-Agent": UA,
              "Cookie": cookies,
              "Accept": "application/json, text/html, */*",
              "X-Requested-With": "XMLHttpRequest",
              "Referer": `${baseUrl}/Directory`,
            },
            timeout: 15000,
          });
          const apiText = await apiResp.text();
          let apiJson = null;
          try { apiJson = JSON.parse(apiText); } catch (e) { /* not json */ }

          if (apiJson) {
            const jsonResult = parseApiJson(apiJson);
            debug.strategies.push({
              name: "api_sso_cookies",
              status: apiResp.status,
              isLoggedIn: apiJson.IsLoggedIn || false,
              membersFound: jsonResult.members.length,
              keys: Object.keys(apiJson).join(","),
              snippet: apiText.substring(0, 500),
            });
            if (jsonResult.members.length > 0) {
              allMembers = jsonResult.members;
              totalResults = jsonResult.totalResults;
              isLoggedIn = true;
              winningStrategy = "api_sso_cookies";
            }
          } else {
            const htmlResult = extractMembersFromHtml(apiText);
            debug.strategies.push({
              name: "api_sso_cookies_html",
              status: apiResp.status,
              membersFound: htmlResult.members.length,
              snippet: apiText.substring(0, 500),
            });
            if (htmlResult.members.length > 0) {
              allMembers = htmlResult.members;
              totalResults = htmlResult.totalResults;
              winningStrategy = "api_sso_cookies_html";
            }
          }
        } catch (e) {
          debug.strategies.push({ name: "api_sso_cookies", error: e.message });
        }
      }
    }

    // ═══ STRATEGY 3: JSON API con cookie SSO + Basic auth insieme ═══
    if (allMembers.length === 0) {
      let cookies = null;
      try {
        const cached = await getCachedCookies(networkDomain);
        if (cached) cookies = cached.cookies;
      } catch (e) {}

      try {
        const apiUrl = `${baseUrl}/Api/directories/view?${params.toString()}`;
        const headers = {
          "User-Agent": UA,
          "Authorization": `Basic ${BASIC_TOKEN}`,
          "Accept": "application/json, text/html, */*",
          "X-Requested-With": "XMLHttpRequest",
          "Referer": `${baseUrl}/Directory`,
        };
        if (cookies) headers["Cookie"] = cookies;

        const apiResp = await fetch(apiUrl, { headers, timeout: 15000 });
        const apiText = await apiResp.text();
        let apiJson = null;
        try { apiJson = JSON.parse(apiText); } catch (e) {}

        if (apiJson) {
          const jsonResult = parseApiJson(apiJson);
          debug.strategies.push({
            name: "api_basic_plus_cookies",
            status: apiResp.status,
            isLoggedIn: apiJson.IsLoggedIn || false,
            membersFound: jsonResult.members.length,
            keys: Object.keys(apiJson).join(","),
            snippet: apiText.substring(0, 500),
          });
          if (jsonResult.members.length > 0) {
            allMembers = jsonResult.members;
            totalResults = jsonResult.totalResults;
            isLoggedIn = true;
            winningStrategy = "api_basic_plus_cookies";
          }
        }
      } catch (e) {
        debug.strategies.push({ name: "api_basic_plus_cookies", error: e.message });
      }
    }

    // ═══ STRATEGY 4: Full HTML page /Directory ═══
    if (allMembers.length === 0) {
      try {
        const directoryUrl = `${baseUrl}/Directory?${params.toString()}`;
        const resp = await fetch(directoryUrl, {
          headers: { "User-Agent": UA, "Accept": "text/html,application/xhtml+xml" },
          redirect: "follow",
          timeout: 15000,
        });
        const html = await resp.text();
        const htmlResult = extractMembersFromHtml(html);

        // Cerca wcaToken nel HTML
        const tokenMatch = html.match(/window\.wca\.token\s*=\s*["']([^"']+)["']/) || html.match(/wca\.token\s*=\s*["']([^"']+)["']/);
        const wcaToken = tokenMatch ? tokenMatch[1] : null;

        debug.strategies.push({
          name: "html_page",
          status: resp.status,
          membersFound: htmlResult.members.length,
          totalResults: htmlResult.totalResults,
          hasWcaToken: !!wcaToken,
          hasReturnUrl: html.includes("ReturnUrl"),
          htmlLength: html.length,
        });

        if (htmlResult.totalResults && !totalResults) totalResults = htmlResult.totalResults;

        if (htmlResult.members.length > 0) {
          allMembers = htmlResult.members;
          totalResults = htmlResult.totalResults;
          winningStrategy = "html_page";
        }

        // Se trovato wcaToken, prova API con quello
        if (allMembers.length === 0 && wcaToken) {
          const apiUrl = `${baseUrl}/Api/directories/view?${params.toString()}`;
          const apiResp = await fetch(apiUrl, {
            headers: {
              "User-Agent": UA,
              "Authorization": `Basic ${wcaToken}`,
              "Accept": "application/json, text/html, */*",
              "X-Requested-With": "XMLHttpRequest",
            },
            timeout: 15000,
          });
          const apiText = await apiResp.text();
          let apiJson = null;
          try { apiJson = JSON.parse(apiText); } catch (e) {}

          if (apiJson) {
            const jsonResult = parseApiJson(apiJson);
            debug.strategies.push({
              name: "api_wca_token",
              isLoggedIn: apiJson.IsLoggedIn || false,
              membersFound: jsonResult.members.length,
              snippet: apiText.substring(0, 300),
            });
            if (jsonResult.members.length > 0) {
              allMembers = jsonResult.members;
              totalResults = jsonResult.totalResults;
              isLoggedIn = true;
              winningStrategy = "api_wca_token";
            }
          }
        }
      } catch (e) {
        debug.strategies.push({ name: "html_page", error: e.message });
      }
    }

    const hasNext = allMembers.length >= pageSize;
    debug.winningStrategy = winningStrategy;
    debug.totalMembers = allMembers.length;
    debug.basicTokenPreview = BASIC_TOKEN.substring(0, 10) + "...";

    console.log(`[discover] ${networkDomain} ${country}: ${allMembers.length} members via ${winningStrategy}, total=${totalResults}`);

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
