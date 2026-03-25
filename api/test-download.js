/**
 * api/test-download.js — Endpoint di test per verificare SSO + download profilo
 *
 * Flusso SEMPLICE e DIRETTO:
 * 1. Ricevi: wcaId + networkDomain (es. "wcaecommercesolutions.com")
 * 2. SSO login sul dominio del network specifico
 * 3. Fetch la pagina profilo DAL NETWORK (non da wcaworld.com)
 * 4. Estrai contatti con extractProfile
 * 5. Ritorna risultato dettagliato con diagnostica
 *
 * USO: POST /api/test-download
 *   body: { wcaId: 12345, networkDomain: "wcaecommercesolutions.com" }
 *   oppure: { wcaId: 12345 }  (default wcaworld.com)
 */
const fetch = require("node-fetch");
const cheerio = require("cheerio");
const { ssoLogin, getCachedCookies, saveCookiesToCache, testCookies, UA, BASE } = require("./utils/auth");
const { extractProfile, NETWORK_DOMAINS, getNetworkBase } = require("./utils/extract");

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const startTime = Date.now();
  const log = [];
  const addLog = (msg) => { log.push(`[${Date.now() - startTime}ms] ${msg}`); console.log(`[test-download] ${msg}`); };

  try {
    const { wcaId, networkDomain } = req.body || {};
    if (!wcaId) return res.status(400).json({ error: "wcaId richiesto" });

    const domain = networkDomain || "wcaworld.com";
    const networkBase = getNetworkBase(domain);
    const networkInfo = NETWORK_DOMAINS[domain];

    addLog(`START: wcaId=${wcaId} domain=${domain} base=${networkBase}`);

    // ═══ STEP 1: AUTENTICAZIONE SSO sul network ═══
    let cookies = await getCachedCookies(domain);
    let authMethod = "cached";

    if (cookies) {
      const valid = await testCookies(cookies, networkBase);
      if (!valid) {
        addLog(`Cookies cached NON validi per ${domain}, forzo SSO login`);
        cookies = null;
      } else {
        addLog(`Cookies cached VALIDI per ${domain}`);
      }
    }

    if (!cookies) {
      authMethod = "sso_login";
      addLog(`SSO login su ${networkBase}...`);
      const loginResult = await ssoLogin(null, null, networkBase);
      if (!loginResult.success) {
        addLog(`SSO FALLITO: ${loginResult.error}`);
        return res.json({
          success: false,
          error: `SSO login fallito su ${domain}`,
          detail: loginResult.error,
          log,
          elapsed: Date.now() - startTime,
        });
      }
      cookies = loginResult.cookies;
      await saveCookiesToCache(cookies, domain);
      addLog(`SSO OK: cookieLen=${cookies.length} hasASPXAUTH=${cookies.includes(".ASPXAUTH")}`);
    }

    // ═══ STEP 2: FETCH PROFILO dal network ═══
    const profileUrl = `${networkBase}/directory/members/${wcaId}`;
    addLog(`Fetch profilo: ${profileUrl}`);

    let currentUrl = profileUrl;
    let redirectCount = 0;
    let resp;

    // Redirect manuale per preservare cookies
    while (redirectCount < 5) {
      resp = await fetch(currentUrl, {
        headers: {
          "User-Agent": UA,
          "Cookie": cookies,
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Referer": `${networkBase}/Directory`,
        },
        redirect: "manual",
        timeout: 15000,
      });

      // Aggiorna cookies con nuovi set-cookie
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
          addLog(`REDIRECT AL LOGIN: ${currentUrl} — sessione non valida`);
          return res.json({
            success: false,
            error: "login_redirect",
            detail: `Redirect al login: ${currentUrl}`,
            authMethod,
            log,
            elapsed: Date.now() - startTime,
          });
        }
        redirectCount++;
        addLog(`Redirect ${redirectCount} → ${currentUrl.substring(0, 100)}`);
        continue;
      }
      break;
    }

    if (resp.status === 404) {
      addLog(`404 — profilo non trovato su ${domain}`);
      return res.json({ success: false, error: "not_found", log, elapsed: Date.now() - startTime });
    }

    const html = await resp.text();
    addLog(`HTML ricevuto: status=${resp.status} len=${html.length}`);

    // Check se la pagina è un login form
    if (html.includes('type="password"') || currentUrl.toLowerCase().includes("/login")) {
      addLog(`PAGINA DI LOGIN — cookie non autenticati`);
      return res.json({
        success: false,
        error: "login_page",
        detail: "La pagina mostra un form di login, i cookies non sono validi",
        authMethod,
        log,
        elapsed: Date.now() - startTime,
      });
    }

    // ═══ STEP 3: ESTRAI PROFILO ═══
    const $ = cheerio.load(html);
    const profile = extractProfile($, wcaId, networkBase);

    addLog(`Profilo estratto: company="${profile.company_name}" state=${profile.state}`);
    addLog(`Contatti: ${profile.contacts?.length || 0} persone`);
    addLog(`Email azienda: ${profile.email || "(vuoto)"}`);
    addLog(`Telefono: ${profile.phone || "(vuoto)"}`);
    addLog(`Networks: ${profile.networks?.join(", ") || "(nessuno)"}`);
    addLog(`Access limited: ${profile.access_limited}`);

    if (profile.contacts?.length > 0) {
      for (const c of profile.contacts) {
        addLog(`  → Contatto: ${c.name || "?"} | ${c.email || ""} | ${c.title || ""} | ${c.direct_line || ""}`);
      }
    }

    // Diagnostica HTML
    const diagnostics = {
      h1: $("h1").first().text().trim(),
      profileLabels: $(".profile_label").length,
      profileVals: $(".profile_val").length,
      profileRows: $(".profile_row").length,
      contactPersonRows: $(".contactperson_row").length,
      contactPersonAny: $("[class*='contactperson']").length,
      mailtoLinks: $("a[href^='mailto:']").length,
      hasOfficeContacts: /Office\s*Contacts/i.test(html),
      hasMembersOnly: /Members\s*Only/i.test(html),
      hasLogout: /logout|sign.?out/i.test(html),
      sampleLabels: [],
      contactClasses: [],
    };

    $(".profile_label").each((i, el) => {
      if (i < 10) diagnostics.sampleLabels.push({
        label: $(el).text().trim(),
        val: $(el).nextAll(".profile_val").first().text().trim().substring(0, 80),
      });
    });

    const classSet = new Set();
    $("[class]").each((_, el) => {
      const cls = $(el).attr("class") || "";
      cls.split(/\s+/).forEach(c => { if (/contact|person|office|profile|member|detail/i.test(c)) classSet.add(c); });
    });
    diagnostics.contactClasses = [...classSet];

    // Snippet Office Contacts
    const officeMatch = html.match(/Office\s*Contacts([\s\S]{0,2000})/i);
    if (officeMatch) diagnostics.officeContactsSnippet = officeMatch[0].substring(0, 500);

    addLog(`COMPLETATO in ${Date.now() - startTime}ms`);

    return res.json({
      success: true,
      profile: {
        wca_id: profile.wca_id,
        company_name: profile.company_name,
        state: profile.state,
        phone: profile.phone,
        email: profile.email,
        website: profile.website,
        address: profile.address,
        contacts: profile.contacts,
        networks: profile.networks,
        access_limited: profile.access_limited,
        members_only_count: profile.members_only_count,
        source_network: domain,
      },
      diagnostics,
      authMethod,
      log,
      elapsed: Date.now() - startTime,
    });
  } catch (err) {
    addLog(`ERRORE: ${err.message}`);
    return res.json({ success: false, error: err.message, log, elapsed: Date.now() - startTime });
  }
};
