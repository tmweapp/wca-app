const fetch = require("node-fetch");
const cheerio = require("cheerio");
const { ssoLogin, getCachedCookies, saveCookiesToCache, testCookies, UA } = require("./utils/auth");

// Tutti i domini network WCA
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

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const wcaId = req.body?.wcaId || req.query?.id || 37861;
  const testDomain = req.query?.domain || null; // ?domain=wcaprojects.com → testa solo quello
  const forceLogin = req.query?.fresh === "1";

  try {
    // 1. Auth
    let cookies = null;
    if (!forceLogin) {
      // getCachedCookies ritorna { cookies, ssoCookies } o null
      const cached = await getCachedCookies();
      if (cached) {
        cookies = cached.cookies;
        const valid = await testCookies(cookies);
        if (!valid) cookies = null;
      }
    }
    if (!cookies) {
      const loginResult = await ssoLogin();
      if (!loginResult.success) return res.json({ success: false, error: "Login failed: " + loginResult.error });
      cookies = loginResult.cookies;
      await saveCookiesToCache(cookies, undefined, loginResult.ssoCookies || "");
    }

    const hasAuth = cookies.includes(".ASPXAUTH");

    // 2. Determina quali domini testare
    const domainsToTest = testDomain
      ? { [testDomain]: NETWORK_DOMAINS[testDomain] || { base: `https://www.${testDomain}` } }
      : NETWORK_DOMAINS;

    // 3. Test profilo su ogni dominio
    const results = {};
    for (const [domain, info] of Object.entries(domainsToTest)) {
      const baseUrl = info.base;
      const profileUrl = `${baseUrl}/directory/members/${wcaId}`;

      try {
        const resp = await fetch(profileUrl, {
          headers: {
            "User-Agent": UA,
            "Cookie": cookies,
            "Referer": `${baseUrl}/Directory`,
          },
          redirect: "follow",
          timeout: 12000,
        });

        const html = await resp.text();
        const $ = cheerio.load(html);
        const h1 = $("h1").first().text().trim();

        // Check se il profilo esiste su questo network
        const isNotFound = resp.status === 404 ||
          /not\s*found|error|404/i.test(h1) ||
          html.includes("Requested URL was not found");

        if (isNotFound) {
          results[domain] = { found: false, status: resp.status };
          continue;
        }

        // Check accesso login
        const isLoginPage = html.includes('type="password"') || resp.url.includes("/Login");
        if (isLoginPage) {
          results[domain] = { found: false, loginRedirect: true, finalUrl: resp.url };
          continue;
        }

        // Conteggio "Members only"
        const membersOnlyCount = (html.match(/Members\s*only/gi) || []).length;

        // Estrai email dalla pagina
        const allEmails = html.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || [];
        const uniqueEmails = [...new Set(allEmails)].filter(e => !e.includes("wcaworld.com"));

        // Estrai contatti con nome/email
        const contacts = [];
        $(".contactperson_row, [class*='contactperson']").each((_, row) => {
          const name = $(row).find("h4, h5, .contactperson_name, strong").first().text().trim();
          const title = [];
          const emails = [];
          const phones = [];

          $(row).find(".profile_row").each((_, pr) => {
            const label = $(pr).find(".profile_label").text().trim().toLowerCase();
            const val = $(pr).find(".profile_val").text().trim();
            const mailto = $(pr).find("a[href^='mailto:']").attr("href");

            if (/members\s*only|please.*login/i.test(val)) return; // skip restricted

            if (/title|position/i.test(label)) title.push(val);
            else if (/email/i.test(label)) {
              if (mailto) emails.push(mailto.replace("mailto:", "").trim());
              else if (val.includes("@")) emails.push(val);
            }
            else if (/direct|phone|mobile/i.test(label)) phones.push(val);
          });

          if (name || emails.length > 0 || title.length > 0) {
            contacts.push({
              name: name || null,
              title: title[0] || null,
              email: emails[0] || null,
              phone: phones[0] || null,
              hasData: !!(name && emails.length > 0)
            });
          }
        });

        results[domain] = {
          found: true,
          companyName: h1,
          status: resp.status,
          htmlLen: html.length,
          membersOnlyCount,
          emailsFound: uniqueEmails,
          contactsExtracted: contacts,
          contactsWithEmail: contacts.filter(c => c.email).length,
          contactsTotal: contacts.length,
          hasFullAccess: membersOnlyCount === 0 && contacts.some(c => c.email),
        };
      } catch (e) {
        results[domain] = { found: false, error: e.message };
      }
    }

    return res.json({
      success: true,
      wcaId,
      hasAuth,
      cookieKeys: cookies.split("; ").map(c => c.split("=")[0]),
      networkResults: results,
      summary: {
        tested: Object.keys(results).length,
        found: Object.values(results).filter(r => r.found).length,
        withFullAccess: Object.values(results).filter(r => r.hasFullAccess).length,
        withEmails: Object.values(results).filter(r => r.contactsWithEmail > 0).length,
      }
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};
