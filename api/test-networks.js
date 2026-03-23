const fetch = require("node-fetch");
const cheerio = require("cheerio");

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const NETWORKS = {
  "WCA First":                     { domain: "https://www.wcaworld.com" },
  "WCA Advanced Professionals":    { domain: "https://www.wcaworld.com" },
  "WCA China Global":              { domain: "https://www.wcachinaglobal.com" },
  "WCA Inter Global":              { domain: "https://www.wcainterglobal.com" },
  "Lognet Global":                 { domain: "https://www.lognetglobal.com" },
  "Global Affinity Alliance":      { domain: "https://www.globalaffinityalliance.com" },
  "Elite Global Logistics Network":{ domain: "https://www.elitegln.com" },
  "InFinite Connection (IFC8)":    { domain: "https://www.ifc8.com" },
  "WCA Projects":                  { domain: "https://www.wcaprojects.com" },
  "WCA Dangerous Goods":           { domain: "https://www.wcadangerousgoods.com" },
  "WCA Perishables":               { domain: "https://www.wcaperishables.com" },
  "WCA Time Critical":             { domain: "https://www.wcatimecritical.com" },
  "WCA Relocations":               { domain: "https://www.wcarelocations.com" },
  "WCA Pharma":                    { domain: "https://www.wcapharma.com" },
  "WCA Vendors":                   { domain: "https://www.wcavendors.com" },
  "WCA eCommerce Solutions":       { domain: "https://www.wcaecommerce.com" },
  "WCA Live Events and Expo":      { domain: "https://www.wcaliveevents.com" },
};

// SSO login con cookie separati per dominio
async function ssoLoginForDomain(base, username, password) {
  const WCA_DOMAIN = new URL(base).hostname;
  const SSO_DOMAIN = "sso.api.wcaworld.com";
  const jar = {};
  const addC = (dom, hdrs) => { if (!jar[dom]) jar[dom] = {}; for (const raw of (hdrs||[])) { const c = raw.split(";")[0]; const eq = c.indexOf("="); if (eq > 0) jar[dom][c.substring(0, eq)] = c; } };
  const getC = (dom) => jar[dom] ? Object.values(jar[dom]).join("; ") : "";
  const keysC = (dom) => jar[dom] ? Object.keys(jar[dom]) : [];

  try {
    // Step 1: GET login page
    let resp = await fetch(`${base}/Account/Login`, { headers: { "User-Agent": UA }, redirect: "manual", timeout: 12000 });
    addC(WCA_DOMAIN, resp.headers.raw()["set-cookie"]);
    let currentUrl = `${base}/Account/Login`;
    let rc = 0;
    while (resp.status >= 300 && resp.status < 400 && rc < 5) {
      const loc = resp.headers.get("location") || "";
      currentUrl = loc.startsWith("http") ? loc : new URL(loc, currentUrl).href;
      resp = await fetch(currentUrl, { headers: { "User-Agent": UA, "Cookie": getC(WCA_DOMAIN) }, redirect: "manual", timeout: 12000 });
      addC(WCA_DOMAIN, resp.headers.raw()["set-cookie"]);
      rc++;
    }
    const loginHtml = resp.status === 200 ? await resp.text() : "";
    const ssoUrlMatch = loginHtml.match(/action\s*[:=]\s*['"]?(https:\/\/sso\.api\.wcaworld\.com[^'"&\s]+[^'"]*)/i);
    if (!ssoUrlMatch) return { login: false, error: "SSO URL not found" };
    const ssoUrl = ssoUrlMatch[1].replace(/&amp;/g, "&");

    // Step 2: POST to SSO
    const ssoResp = await fetch(ssoUrl, {
      method: "POST",
      headers: { "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded", "Origin": "https://sso.api.wcaworld.com", "Referer": ssoUrl },
      body: `UserName=${encodeURIComponent(username)}&Password=${encodeURIComponent(password)}&pwd=${encodeURIComponent(password)}`,
      redirect: "manual", timeout: 12000,
    });
    addC(SSO_DOMAIN, ssoResp.headers.raw()["set-cookie"]);
    if (!keysC(SSO_DOMAIN).includes(".ASPXAUTH")) return { login: false, error: "Auth failed - wrong credentials?" };

    // Step 3: Follow redirects — domain-separated cookies
    let callbackUrl = ssoResp.headers.get("location") || "";
    let followCount = 0;
    while (callbackUrl && followCount < 8) {
      const cbUrl = callbackUrl.startsWith("http") ? callbackUrl : new URL(callbackUrl, ssoUrl).href;
      const cbDomain = cbUrl.includes("sso.api.wcaworld.com") ? SSO_DOMAIN : WCA_DOMAIN;
      const cbResp = await fetch(cbUrl, { headers: { "User-Agent": UA, "Cookie": getC(cbDomain) }, redirect: "manual", timeout: 12000 });
      addC(cbDomain, cbResp.headers.raw()["set-cookie"]);
      const nextLoc = cbResp.headers.get("location") || "";
      callbackUrl = nextLoc ? (nextLoc.startsWith("http") ? nextLoc : new URL(nextLoc, cbUrl).href) : null;
      if (cbResp.status === 200) break;
      followCount++;
    }

    // Step 4: Warmup /Directory
    try {
      let wr = await fetch(`${base}/Directory`, { headers: { "User-Agent": UA, "Cookie": getC(WCA_DOMAIN) }, redirect: "manual", timeout: 12000 });
      addC(WCA_DOMAIN, wr.headers.raw()["set-cookie"]);
      let wLoc = wr.headers.get("location") || "";
      let wc = 0;
      while (wLoc && wc < 3) {
        const wNext = wLoc.startsWith("http") ? wLoc : new URL(wLoc, `${base}/Directory`).href;
        wr = await fetch(wNext, { headers: { "User-Agent": UA, "Cookie": getC(WCA_DOMAIN) }, redirect: "manual", timeout: 12000 });
        addC(WCA_DOMAIN, wr.headers.raw()["set-cookie"]);
        wLoc = wr.headers.get("location") || ""; wc++;
      }
    } catch(e) {}

    const wcaHasAuth = keysC(WCA_DOMAIN).includes(".ASPXAUTH");
    return { login: true, hasAuth: wcaHasAuth, cookies: getC(WCA_DOMAIN), keys: keysC(WCA_DOMAIN) };
  } catch (e) {
    return { login: false, error: e.message };
  }
}

