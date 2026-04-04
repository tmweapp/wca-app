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
const { BASE, UA, getCachedCookies, saveCookiesToCache, testCookies, ssoLogin, SUPABASE_URL, SUPABASE_KEY } = require("./utils/auth");
const { extractProfile, NETWORK_DOMAINS, getNetworkBase, networkNameToDomains } = require("./utils/extract");

// ── Log evento su Supabase (fire-and-forget) ──
function logEvent(type, msg, wcaId) {
  const body = JSON.stringify({ type, msg, wca_id: wcaId || null, ts: new Date().toISOString() });
  fetch(`${SUPABASE_URL}/rest/v1/wca_events`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}` },
    body, timeout: 3000,
  }).catch(() => {});
}

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
  const isMainDomain = !domain || domain === "wcaworld.com";
  const networkBase = getNetworkBase(domain);
  let cookies = null;
  let ssoCookies = "";

  // getCachedCookies ritorna { cookies, ssoCookies } oppure null
  // NON ri-testare i cookies cached: getCachedCookies applica già il TTL di 2h.
  // testCookies aggiunge una richiesta extra a WCA che può fallire per mille motivi
  // (timeout, pagina diversa, nessun logout link) scartando cookies perfettamente validi.
  // Il soft-expiry detector in scrape.js gestisce il caso di sessione scaduta lato WCA.
  const cached = await getCachedCookies(domain);
  if (cached) {
    cookies = cached.cookies;
    ssoCookies = cached.ssoCookies || "";
    console.log(`[scrape] ✓ Cookies cached trovati (len=${cookies.length}, hasASPX=${cookies.includes(".ASPXAUTH")})`);
  }

  if (!cookies) {
    // ⚠ Per wcaworld.com NON usare tmsrlmin come fallback:
    // tmsrlmin ha accesso limitato e non vede i contatti dei membri.
    // L'utente DEVE fare login manuale per avere la sessione con accesso pieno.
    if (isMainDomain) {
      console.log("[scrape] ⛔ Nessuna sessione in cache per wcaworld.com — richiesto login utente");
      return { error: "session_expired_please_login" };
    }
    // Per i network specifici: SSO anonimo è accettabile
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
    console.log(`[scrape] Mode: ${isNetworkMode ? "NETWORK " + networkDomain : "wcaworld.com"}`);

    // Auth sul dominio target
    const auth = await getAuthCookies(targetDomain);
    if (auth.error) return res.status(200).json({ success: false, error: auth.error });
    let cookies = auth.cookies;
    let ssoCookies = auth.ssoCookies || "";

    const batch = wcaIds.slice(0, 1); // 1 solo profilo per request
    const memberMap = {};
    if (members && Array.isArray(members)) {
      for (const m of members) { if (m.id && m.href) memberMap[m.id] = m.href; }
    }

    const results = [];
    for (const wcaId of batch) {
      let profile = await fetchProfile(wcaId, cookies, memberMap[wcaId], networkDomain, ssoCookies);

      // ═══ SSO REFRESH: se il profilo mostra segni di auth fallita, forza re-login ═══
      // Segnali: login_redirect (redirect esplicito) OPPURE soft expiry (WCA risponde 200
      // ma nasconde i dati con "Members only" — sessione accettata ma non autenticata)
      const softExpiry = profile.state === "ok"
        && profile.members_only_count > 0
        && (!profile.contacts || profile.contacts.length === 0);
      const authFailed = profile.state === "login_redirect" || softExpiry;
      if (softExpiry) {
        console.log(`[scrape] ⚠ SOFT EXPIRY per ${wcaId}: members_only=${profile.members_only_count} contacts=${profile.contacts?.length||0} → SSO refresh`);
        logEvent("soft_expiry", `Soft expiry rilevato: members_only=${profile.members_only_count}`, wcaId);
      }

      if (authFailed && profile.state !== "not_found") {
        console.log(`[scrape] ⚠ Auth fallita per ${wcaId}: state=${profile.state} membersOnly=${profile.members_only_count} → SSO refresh`);
        logEvent("sso_refresh_start", `SSO refresh avviato: state=${profile.state}`, wcaId);
        const refreshAuth = await forceSSORrefresh(targetDomain);
        if (!refreshAuth.error) {
          cookies = refreshAuth.cookies;
          ssoCookies = refreshAuth.ssoCookies || "";
          const retryProfile = await fetchProfile(wcaId, cookies, memberMap[wcaId], networkDomain, ssoCookies);
          if (retryProfile.state === "ok") {
            // Verifica che dopo il refresh i dati siano reali (non soft expiry di nuovo)
            const stillExpired = retryProfile.members_only_count > 0 && (!retryProfile.contacts || retryProfile.contacts.length === 0);
            if (stillExpired) {
              console.log(`[scrape] ❌ SSO refresh FALLITO per ${wcaId}: ancora soft expiry dopo refresh → skip`);
              return res.json({ success: true, results: [{ wca_id: wcaId, state: "session_expired", members_only_count: retryProfile.members_only_count }] });
            }
            console.log(`[scrape] ✅ SSO refresh OK per ${wcaId}: contacts=${retryProfile.contacts?.length || 0}`);
            logEvent("sso_refresh_ok", `SSO refresh OK: contacts=${retryProfile.contacts?.length||0}`, wcaId);
            profile = retryProfile;
            profile.sso_refreshed = true;
          } else if (retryProfile.state !== "not_found") {
            // Retry ha restituito uno stato non-ok diverso da not_found → skip profilo, non salvare l'originale vuoto
            console.log(`[scrape] ❌ Retry post-refresh: state=${retryProfile.state} → skip`);
            return res.json({ success: true, results: [{ wca_id: wcaId, state: "session_expired" }] });
          }
        } else {
          console.log(`[scrape] ❌ SSO refresh error per ${wcaId}: ${refreshAuth.error} → skip profilo`);
          return res.json({ success: true, results: [{ wca_id: wcaId, state: "session_expired", members_only_count: profile.members_only_count }] });
        }
      }

      // ═══ AUTO-RETRY su network se wcaworld.com dà contatti personali vuoti ═══
      // Scatta quando NON ci sono contatti personali (nome+email+telefono)
      // Anche se c'è l'email/telefono aziendale — quelli li abbiamo già, servono i CONTATTI
      const noContacts = !profile.contacts || profile.contacts.length === 0;
      const noContactEmails = !profile.contacts?.some(c => c.email);
      const needsRetry = (noContacts && profile.state === "ok") || (noContactEmails && profile.state === "ok");
      const wasGeneric = !isNetworkMode;

      if (needsRetry && wasGeneric && profile.networks && profile.networks.length > 0) {
        console.log(`[scrape] Auto-retry: ${wcaId} contacts=${profile.contacts?.length||0} contactEmails=${noContactEmails} limited=${profile.access_limited} networks: ${profile.networks.join(", ")}`);
        const domainsToTry = networkNameToDomains(profile.networks);
        console.log(`[scrape] Auto-retry domini: ${domainsToTry.join(", ") || "nessuno"}`);

        for (const retryDomain of domainsToTry) {
          try {
            const retryAuth = await getAuthCookies(retryDomain);
            if (retryAuth.error) { console.log(`[scrape] Auto-retry SSO failed on ${retryDomain}`); continue; }

            const retryProfile = await fetchProfile(wcaId, retryAuth.cookies, null, retryDomain, retryAuth.ssoCookies);
            const retryHasContacts = retryProfile.contacts && retryProfile.contacts.length > 0;
            const retryHasEmail = !!retryProfile.email;
            console.log(`[scrape] Auto-retry ${retryDomain}: contacts=${retryProfile.contacts?.length || 0} email=${retryHasEmail}`);

            if (retryHasContacts || retryHasEmail) {
              retryProfile.source_network = retryDomain;
              retryProfile.auto_retried = true;
              // Merge dati mancanti dal profilo originale
              if (!retryProfile.logo_url && profile.logo_url) retryProfile.logo_url = profile.logo_url;
              if (!retryProfile.enrolled_offices?.length && profile.enrolled_offices?.length) retryProfile.enrolled_offices = profile.enrolled_offices;
              if (!retryProfile.networks?.length && profile.networks?.length) retryProfile.networks = profile.networks;
              if (!retryProfile.address && profile.address) retryProfile.address = profile.address;
              profile = retryProfile;
              console.log(`[scrape] Auto-retry OK via ${retryDomain}: ${profile.contacts?.length || 0} contacts`);
              break;
            }
          } catch (e) { console.log(`[scrape] Auto-retry error ${retryDomain}: ${e.message}`); }
        }
      }

      results.push(profile);
    }
    return res.json({ success: true, results });
  } catch (err) { return res.status(500).json({ success: false, error: err.message }); }
};
