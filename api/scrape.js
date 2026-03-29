/**
 * api/scrape.js — Endpoint scraping profilo singolo
 *
 * STRATEGIA v26:
 * 1. Login su wcaworld.com (credenziali) → ottieni cookie wcaworld + cookie SSO
 * 2. Per network specifici: usa cookie SSO per cross-domain SSO (NO credenziali)
 *    Il server SSO riconosce la sessione e fa il redirect automatico
 * 3. Fetch profilo dal dominio autenticato
 * 4. Fallback: se cross-domain fallisce, prova wcaworld.com direttamente
 */
const fetch = require("node-fetch");
const cheerio = require("cheerio");
const { BASE, UA, getCachedCookies, saveCookiesToCache, testCookies, ssoLogin, crossDomainSSO } = require("./utils/auth");
const { extractProfile, NETWORK_DOMAINS, getNetworkBase, networkNameToDomains } = require("./utils/extract");

// ═══ CACHE AUTH IN-MEMORY ═══
const authCache = {};
const AUTH_CACHE_TTL = 25 * 60 * 1000;

// ═══ FETCH URL con gestione redirect manuale ═══
async function tryFetchUrl(url, cookies, refererBase, ssoCookies) {
  const baseForReferer = refererBase || BASE;
  let currentUrl = url;
  let redirectCount = 0;
  let resp;
  let activeSsoCookies = ssoCookies || "";

  while (redirectCount < 5) {
    const isSSO = currentUrl.includes("sso.api.wcaworld.com");
    const cookiesToSend = isSSO ? activeSsoCookies : cookies;

    resp = await fetch(currentUrl, {
      headers: {
        "User-Agent": UA, "Cookie": cookiesToSend,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9,it;q=0.8",
        "Referer": baseForReferer + "/Directory",
      },
      redirect: "manual", timeout: 15000,
    });

    const newCookies = (resp.headers.raw?.()?.["set-cookie"] || []).map(c => c.split(";")[0]);
    if (newCookies.length) {
      const targetMap = {};
      const source = isSSO ? activeSsoCookies : cookies;
      for (const c of source.split("; ")) { const eq = c.indexOf("="); if (eq > 0) targetMap[c.substring(0, eq)] = c; }
      for (const c of newCookies) { const eq = c.indexOf("="); if (eq > 0) targetMap[c.substring(0, eq)] = c; }
      if (isSSO) activeSsoCookies = Object.values(targetMap).join("; ");
      else cookies = Object.values(targetMap).join("; ");
    }

    if (resp.status >= 300 && resp.status < 400) {
      const loc = resp.headers.get("location") || "";
      if (!loc) break;
      currentUrl = loc.startsWith("http") ? loc : new URL(loc, currentUrl).href;
      if (currentUrl.toLowerCase().includes("/login") || currentUrl.toLowerCase().includes("/signin")) {
        return { loginRedirect: true, status: resp.status, finalUrl: currentUrl };
      }
      redirectCount++;
      continue;
    }
    break;
  }

  if (resp.status === 404) return null;
  const html = await resp.text();
  console.log(`[scrape] Fetched ${currentUrl.substring(0, 60)} status=${resp.status} len=${html.length}`);

  if (html.includes('type="password"') || currentUrl.toLowerCase().includes("/login")) {
    return { loginRedirect: true, status: resp.status, finalUrl: currentUrl };
  }
  const $ = cheerio.load(html);
  const h1 = $("h1").first().text().trim();
  if (/member\s*not\s*found|not\s*found.*try\s*again|page\s*not\s*found/i.test(h1)) return null;

  return { $, html, resp, h1 };
}

