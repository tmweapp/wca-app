const fetch = require("node-fetch");

const BASE = "https://www.wcaworld.com";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const SUPABASE_URL = process.env.SUPABASE_URL || "https://dlldkrzoxvjxpgkkttxu.supabase.co";
const SUPABASE_KEY = (process.env.SUPABASE_SERVICE_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRsbGRrcnpveHZqeHBna2t0dHh1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1ODcyMDU4NCwiZXhwIjoyMDc0Mjk2NTg0fQ.py_d96kA6Mqvi0ugBm4gmIlJSoOC_KbwUM7cgDR-O_E").trim();

// Cache sessione SSO in Supabase — evita login ripetuti
async function getCachedCookies() {
  try {
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/wca_session?select=*&id=eq.1`, {
      headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}` },
      timeout: 5000,
    });
    if (!resp.ok) return null;
    const rows = await resp.json();
    if (!rows || rows.length === 0) return null;
    const row = rows[0];
    // Cookie validi per max 10 minuti
    const age = Date.now() - new Date(row.updated_at).getTime();
    if (age > 10 * 60 * 1000) { console.log("[auth] Cached cookies scaduti (>10min)"); return null; }
    console.log(`[auth] Usando cookies cached (età: ${Math.round(age/1000)}s)`);
    return row.cookies;
  } catch (e) { console.log("[auth] Cache read error: " + e.message); return null; }
}

async function saveCookiesToCache(cookies) {
  try {
    await fetch(`${SUPABASE_URL}/rest/v1/wca_session`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json", "apikey": SUPABASE_KEY,
        "Authorization": `Bearer ${SUPABASE_KEY}`, "Prefer": "resolution=merge-duplicates",
      },
      body: JSON.stringify({ id: 1, cookies, updated_at: new Date().toISOString() }),
      timeout: 5000,
    });
    console.log("[auth] Cookies salvati in cache");
  } catch (e) { console.log("[auth] Cache save error: " + e.message); }
}

