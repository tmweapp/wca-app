const fetch = require("node-fetch");

const BASE = "https://www.wcaworld.com";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const SUPABASE_URL = process.env.SUPABASE_URL || "https://dlldkrzoxvjxpgkkttxu.supabase.co";
const SUPABASE_KEY = (process.env.SUPABASE_SERVICE_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRsbGRrcnpveHZqeHBna2t0dHh1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1ODcyMDU4NCwiZXhwIjoyMDc0Mjk2NTg0fQ.py_d96kA6Mqvi0ugBm4gmIlJSoOC_KbwUM7cgDR-O_E").trim();

// Hash dominio → ID numerico per Supabase (wcaworld.com=1, altri>100)
function domainToId(domain) {
  if (!domain || domain === "wcaworld.com") return 1;
  let hash = 100;
  for (let i = 0; i < domain.length; i++) hash = ((hash * 31 + domain.charCodeAt(i)) % 9000) + 100;
  return hash;
}

// Cache sessione SSO in Supabase — evita login ripetuti
// domain: opzionale, per cachare cookies di network specifici
async function getCachedCookies(domain) {
  const id = domainToId(domain);
  try {
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/wca_session?select=*&id=eq.${id}`, {
      headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}` },
      timeout: 5000,
    });
    if (!resp.ok) return null;
    const rows = await resp.json();
    if (!rows || rows.length === 0) return null;
    const row = rows[0];
    // Cookie validi per max 30 minuti (prima era 10min, troppo breve per 12 network)
    const age = Date.now() - new Date(row.updated_at).getTime();
    if (age > 30 * 60 * 1000) { console.log(`[auth] Cached cookies scaduti (>30min) domain=${domain||"wcaworld.com"}`); return null; }
    console.log(`[auth] Usando cookies cached (età: ${Math.round(age/1000)}s) domain=${domain||"wcaworld.com"} hasSso=${!!row.sso_cookies}`);
    // Ritorna ANCHE i cookies SSO — servono per i redirect a sso.api.wcaworld.com/CheckLoggedIn
    return { cookies: row.cookies, ssoCookies: row.sso_cookies || "" };
  } catch (e) { console.log("[auth] Cache read error: " + e.message); return null; }
}

async function saveCookiesToCache(cookies, domain, ssoCookies) {
  const id = domainToId(domain);
  try {
    const data = { id, cookies, updated_at: new Date().toISOString() };
    if (ssoCookies) data.sso_cookies = ssoCookies;
    await fetch(`${SUPABASE_URL}/rest/v1/wca_session`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json", "apikey": SUPABASE_KEY,
        "Authorization": `Bearer ${SUPABASE_KEY}`, "Prefer": "resolution=merge-duplicates",
      },
      body: JSON.stringify(data),
      timeout: 5000,
    });
    console.log(`[auth] Cookies salvati in cache domain=${domain||"wcaworld.com"} id=${id} sso=${!!ssoCookies}`);
  } catch (e) { console.log("[auth] Cache save error: " + e.message); }
}

// Test rapido: i cookies funzionano? Controlla /Directory + verifica autenticazione reale
async function testCookies(cookies, targetBase) {
  const testBase = targetBase || BASE;
  try {
    const resp = await fetch(`${testBase}/Directory`, {
      headers: { "User-Agent": UA, "Cookie": cookies },
      redirect: "manual", timeout: 8000,
    });
    // Se redirect al login → cookies non validi
    const loc = resp.headers.get("location") || "";
    if (loc.toLowerCase().includes("/login") || loc.toLowerCase().includes("/signin")) {
      console.log(`[auth] testCookies: redirect al login → invalidi`);
      return false;
    }
    if (resp.status === 200) {
      const html = await resp.text();
      const hasPassword = html.includes('type="password"');
      const hasLogout = /logout|sign.?out/i.test(html);
      // Verifica che ci sia REALMENTE un logout link — se no, non siamo loggati
      if (hasPassword || !hasLogout) {
        console.log(`[auth] testCookies: password=${hasPassword} logout=${hasLogout} → invalidi`);
        return false;
      }
      // Verifica extra: cookie contiene .ASPXAUTH (necessario per autenticazione WCA)
      if (!cookies.includes(".ASPXAUTH")) {
        console.log(`[auth] testCookies: nessun .ASPXAUTH nel cookie → invalidi`);
        return false;
      }
      console.log(`[auth] testCookies: OK (logout presente, ASPXAUTH presente)`);
      return true;
    }
    return resp.status >= 200 && resp.status < 400;
  } catch (e) {
    console.log(`[auth] testCookies error: ${e.message}`);
    return false;
  }
}