// ═══ Ottieni auth wcaworld.com (base per tutto) ═══
async function getWcaAuth() {
  const key = "wcaworld.com";
  if (authCache[key] && (Date.now() - authCache[key].ts) < AUTH_CACHE_TTL) {
    console.log(`[scrape] WCA auth cache HIT`);
    return authCache[key];
  }

  // Check Supabase cache
  const cached = await getCachedCookies("wcaworld.com");
  if (cached) {
    const valid = await testCookies(cached.cookies, BASE);
    if (valid) {
      console.log(`[scrape] WCA auth from Supabase cache OK`);
      authCache[key] = { cookies: cached.cookies, ssoCookies: cached.ssoCookies || "", ts: Date.now() };
      return authCache[key];
    }
  }

  // Fresh login
  console.log(`[scrape] WCA fresh SSO login...`);
  const loginResult = await ssoLogin(null, null, BASE);
  if (!loginResult.success) return { error: loginResult.error };

  const auth = { cookies: loginResult.cookies, ssoCookies: loginResult.ssoCookies || "", ts: Date.now() };
  authCache[key] = auth;
  await saveCookiesToCache(loginResult.cookies, "wcaworld.com", loginResult.ssoCookies);
  console.log(`[scrape] WCA login OK: hasASPXAUTH=${loginResult.cookies.includes(".ASPXAUTH")} ssoCookieLen=${auth.ssoCookies.length}`);
  return auth;
}

// ═══ Ottieni auth per un network specifico (cross-domain SSO) ═══
async function getNetworkAuth(networkDomain, wcaSsoCookies) {
  const key = networkDomain;
  if (authCache[key] && (Date.now() - authCache[key].ts) < AUTH_CACHE_TTL) {
    console.log(`[scrape] Network auth cache HIT: ${key}`);
    return authCache[key];
  }

  // Check Supabase cache
  const cached = await getCachedCookies(networkDomain);
  if (cached) {
    const networkBase = getNetworkBase(networkDomain);
    const valid = await testCookies(cached.cookies, networkBase);
    if (valid) {
      console.log(`[scrape] Network auth from Supabase cache: ${key}`);
      authCache[key] = { cookies: cached.cookies, ssoCookies: cached.ssoCookies || wcaSsoCookies, ts: Date.now() };
      return authCache[key];
    }
  }

  // Cross-domain SSO usando i cookie SSO di wcaworld.com
  const networkBase = getNetworkBase(networkDomain);
  console.log(`[scrape] CrossDomain SSO → ${networkDomain} usando cookie SSO wcaworld.com`);
  const result = await crossDomainSSO(networkBase, wcaSsoCookies);

  if (!result.success) {
    console.log(`[scrape] CrossDomain SSO FAILED per ${networkDomain}: ${result.error}`);
    // Fallback: prova login diretto con credenziali
    console.log(`[scrape] Fallback: login diretto su ${networkDomain}...`);
    const directLogin = await ssoLogin(null, null, networkBase);
    if (!directLogin.success) return { error: `CrossDomain e login diretto falliti: ${result.error}` };
    const auth = { cookies: directLogin.cookies, ssoCookies: directLogin.ssoCookies || wcaSsoCookies, ts: Date.now() };
    authCache[key] = auth;
    await saveCookiesToCache(directLogin.cookies, networkDomain, directLogin.ssoCookies);
    return auth;
  }

  const auth = { cookies: result.cookies, ssoCookies: result.ssoCookies || wcaSsoCookies, ts: Date.now() };
  authCache[key] = auth;
  await saveCookiesToCache(result.cookies, networkDomain, result.ssoCookies);
  console.log(`[scrape] Network auth OK: ${networkDomain} hasASPXAUTH=${result.cookies.includes(".ASPXAUTH")}`);
  return auth;
}

// ═══ FETCH + PARSE profilo da UN dominio specifico ═══
async function fetchProfileFromDomain(wcaId, domain, cookies, ssoCookies) {
  const networkBase = getNetworkBase(domain);
  const url = `${networkBase}/directory/members/${wcaId}`;

  try {
    console.log(`[scrape] ${wcaId} → fetch da ${domain}: ${url.substring(0, 70)}`);
    const result = await tryFetchUrl(url, cookies, networkBase, ssoCookies);
    if (!result) return null;
    if (result.loginRedirect) {
      console.log(`[scrape] ${wcaId} → ${domain}: login redirect`);
      return null;
    }
    const { $, html } = result;
    const profile = extractProfile($, wcaId, networkBase);
    profile.source_network = domain;
    profile.source_url = url;
    console.log(`[scrape] ${wcaId} → ${domain}: state=${profile.state} contacts=${profile.contacts?.length||0} email=${!!profile.email} phone=${!!profile.phone} hasLogout=${profile.hasLogout} membersOnly=${profile.members_only_count}`);
    return profile;
  } catch (err) {
    console.log(`[scrape] ${wcaId} → ${domain}: ERROR ${err.message}`);
    return null;
  }
}

