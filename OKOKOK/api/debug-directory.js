/**
 * api/debug-directory.js — Debug: scarica un frammento HTML della directory WCA
 * per verificare se i network di appartenenza sono visibili per ogni membro
 */
const fetch = require("node-fetch");
const cheerio = require("cheerio");
const { ssoLogin, getCachedCookies, saveCookiesToCache, testCookies, UA } = require("./utils/auth");
const { NETWORK_DOMAINS } = require("./utils/extract");

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  try {
    const { country = "MT", pageSize = 50 } = req.body || {};
    const networkDomain = "wcaworld.com";
    const networkInfo = NETWORK_DOMAINS[networkDomain];
    const { base: baseUrl, siteId } = networkInfo;

    // Auth
    let cookies = null;
    const cached = await getCachedCookies(networkDomain);
    if (cached) {
      cookies = cached.cookies;
      const valid = await testCookies(cookies, baseUrl);
      if (!valid) cookies = null;
    }
    if (!cookies) {
      const loginResult = await ssoLogin(null, null, baseUrl);
      if (!loginResult.success) return res.status(500).json({ error: "SSO fallito" });
      cookies = loginResult.cookies;
      await saveCookiesToCache(cookies, networkDomain, loginResult.ssoCookies || "");
    }

    const params = new URLSearchParams();
    params.set("siteID", siteId);
    params.set("pageIndex", 1);
    params.set("pageNumber", 1);
    params.set("pageSize", pageSize);
    params.set("searchby", "CountryCode");
    params.set("countrycode", country);
    params.set("country", country);
    params.set("orderby", "CountryCity");
    params.set("submitted", "search");
    params.set("layout", "v1");
    params.set("au", "");
    params.set("networkIds", siteId);

    const url = `${baseUrl}/Directory?${params.toString()}`;
    const resp = await fetch(url, {
      headers: { "User-Agent": UA, "Cookie": cookies, "Referer": `${baseUrl}/Directory` },
      redirect: "follow", timeout: 15000,
    });
    const html = await resp.text();
    const $ = cheerio.load(html);

    // Estrai i primi 5 membri con TUTTO il contesto HTML circostante
    const memberDetails = [];

    // Cerca la lista directory
    const listItems = $("li.directoyname, li.directoryname, .directory-list li, .member-list li, ul.results li");

    // Se non ci sono li specifici, cerca il contenitore della lista
    const directoryContainer = $(".directory-results, .member-results, .results-list, #directoryResults, .directory_list").first();

    let containerHtml = "";
    if (directoryContainer.length) {
      containerHtml = directoryContainer.html()?.substring(0, 3000) || "";
    }

    // Per ogni membro, estrai il blocco HTML completo del parent
    $("a[href*='/directory/members/'], a[href*='/Directory/Members/']").slice(0, 5).each((i, el) => {
      const $el = $(el);
      const href = $el.attr("href") || "";
      const name = $el.text().trim();
      const idMatch = href.match(/\/members\/(\d+)/i);
      const id = idMatch ? parseInt(idMatch[1]) : 0;

      // Risali al contenitore padre (li, div, tr) che contiene tutte le info
      const $parent = $el.closest("li, div.member, div.directory-item, tr").first();
      const parentHtml = $parent.length ? $parent.html()?.substring(0, 2000) : $el.parent().html()?.substring(0, 2000);

      // Cerca immagini/badge network nel parent
      const networkImages = [];
      ($parent.length ? $parent : $el.parent()).find("img").each((_, img) => {
        const src = $(img).attr("src") || "";
        const alt = $(img).attr("alt") || "";
        const title = $(img).attr("title") || "";
        if (src && !src.includes("flag") && !src.includes("spacer")) {
          networkImages.push({ src, alt, title });
        }
      });

      // Cerca testi con nomi di network
      const parentText = ($parent.length ? $parent : $el.parent()).text().replace(/\s+/g, " ").trim();

      // Cerca classi/attributi che indicano network
      const networkClasses = [];
      ($parent.length ? $parent : $el.parent()).find("[class*='network'], [class*='badge'], [data-network], [data-networks]").each((_, nel) => {
        networkClasses.push({
          tag: nel.tagName,
          class: $(nel).attr("class") || "",
          dataNetwork: $(nel).attr("data-network") || $(nel).attr("data-networks") || "",
          text: $(nel).text().trim().substring(0, 100),
        });
      });

      memberDetails.push({ id, name, href, networkImages, parentText: parentText.substring(0, 500), networkClasses, parentHtml: parentHtml?.substring(0, 1500) });
    });

    // Cerca anche strutture generali nella pagina
    const networkBadges = [];
    $("img[src*='network'], img[alt*='network'], img[src*='logo'], .network-badge, .network-icon").slice(0, 10).each((_, el) => {
      networkBadges.push({
        tag: el.tagName,
        src: $(el).attr("src") || "",
        alt: $(el).attr("alt") || "",
        class: $(el).attr("class") || "",
      });
    });

    return res.json({
      success: true,
      country,
      totalHtmlLength: html.length,
      membersFound: memberDetails.length,
      members: memberDetails,
      containerSnippet: containerHtml.substring(0, 2000),
      networkBadgesInPage: networkBadges,
      listItemsCount: listItems.length,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};
