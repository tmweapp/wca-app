/**
 * api/discover.js — Discover membri su wcaworld.com (sito generale)
 * REFACTORED: usa utils/extract.js per extractMembersFromHtml condiviso
 */
const fetch = require("node-fetch");
const cheerio = require("cheerio");
const { extractMembersFromHtml } = require("./utils/extract");

const BASE = "https://www.wcaworld.com";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const NETWORK_IDS = {
  "WCA First": 1, "WCA Advanced Professionals": 2, "WCA China Global": 3,
  "WCA Inter Global": 4, "Lognet Global": 61, "Global Affinity Alliance": 98,
  "Elite Global Logistics Network": 108, "InFinite Connection (IFC8)": 118,
  "WCA Projects": 5, "WCA Dangerous Goods": 22, "WCA Perishables": 13,
  "WCA Time Critical": 18, "WCA Relocations": 15, "WCA Pharma": 16,
  "WCA Vendors": 38, "WCA eCommerce Solutions": 107, "WCA Live Events and Expo": 124,
};

const ALL_NETWORK_IDS = Object.values(NETWORK_IDS);

function buildQueryString(page, filters) {
  const params = new URLSearchParams();
  params.set("siteID", "24");
  params.set("au", "");
  params.set("pageIndex", page);
  params.set("pageSize", "50");
  params.set("layout", "v1");
  params.set("submitted", "search");

  const keyword = (filters.searchTerm || "").trim();

  if (filters.country) {
    params.set("searchby", "CountryCode");
    params.set("country", filters.country);
    params.set("city", filters.city || "");
    params.set("keyword", keyword);
  } else if (filters.searchBy === "company_name" && keyword) {
    params.set("searchby", "CompanyName");
    params.set("country", "");
    params.set("city", "");
    params.set("keyword", keyword);
  } else if (filters.searchBy === "id_number" && keyword) {
    params.set("searchby", "ID");
    params.set("country", "");
    params.set("city", "");
    params.set("keyword", keyword);
  } else {
    params.set("searchby", "CountryCode");
    params.set("country", "");
    params.set("city", "");
    params.set("keyword", "");
  }

  if (filters.sortBy === "company_name") params.set("orderby", "CompanyName");
  else if (filters.sortBy === "membership_date") params.set("orderby", "MembershipYears");
  else params.set("orderby", "CountryCity");

  const networkNames = filters.networks && filters.networks.length > 0
    ? filters.networks : Object.keys(NETWORK_IDS);
  for (const name of networkNames) {
    const id = NETWORK_IDS[name];
    if (id) params.append("networkIds", id);
  }

  return params.toString();
}