// ═══ VERIFICA se un profilo ha dati validi ═══
function isProfileValid(profile) {
  if (!profile || profile.state !== "ok") return false;
  if (!profile.hasLogout) return false;
  const hasContactEmail = profile.contacts?.some(c => c.email);
  if (profile.email || hasContactEmail || profile.phone) return true;
  if (profile.contacts?.length > 0 && profile.members_only_count === 0) return true;
  return false;
}

// ═══ HANDLER PRINCIPALE ═══
module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  try {
    const { wcaIds, members, networkDomain } = req.body || {};
    if (!wcaIds || !Array.isArray(wcaIds) || wcaIds.length === 0) return res.status(400).json({ error: "wcaIds richiesto" });

    const wcaId = wcaIds[0];
    console.log(`[scrape] === START ${wcaId} (networkDomain: ${networkDomain || "nessuno"})`);

    // ── STEP 0: Login wcaworld.com (base per tutto) ──
    const wcaAuth = await getWcaAuth();
    if (wcaAuth.error) {
      console.log(`[scrape] WCA auth FAILED: ${wcaAuth.error}`);
      return res.status(500).json({ success: false, error: wcaAuth.error });
    }

    let bestProfile = null;

    // ── STEP 1: Se network specifico → cross-domain SSO + fetch ──
    if (networkDomain && networkDomain !== "wcaworld.com") {
      const netAuth = await getNetworkAuth(networkDomain, wcaAuth.ssoCookies);
      if (!netAuth.error) {
        const profile = await fetchProfileFromDomain(wcaId, networkDomain, netAuth.cookies, netAuth.ssoCookies);
        if (isProfileValid(profile)) {
          bestProfile = profile;
          bestProfile.procedure = `network:${networkDomain}`;
          console.log(`[scrape] ${wcaId} ✓ Profilo valido da ${networkDomain}`);
        } else {
          console.log(`[scrape] ${wcaId} ✗ ${networkDomain} non valido → fallback wcaworld.com`);
        }
      } else {
        console.log(`[scrape] ${wcaId} ✗ Auth ${networkDomain} fallita: ${netAuth.error}`);
      }
    }

    // ── STEP 2: Fallback wcaworld.com ──
    if (!bestProfile) {
      const profile = await fetchProfileFromDomain(wcaId, "wcaworld.com", wcaAuth.cookies, wcaAuth.ssoCookies);
      if (profile && profile.state === "ok") {
        bestProfile = profile;
        bestProfile.procedure = "general:wcaworld.com";

        // Se hasLogout=false → refresh SSO e riprova
        if (!profile.hasLogout) {
          console.log(`[scrape] ${wcaId} wcaworld.com hasLogout=false → SSO refresh`);
          const freshLogin = await ssoLogin(null, null, BASE);
          if (freshLogin.success) {
            authCache["wcaworld.com"] = { cookies: freshLogin.cookies, ssoCookies: freshLogin.ssoCookies || "", ts: Date.now() };
            await saveCookiesToCache(freshLogin.cookies, "wcaworld.com", freshLogin.ssoCookies);
            const retryProfile = await fetchProfileFromDomain(wcaId, "wcaworld.com", freshLogin.cookies, freshLogin.ssoCookies);
            if (retryProfile && retryProfile.state === "ok") {
              bestProfile = retryProfile;
              bestProfile.procedure = "general:wcaworld.com(refreshed)";
              console.log(`[scrape] ${wcaId} RETRY wcaworld.com: hasLogout=${retryProfile.hasLogout} contacts=${retryProfile.contacts?.length||0}`);
            }
          }
        }
      }
    }

    if (!bestProfile) {
      bestProfile = { wca_id: wcaId, state: "not_found", contacts: [] };
    }
    if (networkDomain) bestProfile.source_network = networkDomain;

    console.log(`[scrape] === RESULT ${wcaId}: procedure=${bestProfile.procedure || "none"} state=${bestProfile.state} contacts=${bestProfile.contacts?.length||0} email=${!!bestProfile.email} phone=${!!bestProfile.phone} hasLogout=${bestProfile.hasLogout}`);
    return res.json({ success: true, results: [bestProfile] });
  } catch (err) {
    console.log(`[scrape] ERROR: ${err.message}`);
    return res.status(500).json({ success: false, error: err.message });
  }
};