// Test rapido: i cookies funzionano? Fai un GET su /Directory
async function testCookies(cookies) {
  try {
    const resp = await fetch(`${BASE}/Directory`, {
      headers: { "User-Agent": UA, "Cookie": cookies },
      redirect: "manual", timeout: 8000,
    });
    // Se redirect al login → cookies non validi
    const loc = resp.headers.get("location") || "";
    if (loc.toLowerCase().includes("/login") || loc.toLowerCase().includes("/signin")) return false;
    if (resp.status === 200) {
      const html = await resp.text();
      return !html.includes('type="password"') && /logout|sign.?out/i.test(html);
    }
    return resp.status >= 200 && resp.status < 400;
  } catch (e) { return false; }
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
async function ssoLogin(username, password) {
  // Use parameters or fall back to env vars / hardcoded defaults
  username = username || process.env.WCA_USERNAME || "tmsrlmin";
  password = password || process.env.WCA_PASSWORD || "G0u3v!VvCn";

  const WCA_DOMAIN = "wcaworld.com";
  const SSO_DOMAIN = "sso.api.wcaworld.com";
  const jar = cookieJar();

  try {
    // Step 1: GET login page → follow redirects to SSO page (domain-aware cookies)
    let resp = await fetch(`${BASE}/Account/Login`, { headers: { "User-Agent": UA }, redirect: "manual" });
    jar.add(WCA_DOMAIN, resp.headers.raw()["set-cookie"] || []);
    let currentUrl = `${BASE}/Account/Login`;
    let rc = 0;
    while (resp.status >= 300 && resp.status < 400 && rc < 5) {
      const loc = resp.headers.get("location") || "";
      currentUrl = loc.startsWith("http") ? loc : new URL(loc, currentUrl).href;
      // Send domain-appropriate cookies
      const reqDomain = currentUrl.includes("sso.api.wcaworld.com") ? SSO_DOMAIN : WCA_DOMAIN;
      resp = await fetch(currentUrl, { headers: { "User-Agent": UA, "Cookie": jar.get(reqDomain) }, redirect: "manual" });
      // Add cookies to the correct domain
      jar.add(reqDomain, resp.headers.raw()["set-cookie"] || []);
      rc++;
    }
    const loginHtml = resp.status === 200 ? await resp.text() : "";
    const ssoUrlMatch = loginHtml.match(/action\s*[:=]\s*['"]?(https:\/\/sso\.api\.wcaworld\.com[^'"&\s]+[^'"]*)/i);
    if (!ssoUrlMatch) {
      console.log("[auth] SSO URL not found in login page");
      return { success: false, error: "SSO URL not found in login page" };
    }
    const ssoUrl = ssoUrlMatch[1].replace(/&amp;/g, "&");
    console.log(`[auth] SSO URL: ${ssoUrl.substring(0, 80)}...`);

    // Step 1b: Extract ALL hidden form fields from SSO login page
    const cheerio = require("cheerio");
    const $login = cheerio.load(loginHtml);
    const formFields = {};
    $login("input[type='hidden']").each((_, el) => {
      const name = $login(el).attr("name");
      const val = $login(el).attr("value") || "";
      if (name) formFields[name] = val;
    });
    console.log(`[auth] SSO form hidden fields: ${Object.keys(formFields).join(", ") || "none"}`);

    // Build POST body with ALL form fields + credentials
    const postParams = new URLSearchParams();
    for (const [k, v] of Object.entries(formFields)) {
      postParams.set(k, v);
    }
    postParams.set("UserName", username);
    postParams.set("Password", password);
    postParams.set("pwd", password);

    // Step 2: POST credentials to SSO endpoint with all form fields
    const ssoResp = await fetch(ssoUrl, {
      method: "POST",
      headers: {
        "User-Agent": UA,
        "Content-Type": "application/x-www-form-urlencoded",
        "Origin": "https://sso.api.wcaworld.com",
        "Referer": currentUrl,
        "Cookie": jar.get(SSO_DOMAIN),
      },
      body: postParams.toString(),
      redirect: "manual",
    });
    jar.add(SSO_DOMAIN, ssoResp.headers.raw()["set-cookie"] || []);
    const hasAuth = jar.keys(SSO_DOMAIN).includes(".ASPXAUTH");
    console.log(`[auth] SSO POST status=${ssoResp.status} hasAuth=${hasAuth} ssoCookies=${jar.keys(SSO_DOMAIN).join(",")}`);
    if (!hasAuth || ssoResp.status < 300 || ssoResp.status >= 400) {
      // If no redirect, check if the response itself contains a form post-back (common in SAML/WS-Fed)
      const postBackHtml = ssoResp.status === 200 ? await ssoResp.text() : "";
      const $pb = cheerio.load(postBackHtml);
      const postBackAction = $pb("form").attr("action") || "";
      if (postBackAction && postBackAction.includes("wcaworld.com")) {
        // WS-Federation: SSO returns a form with SAMLResponse/wresult that auto-posts back to WCA
        console.log(`[auth] WS-Fed postback detected → ${postBackAction.substring(0, 80)}`);
        const pbFields = {};
        $pb("input[type='hidden']").each((_, el) => {
          const n = $pb(el).attr("name");
          const v = $pb(el).attr("value") || "";
          if (n) pbFields[n] = v;
        });
        console.log(`[auth] Postback fields: ${Object.keys(pbFields).join(", ")}`);
        const pbParams = new URLSearchParams();
        for (const [k, v] of Object.entries(pbFields)) pbParams.set(k, v);
        const pbResp = await fetch(postBackAction, {
          method: "POST",
          headers: {
            "User-Agent": UA,
            "Content-Type": "application/x-www-form-urlencoded",
            "Cookie": jar.get(WCA_DOMAIN),
            "Referer": ssoUrl,
          },
          body: pbParams.toString(),
          redirect: "manual",
        });
        jar.add(WCA_DOMAIN, pbResp.headers.raw()["set-cookie"] || []);
        console.log(`[auth] WS-Fed postback status=${pbResp.status} wcaCookies=${jar.keys(WCA_DOMAIN).join(",")}`);
        // Follow any remaining redirects
        let pbLoc = pbResp.headers.get("location") || "";
        let pbCount = 0;
        while (pbLoc && pbCount < 5) {
          const pbNext = pbLoc.startsWith("http") ? pbLoc : new URL(pbLoc, postBackAction).href;
          const pbDomain = pbNext.includes("sso.api.wcaworld.com") ? SSO_DOMAIN : WCA_DOMAIN;
          const pbFollowResp = await fetch(pbNext, {
            headers: { "User-Agent": UA, "Cookie": jar.get(pbDomain) },
            redirect: "manual",
          });
          jar.add(pbDomain, pbFollowResp.headers.raw()["set-cookie"] || []);
          pbLoc = pbFollowResp.headers.get("location") || "";
          pbCount++;
          if (pbFollowResp.status === 200) break;
        }
      } else if (!hasAuth) {
        console.log("[auth] SSO login failed - no ASPXAUTH and no postback");
        return { success: false, error: "SSO login failed - no auth cookie" };
      }
    }

    // Step 3: Follow redirect chain back to WCA
    // CRITICAL: send only WCA-domain cookies to wcaworld.com URLs, NOT sso cookies
    let callbackUrl = ssoResp.headers.get("location") || "";
    console.log(`[auth] SSO redirect: ${callbackUrl.substring(0, 120)}`);
    let followCount = 0;
    while (callbackUrl && followCount < 8) {
      const cbUrl = callbackUrl.startsWith("http") ? callbackUrl : new URL(callbackUrl, ssoUrl).href;
      const cbDomain = cbUrl.includes("sso.api.wcaworld.com") ? SSO_DOMAIN : WCA_DOMAIN;
      const cbResp = await fetch(cbUrl, {
        headers: { "User-Agent": UA, "Cookie": jar.get(cbDomain) },
        redirect: "manual",
      });
      const newCookies = cbResp.headers.raw()["set-cookie"] || [];
      jar.add(cbDomain, newCookies);
      const gotAuth = newCookies.some(c => c.includes(".ASPXAUTH"));
      console.log(`[auth] Callback ${followCount + 1}: ${cbDomain} status=${cbResp.status} +${newCookies.length}cookies gotAuth=${gotAuth}`);
      const nextLoc = cbResp.headers.get("location") || "";
      if (nextLoc) {
        callbackUrl = nextLoc.startsWith("http") ? nextLoc : new URL(nextLoc, cbUrl).href;
      } else {
        callbackUrl = null;
      }
      if (cbResp.status === 200) break;
      followCount++;
    }

    // Check if WCA domain got its own .ASPXAUTH
    const wcaHasAuth = jar.keys(WCA_DOMAIN).includes(".ASPXAUTH");
    console.log(`[auth] After callbacks: WCA hasAuth=${wcaHasAuth} cookies=${jar.keys(WCA_DOMAIN).join(",")}`);

    // Step 4: Warmup — visit /Directory with WCA cookies only
    let wcaCookies = jar.get(WCA_DOMAIN);
    let wcaToken = null;
    try {
      let wr = await fetch(`${BASE}/Directory`, {
        headers: { "User-Agent": UA, "Cookie": wcaCookies },
        redirect: "manual",
      });
      jar.add(WCA_DOMAIN, wr.headers.raw()["set-cookie"] || []);
      let wLoc = wr.headers.get("location") || "";
      let wCount = 0;
      while (wLoc && wCount < 3) {
        const wNext = wLoc.startsWith("http") ? wLoc : new URL(wLoc, `${BASE}/Directory`).href;
        wr = await fetch(wNext, { headers: { "User-Agent": UA, "Cookie": jar.get(WCA_DOMAIN) }, redirect: "manual" });
        jar.add(WCA_DOMAIN, wr.headers.raw()["set-cookie"] || []);
        wLoc = wr.headers.get("location") || ""; wCount++;
      }
      wcaCookies = jar.get(WCA_DOMAIN);
      console.log(`[auth] Warmup /Directory status=${wr.status}`);

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
      }
    } catch (e) {
      console.log(`[auth] Warmup error: ${e.message}`);
    }

    console.log(`[auth] SSO login complete: cookieLen=${wcaCookies.length} hasAuth=${wcaCookies.includes(".ASPXAUTH")} hasToken=${!!wcaToken}`);
    return { success: true, cookies: wcaCookies, wcaToken };
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
