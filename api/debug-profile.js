const fetch = require("node-fetch");
const cheerio = require("cheerio");
const { ssoLogin, getCachedCookies, saveCookiesToCache, testCookies, BASE, UA } = require("./utils/auth");

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const wcaId = req.body?.wcaId || req.query?.id || 37861;
  const forceLogin = req.query?.fresh === "1"; // ?fresh=1 to force fresh SSO login

  try {
    // 1. Get cookies (always fresh if ?fresh=1, otherwise try cache)
    let cookies = null;
    let wcaToken = null;
    if (!forceLogin) {
      cookies = await getCachedCookies();
      if (cookies) {
        const valid = await testCookies(cookies);
        if (!valid) cookies = null;
      }
    } else {
      console.log("[debug] Forced fresh login (fresh=1)");
    }
    if (!cookies) {
      const loginResult = await ssoLogin();
      if (!loginResult.success) return res.json({ success: false, error: "Login failed: " + loginResult.error });
      cookies = loginResult.cookies;
      wcaToken = loginResult.wcaToken;
      await saveCookiesToCache(cookies);
    }

    // 2. Fetch profile page
    const url = `${BASE}/directory/members/${wcaId}`;
    const resp = await fetch(url, {
      headers: { "User-Agent": UA, "Cookie": cookies, "Referer": `${BASE}/Directory` },
      redirect: "follow",
    });
    const html = await resp.text();
    const $ = cheerio.load(html);

    // 3. Basic diagnostics
    const diag = {
      wcaId,
      httpStatus: resp.status,
      htmlLen: html.length,
      cookieLen: cookies.length,
      cookieKeys: cookies.split("; ").map(c => c.split("=")[0]),
      hasAuth: cookies.includes(".ASPXAUTH"),
      membersOnlyCount: (html.match(/Members\s*Only/gi) || []).length,
      h1: $("h1").first().text().trim(),
    };

    // 4. Extract ALL script sources and inline script snippets with API/ajax/contact patterns
    diag.scriptSources = [];
    $("script[src]").each((_, el) => {
      diag.scriptSources.push($(el).attr("src"));
    });

    diag.inlineScriptHints = [];
    $("script:not([src])").each((_, el) => {
      const content = $(el).html() || "";
      // Look for API URLs, ajax calls, fetch calls, contact-related code
      const patterns = [
        /(?:url|api|endpoint|href)\s*[:=]\s*['"`]([^'"`\n]{5,200})/gi,
        /\$\.(?:get|post|ajax|getJSON)\s*\(\s*['"`]([^'"`\n]{5,200})/gi,
        /fetch\s*\(\s*['"`]([^'"`\n]{5,200})/gi,
        /window\.wca\.[a-zA-Z]+\s*=\s*['"`]?([^'"`;\n]{3,200})/gi,
        /(?:contact|member|profile|token|auth)[^;\n]{0,300}/gi,
      ];
      for (const pat of patterns) {
        let m;
        while ((m = pat.exec(content)) !== null) {
          diag.inlineScriptHints.push(m[0].substring(0, 300));
        }
      }
      // Also capture full window.wca block
      const wcaBlock = content.match(/window\.wca\s*=\s*\{[^}]+\}/);
      if (wcaBlock) diag.inlineScriptHints.push(wcaBlock[0].substring(0, 500));
    });

    // 5. Extract wcaToken from page if available
    const tokenMatch = html.match(/window\.wca\.token\s*=\s*["']([^"']+)["']/) ||
                       html.match(/wca\.token\s*=\s*["']([^"']+)["']/) ||
                       html.match(/["']token["']\s*:\s*["']([A-Za-z0-9+/=]+)["']/);
    if (tokenMatch) wcaToken = tokenMatch[1];
    diag.wcaToken = wcaToken ? wcaToken.substring(0, 30) + "..." : null;

    // 6. Try multiple API endpoints to get contact data
    const apiEndpoints = [
      `/Api/directories/members/${wcaId}`,
      `/Api/directory/members/${wcaId}`,
      `/Api/members/${wcaId}`,
      `/Api/members/${wcaId}/contacts`,
      `/Api/directory/member/${wcaId}`,
      `/Api/directory/member/contacts/${wcaId}`,
      `/Api/directories/member/${wcaId}`,
      `/directory/members/${wcaId}?format=json`,
      `/Api/contacts/${wcaId}`,
      `/Api/profile/${wcaId}`,
    ];

    diag.apiAttempts = [];
    const baseHeaders = {
      "User-Agent": UA,
      "Cookie": cookies,
      "Accept": "application/json, text/html, */*",
      "X-Requested-With": "XMLHttpRequest",
      "Referer": `${BASE}/directory/members/${wcaId}`,
    };
    if (wcaToken) baseHeaders["Authorization"] = `Basic ${wcaToken}`;

    for (const ep of apiEndpoints) {
      try {
        const apiResp = await fetch(`${BASE}${ep}`, { headers: baseHeaders, redirect: "manual", timeout: 8000 });
        const status = apiResp.status;
        let body = "";
        if (status === 200 || status === 201) {
          body = await apiResp.text();
          body = body.substring(0, 1000);
        }
        const loc = apiResp.headers.get("location") || "";
        diag.apiAttempts.push({ endpoint: ep, status, bodySnippet: body, redirect: loc || undefined });
      } catch (e) {
        diag.apiAttempts.push({ endpoint: ep, error: e.message });
      }
    }

    // 7. Try fetching profile with additional headers (mimic AJAX request from page)
    try {
      const ajaxResp = await fetch(`${BASE}/directory/members/${wcaId}`, {
        headers: {
          ...baseHeaders,
          "Accept": "text/html, */*; q=0.01",
          "X-Requested-With": "XMLHttpRequest",
        },
        redirect: "follow",
      });
      const ajaxHtml = await ajaxResp.text();
      const ajaxEmails = ajaxHtml.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || [];
      const ajaxMembersOnly = (ajaxHtml.match(/Members\s*only/gi) || []).length;
      diag.ajaxProfileFetch = {
        status: ajaxResp.status,
        htmlLen: ajaxHtml.length,
        emails: [...new Set(ajaxEmails)],
        membersOnlyCount: ajaxMembersOnly,
      };
    } catch (e) {
      diag.ajaxProfileFetch = { error: e.message };
    }

    // 8. Try fetching with cid parameter (the login redirect pattern seen in the HTML)
    try {
      const cidResp = await fetch(`${BASE}/Account/Login/?cid=${wcaId}&returnurl=/Directory/Members/${wcaId}`, {
        headers: { "User-Agent": UA, "Cookie": cookies },
        redirect: "follow",
      });
      const cidHtml = await cidResp.text();
      const cidEmails = cidHtml.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || [];
      diag.cidLoginAttempt = {
        status: cidResp.status,
        finalUrl: cidResp.url,
        htmlLen: cidHtml.length,
        emails: [...new Set(cidEmails)].filter(e => !e.includes("wcaworld")),
        membersOnlyCount: (cidHtml.match(/Members\s*only/gi) || []).length,
      };
    } catch (e) {
      diag.cidLoginAttempt = { error: e.message };
    }

    // 9. Check data attributes and hidden inputs that might contain contact info
    diag.dataAttributes = [];
    $("[data-contact], [data-email], [data-phone], [data-member], [data-id]").each((_, el) => {
      const attrs = {};
      for (const attr of Object.keys(el.attribs || {})) {
        if (attr.startsWith("data-")) attrs[attr] = $(el).attr(attr);
      }
      if (Object.keys(attrs).length > 0) diag.dataAttributes.push(attrs);
    });

    diag.hiddenInputs = [];
    $("input[type='hidden']").each((_, el) => {
      const name = $(el).attr("name") || $(el).attr("id") || "";
      const val = $(el).attr("value") || "";
      if (name) diag.hiddenInputs.push({ name, value: val.substring(0, 100) });
    });

    // 10. Look for specific member/contact related URLs in the entire HTML
    const apiUrlMatches = html.match(/\/Api\/[a-zA-Z0-9\/_?&=.-]+/gi) || [];
    diag.apiUrlsInHtml = [...new Set(apiUrlMatches)];

    const memberUrlMatches = html.match(/\/[a-zA-Z]*\/?(?:member|contact|profile)[a-zA-Z0-9\/_?&=.-]*/gi) || [];
    diag.memberUrlsInHtml = [...new Set(memberUrlMatches)].slice(0, 20);

    return res.json({ success: true, diag });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};
