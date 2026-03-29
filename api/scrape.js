/**
 * api/scrape.js — Endpoint scraping profilo singolo
 *
 * STRATEGIA: Procedura dedicata per ogni network.
 * 1. Se il partner ha un networkDomain → login SSO su QUEL dominio → fetch da quel dominio
 * 2. Se il fetch dal network fallisce → fallback wcaworld.com
 * 3. Se nessun network specificato → procedura generale wcaworld.com
 *
 * Le procedure vengono eseguite in sequenza: prima il network specifico, poi il generale.
 */
const fetch = require("node-fetch");
const cheerio = require("cheerio");
const { BASE, UA, getCachedCookies, saveCookiesToCache, testCookies, ssoLogin } = require("./utils/auth");
const { extractProfile, NETWORK_DOMAINS, getNetworkBase, networkNameToDomains } = require("./utils/extract");

// ═══ CACHE AUTH IN-MEMORY (evita login multipli nello stesso batch) ═══
const authCache = {};
const AUTH_CACHE_TTL = 25 * 60 * 1000; // 25 min

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

// ═══ AUTH: ottieni cookies validi per un dominio (con in-memory cache) ═══
async function getAuthCookies(domain) {
  const key = domain || "wcaworld.com";

  // Check in-memory cache first
  if (authCache[key] && (Date.now() - authCache[key].ts) < AUTH_CACHE_TTL) {
    const cached = authCache[key];
    console.log(`[scrape] Auth in-memory cache HIT per ${key} (age=${Math.round((Date.now()-cached.ts)/1000)}s)`);
    return { cookies: cached.cookies, ssoCookies: cached.ssoCookies };
  }

  const networkBase = getNetworkBase(domain);
  let cookies = null;
  let ssoCookies = "";

  // Check Supabase cache
  const cached = await getCachedCookies(domain);
  if (cached) {
    cookies = cached.cookies;
    ssoCookies = cached.ssoCookies || "";
    const valid = await testCookies(cookies, networkBase);
    if (!valid) { cookies = null; ssoCookies = ""; }
  }

  if (!cookies) {
    console.log(`[scrape] SSO login su ${networkBase} (domain=${key})...`);
    const loginResult = await ssoLogin(null, null, networkBase);
    if (!loginResult.success) return { error: loginResult.error };
    cookies = loginResult.cookies;
    ssoCookies = loginResult.ssoCookies || "";
    await saveCookiesToCache(cookies, domain, ssoCookies);
  }

  // Save to in-memory cache
  authCache[key] = { cookies, ssoCookies, ts: Date.now() };
  return { cookies, ssoCookies };
}

// ═══ FETCH + PARSE profilo da UN dominio specifico ═══
async function fetchProfileFromDomain(wcaId, domain, cookies, ssoCookies) {
  const networkBase = getNetworkBase(domain);
  const url = `${networkBase}/directory/members/${wcaId}`;

  try {
    console.log(`[scrape] ${wcaId} → fetch da ${domain}: ${url}`);
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
    console.log(`[scrape] ${wcaId} → ${domain}: state=${profile.state} contacts=${profile.contacts?.length||0} email=${!!profile.email} hasLogout=${profile.hasLogout} membersOnly=${profile.members_only_count}`);
    return profile;
  } catch (err) {
    console.log(`[scrape] ${wcaId} → ${domain}: ERROR ${err.message}`);
    return null;
  }
}

// ═══ VERIFICA se un profilo ha dati validi (autenticato) ═══
function isProfileValid(profile) {
  if (!profile || profile.state !== "ok") return false;
  if (!profile.hasLogout) return false;
  // Ha almeno UN dato utile: email azienda, o contatto con email, o telefono
  const hasContactEmail = profile.contacts?.some(c => c.email);
  if (profile.email || hasContactEmail || profile.phone) return true;
  // Se ha contatti con solo nome/titolo ma nessun members_only → potrebbe essere ok (azienda senza email pubblica)
  if (profile.contacts?.length > 0 && profile.members_only_count === 0) return true;
  return false;
}

// ═══ PROCEDURA NETWORK-SPECIFICA ═══
// Login SSO sul dominio del network → fetch profilo da quel dominio
async function scrapeFromNetwork(wcaId, networkDomain) {
  console.log(`[scrape] ── PROCEDURA ${networkDomain} per ${wcaId} ──`);
  const auth = await getAuthCookies(networkDomain);
  if (auth.error) {
    console.log(`[scrape] ${wcaId} → ${networkDomain}: auth FAILED: ${auth.error}`);
    return null;
  }

  let profile = await fetchProfileFromDomain(wcaId, networkDomain, auth.cookies, auth.ssoCookies);

  // Se auth fallita (no logout), prova refresh SSO
  if (profile && profile.state === "ok" && !profile.hasLogout) {
    console.log(`[scrape] ${wcaId} → ${networkDomain}: no logout, SSO refresh...`);
    const networkBase = getNetworkBase(networkDomain);
    const refreshResult = await ssoLogin(null, null, networkBase);
    if (refreshResult.success) {
      const newCookies = refreshResult.cookies;
      const newSsoCookies = refreshResult.ssoCookies || "";
      await saveCookiesToCache(newCookies, networkDomain, newSsoCookies);
      authCache[networkDomain] = { cookies: newCookies, ssoCookies: newSsoCookies, ts: Date.now() };
      profile = await fetchProfileFromDomain(wcaId, networkDomain, newCookies, newSsoCookies);
    }
  }

  return profile;
}

