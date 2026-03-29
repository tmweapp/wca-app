/**
 * api/scrape.js — Endpoint scraping profilo singolo
 *
 * REFACTORED: usa utils/extract.js per estrazione profilo (era 404 righe inline).
 * Flusso:
 * 1. Ricevi wcaId + opzionale networkDomain
 * 2. SSO sul dominio target (network specifico o wcaworld.com)
 * 3. Fetch + parse profilo con extractProfile()
 * 4. Se wcaworld.com dà contatti vuoti → auto-retry sui network del membro
 */
const fetch = require("node-fetch");
const cheerio = require("cheerio");
const { BASE, UA, getCachedCookies, saveCookiesToCache, testCookies, ssoLogin } = require("./utils/auth");
const { extractProfile, NETWORK_DOMAINS, getNetworkBase, networkNameToDomains } = require("./utils/extract");

// ═══ FETCH URL con gestione redirect manuale ═══
// ssoCookies: cookies per sso.api.wcaworld.com (necessari per CheckLoggedIn redirect)
async function tryFetchUrl(url, cookies, refererBase, ssoCookies) {
  const baseForReferer = refererBase || BASE;
  let currentUrl = url;
  let redirectCount = 0;
  let resp;
  let activeSsoCookies = ssoCookies || "";

  while (redirectCount < 5) {
    // Usa cookies SSO quando il redirect va a sso.api.wcaworld.com
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
      // Aggiorna il set di cookies corretto (SSO vs network)
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

// ═══ FETCH + PARSE un singolo profilo ═══
async function fetchProfile(wcaId, cookies, profileHref, networkDomain, ssoCookies) {
  const networkBase = getNetworkBase(networkDomain);

  const primaryUrls = [];
  if (profileHref) {
    const fullHref = profileHref.startsWith("http") ? profileHref : networkBase + profileHref;
    primaryUrls.push(fullHref);
  }
  primaryUrls.push(`${networkBase}/directory/members/${wcaId}`);
  // Fallback su wcaworld.com se network specifico
  if (networkDomain && networkDomain !== "wcaworld.com") {
    primaryUrls.push(`${BASE}/directory/members/${wcaId}`);
  }

  for (const url of primaryUrls) {
    try {
      console.log(`[scrape] Try ${wcaId} ${url.substring(0, 80)}`);
      const result = await tryFetchUrl(url, cookies, networkBase, ssoCookies);
      if (!result) continue;
      if (result.loginRedirect) {
        return { wca_id: wcaId, state: "login_redirect", debug: { url, finalUrl: result.finalUrl } };
      }
      const { $, html } = result;
      console.log(`[scrape] OK ${wcaId} labels=${$(".profile_label").length} len=${html.length}`);
      const profile = extractProfile($, wcaId, networkBase);
      profile.source_network = networkDomain || "wcaworld.com";
      if (profile.state === "ok") { profile.source_url = url; return profile; }
    } catch (err) { console.log(`[scrape] Err ${url.substring(0, 50)}: ${err.message}`); }
  }

  const state = networkDomain ? "not_in_network" : "not_found";
  return { wca_id: wcaId, state, source_network: networkDomain || "wcaworld.com" };
}

// ═══ AUTH: ottieni cookies validi per un dominio ═══
async function getAuthCookies(domain) {
  const networkBase = getNetworkBase(domain);
  let cookies = null;
  let ssoCookies = "";

  // getCachedCookies ritorna { cookies, ssoCookies } oppure null
  const cached = await getCachedCookies(domain);
  if (cached) {
    cookies = cached.cookies;
    ssoCookies = cached.ssoCookies || "";
    const valid = await testCookies(cookies, networkBase);
    if (!valid) { cookies = null; ssoCookies = ""; }
  }

  if (!cookies) {
    console.log(`[scrape] SSO login su ${networkBase}...`);
    const loginResult = await ssoLogin(null, null, networkBase);
    if (!loginResult.success) return { error: loginResult.error };
    cookies = loginResult.cookies;
    ssoCookies = loginResult.ssoCookies || "";
    await saveCookiesToCache(cookies, domain, ssoCookies);
  }
  return { cookies, ssoCookies };
}

// ═══ SSO REFRESH: forza re-login quando il profilo risulta non autenticato ═══
async function forceSSORrefresh(domain) {
  const networkBase = getNetworkBase(domain);
  console.log(`[scrape] ⚠ SSO REFRESH forzato su ${networkBase}...`);
  const loginResult = await ssoLogin(null, null, networkBase);
  if (!loginResult.success) return { error: loginResult.error };
  const cookies = loginResult.cookies;
  const ssoCookies = loginResult.ssoCookies || "";
  await saveCookiesToCache(cookies, domain, ssoCookies);
  console.log(`[scrape] SSO REFRESH OK: hasASPXAUTH=${cookies.includes(".ASPXAUTH")} ssoCookieLen=${ssoCookies.length}`);
  return { cookies, ssoCookies };
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

    const isNetworkMode = networkDomain && networkDomain !== "wcaworld.com";
    const targetDomain = isNetworkMode ? networkDomain : "wcaworld.com";
    console.log(`[scrape] === START ${wcaIds[0]} mode=${isNetworkMode ? "NETWORK " + networkDomain : "wcaworld.com"}`);

    // Auth sul dominio target
    const auth = await getAuthCookies(targetDomain);
    if (auth.error) {
      console.log(`[scrape] Auth FAILED on ${targetDomain}: ${auth.error}`);
      return res.status(500).json({ success: false, error: auth.error });
    }
    let cookies = auth.cookies;
    let ssoCookies = auth.ssoCookies || "";
    console.log(`[scrape] Auth OK ${targetDomain}: cookieLen=${cookies.length} hasASPXAUTH=${cookies.includes(".ASPXAUTH")} ssoCookieLen=${ssoCookies.length}`);

    // ═══ SEMPRE avere anche cookies wcaworld.com come fallback ═══
    let wcaCookies = cookies;
    let wcaSsoCookies = ssoCookies;
    if (isNetworkMode) {
      const wcaAuth = await getAuthCookies("wcaworld.com");
      if (!wcaAuth.error) {
        wcaCookies = wcaAuth.cookies;
        wcaSsoCookies = wcaAuth.ssoCookies || "";
        console.log(`[scrape] WCA fallback auth OK: cookieLen=${wcaCookies.length} hasASPXAUTH=${wcaCookies.includes(".ASPXAUTH")}`);
      }
    }

    const batch = wcaIds.slice(0, 1); // 1 solo profilo per request
    const memberMap = {};
    if (members && Array.isArray(members)) {
      for (const m of members) { if (m.id && m.href) memberMap[m.id] = m.href; }
    }

    const results = [];
    for (const wcaId of batch) {
      // ═══ STRATEGIA MULTI-DOMINIO ═══
      // 1. Prima prova sul network specifico (se richiesto)
      // 2. Se fallisce o no contatti → prova su wcaworld.com con cookies WCA
      // 3. Se ancora no contatti → auto-retry su altri network

      let profile = null;
      let bestProfile = null;

      // Step 1: Network specifico
      if (isNetworkMode) {
        profile = await fetchProfile(wcaId, cookies, memberMap[wcaId], networkDomain, ssoCookies);
        console.log(`[scrape] ${wcaId} NETWORK ${networkDomain}: state=${profile.state} contacts=${profile.contacts?.length||0} email=${!!profile.email} phone=${!!profile.phone} limited=${profile.access_limited} membersOnly=${profile.members_only_count}`);

        if (profile.state === "ok" && profile.contacts?.length > 0 && profile.contacts.some(c => c.email)) {
          // Profilo OK con contatti — perfetto!
          console.log(`[scrape] ${wcaId} ✓ NETWORK ${networkDomain} ha contatti completi`);
          results.push(profile);
          continue;
        }
        // Salva come candidato parziale
        if (profile.state === "ok") bestProfile = profile;
      }

      // Step 2: wcaworld.com con cookies WCA propri
      const wcaProfile = await fetchProfile(wcaId, wcaCookies, memberMap[wcaId], null, wcaSsoCookies);
      console.log(`[scrape] ${wcaId} WCA: state=${wcaProfile.state} contacts=${wcaProfile.contacts?.length||0} email=${!!wcaProfile.email} phone=${!!wcaProfile.phone} limited=${wcaProfile.access_limited} membersOnly=${wcaProfile.members_only_count}`);

      if (wcaProfile.state === "ok" && wcaProfile.contacts?.length > 0 && wcaProfile.contacts.some(c => c.email)) {
        console.log(`[scrape] ${wcaId} ✓ WCA ha contatti completi`);
        // Merge network info dal profilo precedente
        if (bestProfile) {
          if (!wcaProfile.networks?.length && bestProfile.networks?.length) wcaProfile.networks = bestProfile.networks;
          if (!wcaProfile.logo_url && bestProfile.logo_url) wcaProfile.logo_url = bestProfile.logo_url;
        }
        wcaProfile.source_network = "wcaworld.com";
        results.push(wcaProfile);
        continue;
      }

      // Aggiorna bestProfile
      if (wcaProfile.state === "ok" && (!bestProfile || wcaProfile.contacts?.length > (bestProfile.contacts?.length || 0))) {
        bestProfile = wcaProfile;
      }

      // ═══ SSO REFRESH se entrambi hanno access_limited ═══
      const bothLimited = (profile?.access_limited || profile?.state === "login_redirect") &&
                          (wcaProfile.access_limited || wcaProfile.state === "login_redirect");
      if (bothLimited) {
        console.log(`[scrape] ${wcaId} ⚠ BOTH limited → SSO refresh wcaworld.com`);
        const refreshAuth = await forceSSORrefresh("wcaworld.com");
        if (!refreshAuth.error) {
          wcaCookies = refreshAuth.cookies;
          wcaSsoCookies = refreshAuth.ssoCookies || "";
          const retryWca = await fetchProfile(wcaId, wcaCookies, memberMap[wcaId], null, wcaSsoCookies);
          console.log(`[scrape] ${wcaId} SSO refresh WCA: state=${retryWca.state} contacts=${retryWca.contacts?.length||0} email=${!!retryWca.email}`);
          if (retryWca.state === "ok" && retryWca.contacts?.length > 0) {
            retryWca.sso_refreshed = true;
            results.push(retryWca);
            continue;
          }
          if (retryWca.state === "ok") bestProfile = retryWca;
        }
      }

      // ═══ AUTO-RETRY su ALTRI network ═══
      const networkSource = bestProfile || wcaProfile;
      const noContactEmails = !networkSource.contacts?.some(c => c.email);
      const needsRetry = networkSource.access_limited || ((!networkSource.contacts?.length) && networkSource.state === "ok") || (noContactEmails && networkSource.state === "ok");
      const networksToTry = networkSource.networks || profile?.networks || [];

      if (needsRetry && networksToTry.length > 0) {
        const domainsToTry = networkNameToDomains(networksToTry);
        // Escludi il dominio già provato
        const filteredDomains = domainsToTry.filter(d => d !== networkDomain && d !== "wcaworld.com");
        console.log(`[scrape] ${wcaId} Auto-retry: ${filteredDomains.length} domini: ${filteredDomains.join(", ")}`);

        for (const retryDomain of filteredDomains) {
          try {
            const retryAuth = await getAuthCookies(retryDomain);
            if (retryAuth.error) { console.log(`[scrape] Auto-retry SSO failed ${retryDomain}`); continue; }

            const retryProfile = await fetchProfile(wcaId, retryAuth.cookies, null, retryDomain, retryAuth.ssoCookies);
            console.log(`[scrape] ${wcaId} Auto-retry ${retryDomain}: contacts=${retryProfile.contacts?.length || 0} email=${!!retryProfile.email}`);

            if (retryProfile.contacts?.length > 0 && retryProfile.contacts.some(c => c.email)) {
              retryProfile.source_network = retryDomain;
              retryProfile.auto_retried = true;
              // Merge dati dal bestProfile
              if (bestProfile) {
                if (!retryProfile.logo_url && bestProfile.logo_url) retryProfile.logo_url = bestProfile.logo_url;
                if (!retryProfile.enrolled_offices?.length && bestProfile.enrolled_offices?.length) retryProfile.enrolled_offices = bestProfile.enrolled_offices;
                if (!retryProfile.networks?.length && bestProfile.networks?.length) retryProfile.networks = bestProfile.networks;
                if (!retryProfile.address && bestProfile.address) retryProfile.address = bestProfile.address;
              }
              bestProfile = retryProfile;
              console.log(`[scrape] ${wcaId} ✓ Auto-retry OK via ${retryDomain}: ${bestProfile.contacts?.length || 0} contacts`);
              break;
            }
          } catch (e) { console.log(`[scrape] Auto-retry error ${retryDomain}: ${e.message}`); }
        }
      }

      // Push il miglior profilo trovato
      results.push(bestProfile || wcaProfile || profile || { wca_id: wcaId, state: "not_found" });
    }

    console.log(`[scrape] === END ${wcaIds[0]} result: state=${results[0]?.state} contacts=${results[0]?.contacts?.length||0} email=${!!results[0]?.email} phone=${!!results[0]?.phone}`);
    return res.json({ success: true, results });
  } catch (err) {
    console.log(`[scrape] ERROR: ${err.message}`);
    return res.status(500).json({ success: false, error: err.message });
  }
};