// Verifica accesso: visita /Directory e controlla se vedi contenuto autenticato
// Poi prova a trovare il PRIMO membro nella directory e verifica se i contatti sono visibili
async function testAccess(base, cookies) {
  try {
    // Test 1: Visita /Directory — se redirecta al login, non sei autenticato
    let resp = await fetch(`${base}/Directory`, {
      headers: { "User-Agent": UA, "Cookie": cookies, "Accept": "text/html" },
      redirect: "manual", timeout: 12000,
    });
    let rc = 0;
    while (resp.status >= 300 && resp.status < 400 && rc < 3) {
      const loc = resp.headers.get("location") || "";
      if (loc.toLowerCase().includes("/login")) return { authenticated: false, reason: "redirect_to_login" };
      const next = loc.startsWith("http") ? loc : new URL(loc, `${base}/Directory`).href;
      resp = await fetch(next, { headers: { "User-Agent": UA, "Cookie": cookies }, redirect: "manual", timeout: 12000 });
      rc++;
    }
    const dirHtml = await resp.text();
    if (dirHtml.includes('type="password"')) return { authenticated: false, reason: "login_page" };

    const $ = cheerio.load(dirHtml);
    const hasLogout = /logout|sign.?out|log\s*out/i.test(dirHtml);
    const hasWelcome = /welcome|benvenuto|my\s*account/i.test(dirHtml);
    const hasDirectory = $("table tr, .member_row, [class*='member'], [class*='directory']").length > 0;

    // Trova il primo link a un profilo membro nella directory
    let firstMemberUrl = null;
    let firstMemberId = null;
    $("a[href*='/directory/members/'], a[href*='/Directory/Members/']").each((_, el) => {
      if (firstMemberUrl) return;
      const href = $(el).attr("href") || "";
      const match = href.match(/\/directory\/members\/(\d+)/i);
      if (match) {
        firstMemberId = match[1];
        firstMemberUrl = href.startsWith("http") ? href : base + href;
      }
    });

    // Se non troviamo link, cerca nel HTML raw
    if (!firstMemberUrl) {
      const hrefMatch = dirHtml.match(/\/[Dd]irectory\/[Mm]embers\/(\d+)/);
      if (hrefMatch) {
        firstMemberId = hrefMatch[1];
        firstMemberUrl = base + hrefMatch[0];
      }
    }

    const result = {
      authenticated: hasLogout || hasDirectory,
      hasLogout,
      hasWelcome,
      hasDirectory,
      directoryHtmlLen: dirHtml.length,
      firstMemberId,
    };

    // Test 2: Se troviamo un membro, verifica se i contatti sono visibili
    if (firstMemberUrl) {
      try {
        let pResp = await fetch(firstMemberUrl, {
          headers: { "User-Agent": UA, "Cookie": cookies, "Accept": "text/html" },
          redirect: "manual", timeout: 12000,
        });
        let prc = 0;
        while (pResp.status >= 300 && pResp.status < 400 && prc < 3) {
          const loc = pResp.headers.get("location") || "";
          if (loc.toLowerCase().includes("/login")) break;
          const next = loc.startsWith("http") ? loc : new URL(loc, firstMemberUrl).href;
          pResp = await fetch(next, { headers: { "User-Agent": UA, "Cookie": cookies }, redirect: "manual", timeout: 12000 });
          prc++;
        }
        if (pResp.status === 200) {
          const profileHtml = await pResp.text();
          const $p = cheerio.load(profileHtml);
          const h1 = $p("h1").first().text().trim();
          const membersOnlyCount = (profileHtml.match(/Members\s*Only/gi) || []).length;
          const loginLinks = (profileHtml.match(/>Login<\/a>/gi) || []).length;
          const hasEmails = !!($p("a[href^='mailto:']").length);

          result.profileTest = {
            memberId: firstMemberId,
            companyName: h1.substring(0, 60),
            membersOnlyCount,
            loginLinks,
            hasEmails,
            fullAccess: hasEmails || (membersOnlyCount === 0 && loginLinks === 0),
          };
        }
      } catch(e) {
        result.profileTest = { error: e.message };
      }
    }

    return result;
  } catch (e) {
    return { authenticated: false, reason: e.message };
  }
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  try {
    const { network, credentials } = req.body || {};

    const defaultUser = credentials?.default?.user || process.env.WCA_USERNAME || "tmsrlmin";
    const defaultPass = credentials?.default?.pass || process.env.WCA_PASSWORD || "G0u3v!VvCn";

    const networksToTest = network ? { [network]: NETWORKS[network] } : NETWORKS;
    if (network && !NETWORKS[network]) {
      return res.status(400).json({ error: `Network sconosciuto: ${network}`, available: Object.keys(NETWORKS) });
    }

    const results = {};
    for (const [name, info] of Object.entries(networksToTest)) {
      const netCreds = credentials?.networks?.[name];
      const user = netCreds?.user || defaultUser;
      const pass = netCreds?.pass || defaultPass;

      console.log(`[test] Testing ${name} on ${info.domain}...`);

      // Step 1: SSO Login
      const loginResult = await ssoLoginForDomain(info.domain, user, pass);
      if (!loginResult.login) {
        results[name] = { status: "login_failed", domain: info.domain, error: loginResult.error, group: "unavailable" };
        console.log(`[test] ${name}: LOGIN FAILED - ${loginResult.error}`);
        continue;
      }

      // Step 2: Test access — visita /Directory e prova un profilo
      const accessResult = await testAccess(info.domain, loginResult.cookies);

      const isAuthenticated = accessResult.authenticated;
      const hasFullAccess = accessResult.profileTest?.fullAccess ?? false;
      const group = isAuthenticated ? (hasFullAccess ? "available" : "partial") : "unavailable";

      results[name] = {
        status: isAuthenticated ? "ok" : "not_authenticated",
        domain: info.domain,
        group,
        authenticated: isAuthenticated,
        hasLogout: accessResult.hasLogout,
        hasDirectory: accessResult.hasDirectory,
        hasAuth: loginResult.hasAuth,
        wcaCookies: loginResult.keys,
        firstMember: accessResult.firstMemberId || null,
        profileTest: accessResult.profileTest || null,
        customCredentials: !!netCreds,
      };

      const fullStr = hasFullAccess ? "FULL ACCESS" : (isAuthenticated ? "AUTHENTICATED (contacts may be limited)" : "NOT AUTHENTICATED");
      console.log(`[test] ${name}: ${fullStr} auth=${isAuthenticated} hasAuth=${loginResult.hasAuth}`);
    }

    // Summary — "partial" conta come available (sei autenticato, i dati base ci sono)
    const available = Object.entries(results).filter(([, r]) => r.group === "available" || r.group === "partial").map(([n]) => n);
    const unavailable = Object.entries(results).filter(([, r]) => r.group === "unavailable").map(([n]) => n);

    return res.json({
      success: true,
      summary: { available: available.length, unavailable: unavailable.length, total: Object.keys(results).length },
      available,
      unavailable,
      details: results,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};