// SSO login - domain-aware cookie jar
function cookieJar() {
  const jar = {}; // domain → { name: "name=value" }
  return {
    add(domain, setCookieHeaders) {
      if (!jar[domain]) jar[domain] = {};
      for (const raw of setCookieHeaders) {
        const c = raw.split(";")[0];
        const eq = c.indexOf("=");
        if (eq > 0) jar[domain][c.substring(0, eq)] = c;
      }
    },
    get(domain) {
      if (!jar[domain]) return "";
      return Object.values(jar[domain]).join("; ");
    },
    getAll() {
      const all = {};
      for (const d of Object.keys(jar)) {
        for (const [k, v] of Object.entries(jar[d])) all[k] = v;
      }
      return Object.values(all).join("; ");
    },
    keys(domain) {
      if (!jar[domain]) return [];
      return Object.keys(jar[domain]);
    },
    dump() {
      const result = {};
      for (const d of Object.keys(jar)) result[d] = Object.keys(jar[d]);
      return result;
    }
  };
}

// Full SSO login with warmup and wcaToken extraction
// targetBase: opzionale — se fornito, fa SSO login su quel dominio (es. https://www.wcaprojects.com)
async function ssoLogin(username, password, targetBase) {
  // Use parameters or fall back to env vars / hardcoded defaults
  username = username || process.env.WCA_USERNAME || "tmsrlmin";
  password = password || process.env.WCA_PASSWORD || "G0u3v!VvCn";
  targetBase = targetBase || BASE; // default wcaworld.com

  // Estrai il dominio dal base URL (es. "wcaprojects.com" da "https://www.wcaprojects.com")
  const TARGET_DOMAIN = targetBase.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "");
  const SSO_DOMAIN = "sso.api.wcaworld.com";
  const jar = cookieJar();

  console.log(`[auth] SSO login target: ${TARGET_DOMAIN} (${targetBase})`);

  try {
    // Step 1: GET login page on TARGET domain → get base cookies + SSO URL
    let resp = await fetch(`${targetBase}/Account/Login`, { headers: { "User-Agent": UA }, redirect: "manual" });
    jar.add(TARGET_DOMAIN, resp.headers.raw()["set-cookie"] || []);
    let currentUrl = `${targetBase}/Account/Login`;
    let rc = 0;
    while (resp.status >= 300 && resp.status < 400 && rc < 5) {
      const loc = resp.headers.get("location") || "";
      currentUrl = loc.startsWith("http") ? loc : new URL(loc, currentUrl).href;
      // Manda cookies del dominio giusto
      const fetchDomain = currentUrl.includes("sso.api.wcaworld.com") ? SSO_DOMAIN : TARGET_DOMAIN;
      resp = await fetch(currentUrl, { headers: { "User-Agent": UA, "Cookie": jar.get(fetchDomain) }, redirect: "manual" });
      const setCookieDomain = currentUrl.includes("sso.api.wcaworld.com") ? SSO_DOMAIN : TARGET_DOMAIN;
      jar.add(setCookieDomain, resp.headers.raw()["set-cookie"] || []);
      rc++;
    }
    const loginHtml = resp.status === 200 ? await resp.text() : "";
    const cheerioLogin = require("cheerio");
    const $login = cheerioLogin.load(loginHtml);

    // Trova il form SSO — cerca action che punta a sso.api.wcaworld.com
    let ssoUrl = "";
    let hiddenFields = {};
    $login("form").each((_, form) => {
      const action = $login(form).attr("action") || "";
      if (action.includes("sso.api.wcaworld.com")) {
        ssoUrl = action.replace(/&amp;/g, "&");
        // Estrai TUTTI i campi nascosti del form (CSRF token, etc.)
        $login(form).find("input[type='hidden']").each((_, inp) => {
          const n = $login(inp).attr("name");
          const v = $login(inp).attr("value") || "";
          if (n) hiddenFields[n] = v;
        });
      }
    });

    // Fallback: regex se cheerio non trova il form
    if (!ssoUrl) {
      const ssoUrlMatch = loginHtml.match(/action\s*[:=]\s*['"]?(https:\/\/sso\.api\.wcaworld\.com[^'"&\s]+[^'"]*)/i);
      if (!ssoUrlMatch) {
        console.log(`[auth] SSO URL not found in login page of ${TARGET_DOMAIN}`);
        return { success: false, error: `SSO URL not found on ${TARGET_DOMAIN}` };
      }
      ssoUrl = ssoUrlMatch[1].replace(/&amp;/g, "&");
    }
    console.log(`[auth] SSO URL: ${ssoUrl.substring(0, 80)}... hiddenFields: ${Object.keys(hiddenFields).join(", ") || "none"}`);

    // Step 2: POST credentials + ALL hidden form fields to SSO endpoint
    const postBody = new URLSearchParams();
    // Include all hidden fields from the form (CSRF tokens, wa, wtrealm, etc.)
    for (const [k, v] of Object.entries(hiddenFields)) {
      postBody.set(k, v);
    }
    // Add credentials (override if they were in hidden fields)
    postBody.set("UserName", username);
    postBody.set("Password", password);
    postBody.set("pwd", password);

    console.log(`[auth] SSO POST fields: ${[...postBody.keys()].join(", ")}`);

    const ssoResp = await fetch(ssoUrl, {
      method: "POST",
      headers: {
        "User-Agent": UA,
        "Content-Type": "application/x-www-form-urlencoded",
        "Origin": "https://sso.api.wcaworld.com",
        "Referer": ssoUrl,
        "Cookie": jar.get(SSO_DOMAIN),
      },
      body: postBody.toString(),
      redirect: "manual",
    });
    jar.add(SSO_DOMAIN, ssoResp.headers.raw()["set-cookie"] || []);
    const hasAuth = jar.keys(SSO_DOMAIN).includes(".ASPXAUTH");
    console.log(`[auth] SSO POST status=${ssoResp.status} hasAuth=${hasAuth} ssoCookies=${jar.keys(SSO_DOMAIN).join(",")}`);

    // ═══ PROCESS WS-Fed POSTBACK ═══
    // SSO can return EITHER 200 (with WS-Fed form in body) OR 302 (redirect)
    // In BOTH cases the body might contain a WS-Fed auto-submit form
    // We MUST process it to get .ASPXAUTH on the TARGET domain
    const cheerio = require("cheerio");
    let postbackProcessed = false;

    async function processWsFedPostback(html, sourceUrl) {
      const $pb = cheerio.load(html);
      const postBackAction = $pb("form").attr("action") || "";
      if (!postBackAction) return false;
      // Must target the WCA ecosystem
      const isWcaDomain = postBackAction.includes("wcaworld.com") || postBackAction.includes(TARGET_DOMAIN) ||
        postBackAction.includes("wcaprojects.com") || postBackAction.includes("elitegln.com") ||
        postBackAction.includes("lognetglobal.com") || postBackAction.includes("allworldshipments.com");
      if (!isWcaDomain) return false;

      const pbParams = new URLSearchParams();
      $pb("input[type='hidden']").each((_, el) => {
        const n = $pb(el).attr("name");
        const v = $pb(el).attr("value") || "";
        if (n) pbParams.set(n, v);
      });
      const fieldKeys = [...pbParams.keys()];
      if (fieldKeys.length === 0) return false;

      console.log(`[auth] WS-Fed postback → ${postBackAction.substring(0, 80)} fields: ${fieldKeys.join(", ")}`);
      // Determine which domain the postback targets
      const pbTargetDomain = postBackAction.includes("sso.api.wcaworld.com") ? SSO_DOMAIN : TARGET_DOMAIN;
      const pbResp = await fetch(postBackAction, {
        method: "POST",
        headers: {
          "User-Agent": UA,
          "Content-Type": "application/x-www-form-urlencoded",
          "Cookie": jar.get(pbTargetDomain),
          "Referer": sourceUrl,
        },
        body: pbParams.toString(),
        redirect: "manual",
      });
      jar.add(pbTargetDomain, pbResp.headers.raw()["set-cookie"] || []);
      console.log(`[auth] WS-Fed postback status=${pbResp.status} targetHasAuth=${jar.keys(TARGET_DOMAIN).includes(".ASPXAUTH")} domain=${pbTargetDomain}`);

      // Follow remaining redirects after postback
      let pbLoc = pbResp.headers.get("location") || "";
      let pbCount = 0;
      while (pbLoc && pbCount < 5) {
        const pbNext = pbLoc.startsWith("http") ? pbLoc : new URL(pbLoc, postBackAction).href;
        const pbDomain = pbNext.includes("sso.api.wcaworld.com") ? SSO_DOMAIN : TARGET_DOMAIN;
        const pbFollowResp = await fetch(pbNext, {
          headers: { "User-Agent": UA, "Cookie": jar.get(pbDomain) },
          redirect: "manual",
        });
        jar.add(pbDomain, pbFollowResp.headers.raw()["set-cookie"] || []);
        pbLoc = pbFollowResp.headers.get("location") || "";
        pbCount++;

        // Check if any response in the chain contains ANOTHER WS-Fed form (multi-hop SSO)
        if (pbFollowResp.status === 200) {
          const pbHtml = await pbFollowResp.text();
          if (pbHtml.includes("wsignin") || pbHtml.includes("wresult")) {
            console.log(`[auth] Multi-hop WS-Fed detected at callback ${pbCount}`);
            await processWsFedPostback(pbHtml, pbNext);
          }
          break;
        }
      }
      return true;
    }

    // Try to extract WS-Fed form from SSO response body (works for both 200 and 302)
    if (ssoResp.status === 200 || ssoResp.status === 302) {
      try {
        const ssoBody = await ssoResp.text();
        if (ssoBody && ssoBody.length > 50) {
          console.log(`[auth] SSO response body len=${ssoBody.length} has_form=${ssoBody.includes("<form")} has_wresult=${ssoBody.includes("wresult")}`);
          postbackProcessed = await processWsFedPostback(ssoBody, ssoUrl);
        } else {
          console.log(`[auth] SSO response body empty/short len=${ssoBody.length}`);
        }
      } catch (bodyErr) {
        console.log(`[auth] SSO body read error: ${bodyErr.message}`);
      }
    }

    if (!hasAuth && !jar.keys(TARGET_DOMAIN).includes(".ASPXAUTH")) {
      console.log(`[auth] SSO login failed - no ASPXAUTH on ${TARGET_DOMAIN} or SSO`);
      return { success: false, error: `SSO login failed on ${TARGET_DOMAIN} - no auth cookie` };
    }

    // Step 3: Follow redirect chain back to TARGET domain (for 302 responses)
    let callbackUrl = ssoResp.headers.get("location") || "";
    if (callbackUrl) {
      console.log(`[auth] SSO redirect: ${callbackUrl.substring(0, 120)}`);
    }
    let followCount = 0;
    while (callbackUrl && followCount < 8) {
      const cbUrl = callbackUrl.startsWith("http") ? callbackUrl : new URL(callbackUrl, ssoUrl).href;
      const cbDomain = cbUrl.includes("sso.api.wcaworld.com") ? SSO_DOMAIN : TARGET_DOMAIN;
      const cbResp = await fetch(cbUrl, {
        headers: { "User-Agent": UA, "Cookie": jar.get(cbDomain) },
        redirect: "manual",
      });
      const newCookies = cbResp.headers.raw()["set-cookie"] || [];
      jar.add(cbDomain, newCookies);
      const gotAuth = newCookies.some(c => c.includes(".ASPXAUTH"));
      console.log(`[auth] Callback ${followCount + 1}: ${cbDomain} status=${cbResp.status} +${newCookies.length}cookies gotAuth=${gotAuth}`);

      // If callback returns 200 with HTML, check for WS-Fed form (multi-hop)
      if (cbResp.status === 200 && !postbackProcessed) {
        try {
          const cbHtml = await cbResp.text();
          if (cbHtml.includes("<form") && (cbHtml.includes("wresult") || cbHtml.includes("wsignin"))) {
            console.log(`[auth] WS-Fed form found in callback ${followCount + 1}`);
            postbackProcessed = await processWsFedPostback(cbHtml, cbUrl);
          }
        } catch (e) { /* ignore body read errors */ }
      }

      const nextLoc = cbResp.headers.get("location") || "";
      if (nextLoc) {
        callbackUrl = nextLoc.startsWith("http") ? nextLoc : new URL(nextLoc, cbUrl).href;
      } else {
        callbackUrl = null;
      }
      if (cbResp.status === 200) break;
      followCount++;
    }

    // Check if TARGET domain got its own .ASPXAUTH
    const targetHasAuth = jar.keys(TARGET_DOMAIN).includes(".ASPXAUTH");
    console.log(`[auth] After callbacks: ${TARGET_DOMAIN} hasAuth=${targetHasAuth} postbackProcessed=${postbackProcessed} cookies=${jar.keys(TARGET_DOMAIN).join(",")}`);

    // Step 4: Warmup — visit /Directory on TARGET domain
    let targetCookies = jar.get(TARGET_DOMAIN);
    let wcaToken = null;
    try {
      let wr = await fetch(`${targetBase}/Directory`, {
        headers: { "User-Agent": UA, "Cookie": targetCookies },
        redirect: "manual",
      });
      jar.add(TARGET_DOMAIN, wr.headers.raw()["set-cookie"] || []);
      let wLoc = wr.headers.get("location") || "";
      let wCount = 0;
      while (wLoc && wCount < 5) {
        const wNext = wLoc.startsWith("http") ? wLoc : new URL(wLoc, `${targetBase}/Directory`).href;
        // If redirect goes through SSO CheckLoggedIn, send SSO cookies
        const wDomain = wNext.includes("sso.api.wcaworld.com") ? SSO_DOMAIN : TARGET_DOMAIN;
        wr = await fetch(wNext, { headers: { "User-Agent": UA, "Cookie": jar.get(wDomain) }, redirect: "manual" });
        jar.add(wDomain, wr.headers.raw()["set-cookie"] || []);
        wLoc = wr.headers.get("location") || ""; wCount++;

        // Check for WS-Fed postback in warmup redirect chain
        if (wr.status === 200 && !jar.keys(TARGET_DOMAIN).includes(".ASPXAUTH")) {
          try {
            const wHtml2 = await wr.text();
            if (wHtml2.includes("<form") && (wHtml2.includes("wresult") || wHtml2.includes("wsignin"))) {
              console.log(`[auth] WS-Fed form found in warmup redirect`);
              await processWsFedPostback(wHtml2, wNext);
              // Re-fetch directory after postback
              wr = await fetch(`${targetBase}/Directory`, {
                headers: { "User-Agent": UA, "Cookie": jar.get(TARGET_DOMAIN) },
                redirect: "manual",
              });
              jar.add(TARGET_DOMAIN, wr.headers.raw()["set-cookie"] || []);
              wLoc = wr.headers.get("location") || "";
            }
          } catch (e) { /* ignore */ }
        }
      }
      targetCookies = jar.get(TARGET_DOMAIN);
      console.log(`[auth] Warmup ${TARGET_DOMAIN}/Directory status=${wr.status}`);

      // Extract wcaToken from HTML
      if (wr.status === 200) {
        const wHtml = await wr.text();
        const tokenMatch = wHtml.match(/window\.wca\.token\s*=\s*["']([^"']+)["']/);
        if (tokenMatch) wcaToken = tokenMatch[1];
        if (!wcaToken) {
          const tokenMatch2 = wHtml.match(/wca\.token\s*=\s*["']([^"']+)["']/);
          if (tokenMatch2) wcaToken = tokenMatch2[1];
        }
        const hasLogout = /logout|sign.?out/i.test(wHtml);
        const hasMembersOnly = /Members\s*Only/i.test(wHtml);
        console.log(`[auth] Warmup auth: hasLogout=${hasLogout} hasMembersOnly=${hasMembersOnly} hasToken=${!!wcaToken}`);

        // ═══ CRITICAL: if warmup shows NOT authenticated, login failed ═══
        if (!hasLogout) {
          console.log(`[auth] ⚠ WARNING: Warmup shows NOT authenticated despite SSO completing. targetHasAuth=${jar.keys(TARGET_DOMAIN).includes(".ASPXAUTH")}`);
        }
      }
    } catch (e) {
      console.log(`[auth] Warmup error: ${e.message}`);
    }

    const ssoCookies = jar.get(SSO_DOMAIN);
    console.log(`[auth] SSO login complete on ${TARGET_DOMAIN}: cookieLen=${targetCookies.length} hasAuth=${targetCookies.includes(".ASPXAUTH")} hasToken=${!!wcaToken} ssoCookieLen=${ssoCookies.length}`);
    console.log(`[auth] Cookie jar dump: ${JSON.stringify(jar.dump())}`);
    return { success: true, cookies: targetCookies, ssoCookies, wcaToken, domain: TARGET_DOMAIN, jarDump: jar.dump() };
  } catch (e) {
    console.log(`[auth] ssoLogin error: ${e.message}`);
    return { success: false, error: e.message };
  }
}

module.exports = {
  getCachedCookies,
  saveCookiesToCache,
  testCookies,
  ssoLogin,
  cookieJar,
  BASE,
  UA,
  SUPABASE_URL,
  SUPABASE_KEY,
};