// ═══ PROCEDURA GENERALE (wcaworld.com) ═══
async function scrapeFromWcaWorld(wcaId) {
  console.log(`[scrape] ── PROCEDURA GENERALE wcaworld.com per ${wcaId} ──`);
  const auth = await getAuthCookies("wcaworld.com");
  if (auth.error) {
    console.log(`[scrape] ${wcaId} → wcaworld.com: auth FAILED: ${auth.error}`);
    return { wca_id: wcaId, state: "auth_failed", error: auth.error };
  }

  let profile = await fetchProfileFromDomain(wcaId, "wcaworld.com", auth.cookies, auth.ssoCookies);

  // Se auth fallita, refresh
  if (profile && profile.state === "ok" && !profile.hasLogout) {
    console.log(`[scrape] ${wcaId} → wcaworld.com: no logout, SSO refresh...`);
    const refreshResult = await ssoLogin(null, null, BASE);
    if (refreshResult.success) {
      const newCookies = refreshResult.cookies;
      const newSsoCookies = refreshResult.ssoCookies || "";
      await saveCookiesToCache(newCookies, "wcaworld.com", newSsoCookies);
      authCache["wcaworld.com"] = { cookies: newCookies, ssoCookies: newSsoCookies, ts: Date.now() };
      profile = await fetchProfileFromDomain(wcaId, "wcaworld.com", newCookies, newSsoCookies);
    }
  }

  return profile || { wca_id: wcaId, state: "not_found" };
}

// ═══ HANDLER PRINCIPALE ═══
// Per ogni partner:
// 1. Se ha networkDomain → procedura dedicata per quel network
// 2. Se la procedura network fallisce O nessun network → procedura generale wcaworld.com
// 3. Usa il profilo migliore (quello con più dati)
module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  try {
    const { wcaIds, members, networkDomain } = req.body || {};
    if (!wcaIds || !Array.isArray(wcaIds) || wcaIds.length === 0) return res.status(400).json({ error: "wcaIds richiesto" });

    console.log(`[scrape] === START ${wcaIds[0]} (networkDomain: ${networkDomain || "nessuno"})`);

    const batch = wcaIds.slice(0, 1);
    const results = [];

    for (const wcaId of batch) {
      let bestProfile = null;

      // ── STEP 1: Procedura network-specifica (se fornito) ──
      if (networkDomain && networkDomain !== "wcaworld.com") {
        const networkProfile = await scrapeFromNetwork(wcaId, networkDomain);
        if (isProfileValid(networkProfile)) {
          bestProfile = networkProfile;
          bestProfile.procedure = `network:${networkDomain}`;
          console.log(`[scrape] ${wcaId} ✓ Profilo valido da ${networkDomain}`);
        } else {
          console.log(`[scrape] ${wcaId} ✗ ${networkDomain} non valido → fallback wcaworld.com`);
        }
      }

      // ── STEP 2: Procedura generale wcaworld.com (fallback o default) ──
      if (!bestProfile) {
        const wcaProfile = await scrapeFromWcaWorld(wcaId);
        if (wcaProfile && wcaProfile.state === "ok") {
          bestProfile = wcaProfile;
          bestProfile.procedure = "general:wcaworld.com";
          console.log(`[scrape] ${wcaId} ${isProfileValid(wcaProfile) ? "✓" : "~"} Profilo da wcaworld.com`);
        }
      }

      // ── Risultato finale ──
      if (!bestProfile) {
        bestProfile = { wca_id: wcaId, state: "not_found", contacts: [] };
      }
      if (networkDomain) bestProfile.source_network = networkDomain;

      console.log(`[scrape] === RESULT ${wcaId}: procedure=${bestProfile.procedure || "none"} state=${bestProfile.state} contacts=${bestProfile.contacts?.length||0} email=${!!bestProfile.email} phone=${!!bestProfile.phone} hasLogout=${bestProfile.hasLogout}`);
      results.push(bestProfile);
    }

    return res.json({ success: true, results });
  } catch (err) {
    console.log(`[scrape] ERROR: ${err.message}`);
    return res.status(500).json({ success: false, error: err.message });
  }
};