// extractMembersFromHtml → importato da utils/extract.js

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  try {
    const { cookies, wcaToken, page = 1, filters = {} } = req.body || {};
    if (!cookies) return res.status(400).json({ error: "cookies richiesti" });

    const qs = buildQueryString(page, filters);
    const debugInfo = {};
    let allMembers = [];
    let totalResults = null;
    let isLoggedIn = false;

    const headers = {
      "User-Agent": UA,
      "Cookie": cookies,
      "Referer": `${BASE}/Directory`,
    };

    if (wcaToken) {
      try {
        const apiUrl = `${BASE}/Api/directories/view?${qs}`;
        const apiResp = await fetch(apiUrl, {
          headers: { ...headers, "Authorization": `Basic ${wcaToken}`, "Accept": "application/json, text/html, */*", "X-Requested-With": "XMLHttpRequest" },
        });
        debugInfo.apiStatus = apiResp.status;
        debugInfo.apiUrl = apiUrl;

        if (apiResp.status === 200) {
          const apiText = await apiResp.text();
          debugInfo.apiLength = apiText.length;
          try {
            const apiJson = JSON.parse(apiText);
            if (apiJson.members || apiJson.data || apiJson.results) {
              const items = apiJson.members || apiJson.data || apiJson.results || [];
              for (const item of items) {
                const id = item.id || item.memberId || item.wcaId;
                if (id) allMembers.push({ id: parseInt(id), name: item.name || item.companyName || "" });
              }
              totalResults = apiJson.total || apiJson.totalCount || apiJson.totalResults || null;
              isLoggedIn = true;
              debugInfo.apiFormat = "json";
              debugInfo.apiMembersFound = allMembers.length;
            }
          } catch (e) {
            const parsed = extractMembersFromHtml(apiText);
            if (parsed.members.length > 0) {
              allMembers = parsed.members;
              totalResults = parsed.totalResults;
              isLoggedIn = true;
              debugInfo.apiFormat = "html";
              debugInfo.apiMembersFound = allMembers.length;
            }
          }
        }
      } catch (e) { debugInfo.apiError = e.message; }
    }

    if (allMembers.length === 0) {
      const getUrl = `${BASE}/Directory?${qs}`;
      const getResp = await fetch(getUrl, {
        headers: { ...headers, "Accept": "text/html,application/xhtml+xml" },
        redirect: "follow",
      });
      debugInfo.getUrl = getUrl;
      debugInfo.getResponseUrl = getResp.url;
      if (getResp.url.toLowerCase().includes("/login")) {
        return res.json({ success: false, error: "login_required" });
      }
      const getHtml = await getResp.text();
      debugInfo.getHtmlLength = getHtml.length;
      isLoggedIn = !getHtml.includes('ReturnUrl=/MemberSection') && !getHtml.includes('type="password"');
      debugInfo.isLoggedIn = isLoggedIn;

      if (!wcaToken) {
        const tm = getHtml.match(/window\.wca\.token\s*=\s*["']([^"']+)["']/) ||
                   getHtml.match(/wca\.token\s*=\s*["']([^"']+)["']/) ||
                   getHtml.match(/["']token["']\s*:\s*["']([A-Za-z0-9+/=]+)["']/);
        if (tm) debugInfo.foundToken = tm[1].substring(0, 20) + "...";
      }

      const parsed = extractMembersFromHtml(getHtml);
      allMembers = parsed.members;
      if (parsed.totalResults) totalResults = parsed.totalResults;
      debugInfo.getMembersFound = allMembers.length;

      const $ = cheerio.load(getHtml);
      // Debug: log li elements and all hrefs containing 'member' or 'directory'
      const liCount = $("li").length;
      const liDirCount = $("li.directoyname, li.directoryname").length;
      const allLinks = [];
      $("a[href]").each((_, el) => {
        const h = $(el).attr("href") || "";
        if (h.includes("member") || h.includes("Member") || h.includes("directory") || h.includes("Directory")) {
          allLinks.push(h);
        }
      });
      console.log(`[discover] HTML len=${getHtml.length} li=${liCount} li.directoyname=${liDirCount} memberLinks=${allLinks.length}`);
      console.log(`[discover] Sample links: ${[...new Set(allLinks)].slice(0,5).join(" | ")}`);
      console.log(`[discover] isLoggedIn=${isLoggedIn} totalResults=${totalResults} members=${allMembers.length}`);
      // Log a snippet of the HTML around member listings
      const bodySnippet = $("body").text().replace(/\s+/g," ").trim().substring(0,300);
      console.log(`[discover] body: ${bodySnippet.substring(0,150)}`);

      debugInfo.memberRelatedHrefs = [...new Set(allLinks)].slice(0, 15);
      for (const m of allMembers) {
        console.log(`[discover] Member id=${m.id} href="${m.href}"`);
      }
    }

    if (allMembers.length === 0 || page > 1) {
      try {
        const ajaxUrl = `${BASE}/directories/next?${qs}`;
        const ajaxHeaders = { ...headers, "X-Requested-With": "XMLHttpRequest", "Accept": "*/*" };
        if (wcaToken) ajaxHeaders["Authorization"] = `Basic ${wcaToken}`;
        const ajaxResp = await fetch(ajaxUrl, { headers: ajaxHeaders });
        debugInfo.ajaxUrl = ajaxUrl;
        debugInfo.ajaxStatus = ajaxResp.status;
        if (ajaxResp.status === 200) {
          const ajaxText = await ajaxResp.text();
          debugInfo.ajaxLength = ajaxText.length;
          const ajaxParsed = extractMembersFromHtml(ajaxText);
          debugInfo.ajaxMembersFound = ajaxParsed.length;
          const seenIds = new Set(allMembers.map(m => m.id));
          for (const m of ajaxParsed.members) {
            if (!seenIds.has(m.id)) { seenIds.add(m.id); allMembers.push(m); }
          }
          if (ajaxParsed.totalResults && !totalResults) totalResults = ajaxParsed.totalResults;
        }
      } catch (e) { debugInfo.ajaxError = e.message; }
    }

    const hasNext = allMembers.length >= 50;
    const fallbackToRange = allMembers.length === 0 && !isLoggedIn;

    return res.json({ success: true, members: allMembers, page, hasNext, totalResults, isLoggedIn, fallbackToRange, debug: debugInfo });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};
