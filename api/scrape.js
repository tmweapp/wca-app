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
async function tryFetchUrl(url, cookies, refererBase) {
  const baseForReferer = refererBase || BASE;
  let currentUrl = url;
  let redirectCount = 0;
  let resp;

  while (redirectCount < 5) {
    resp = await fetch(currentUrl, {
      headers: {
        "User-Agent": UA, "Cookie": cookies,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9,it;q=0.8",
        "Referer": baseForReferer + "/Directory",
      },
      redirect: "manual", timeout: 15000,
    });

    const newCookies = (resp.headers.raw?.()?.["set-cookie"] || []).map(c => c.split(";")[0]);
    if (newCookies.length) {
      const cookieMap = {};
      for (const c of cookies.split("; ")) { const eq = c.indexOf("="); if (eq > 0) cookieMap[c.substring(0, eq)] = c; }
      for (const c of newCookies) { const eq = c.indexOf("="); if (eq > 0) cookieMap[c.substring(0, eq)] = c; }
      cookies = Object.values(cookieMap).join("; ");
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
async function fetchProfile(wcaId, cookies, profileHref, networkDomain) {
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
      const result = await tryFetchUrl(url, cookies, networkBase);
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
  let cookies = await getCachedCookies(domain);
  if (cookies) {
    const valid = await testCookies(cookies, networkBase);
    if (!valid) cookies = null;
  }
  if (!cookies) {
    console.log(`[scrape] SSO login su ${networkBase}...`);
    const loginResult = await ssoLogin(null, null, networkBase);
    if (!loginResult.success) return { error: loginResult.error };
    cookies = loginResult.cookies;
    await saveCookiesToCache(cookies, domain);
  }
  return { cookies };
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
    if (auth.error) return res.status(500).json({ success: false, error: auth.error });
    const cookies = auth.cookies;

    const batch = wcaIds.slice(0, 1); // 1 solo profilo per request
    const memberMap = {};
    if (members && Array.isArray(members)) {
      for (const m of members) { if (m.id && m.href) memberMap[m.id] = m.href; }
    }

    const results = [];
    for (const wcaId of batch) {
      let profile = await fetchProfile(wcaId, cookies, memberMap[wcaId], networkDomain);

      // ═══ AUTO-RETRY su network se wcaworld.com dà contatti personali vuoti ═══
      // Scatta quando NON ci sono contatti personali (nome+email+telefono)
      // Anche se c'è l'email/telefono aziendale — quelli li abbiamo già, servono i CONTATTI
      const noContacts = !profile.contacts || profile.contacts.length === 0;
      const noContactEmails = !profile.contacts?.some(c => c.email);
      const needsRetry = profile.access_limited || (noContacts && profile.state === "ok") || (noContactEmails && profile.state === "ok");
      const wasGeneric = !isNetworkMode;

      if (needsRetry && wasGeneric && profile.networks && profile.networks.length > 0) {
        console.log(`[scrape] Auto-retry: ${wcaId} contacts=${profile.contacts?.length||0} contactEmails=${noContactEmails} limited=${profile.access_limited} networks: ${profile.networks.join(", ")}`);
        const domainsToTry = networkNameToDomains(profile.networks);
        console.log(`[scrape] Auto-retry domini: ${domainsToTry.join(", ") || "nessuno"}`);

        for (const retryDomain of domainsToTry) {
          try {
            const retryAuth = await getAuthCookies(retryDomain);
            if (retryAuth.error) { console.log(`[scrape] Auto-retry SSO failed on ${retryDomain}`); continue; }

            const retryProfile = await fetchProfile(wcaId, retryAuth.cookies, null, retryDomain);
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
