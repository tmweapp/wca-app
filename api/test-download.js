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
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST" && req.method !== "GET") return res.status(405).json({ error: "GET or POST" });

  const startTime = Date.now();
  const log = [];
  const addLog = (msg) => { log.push(`[${Date.now() - startTime}ms] ${msg}`); console.log(`[test-download] ${msg}`); };

  try {
    // Supporta GET con query params O POST con body
    const params = req.method === "GET" ? (req.query || {}) : (req.body || {});
    const wcaId = params.wcaId ? parseInt(params.wcaId) : null;
    const networkDomain = params.networkDomain || null;
    if (!wcaId) return res.status(400).json({ error: "wcaId richiesto (es. ?wcaId=12345&networkDomain=wcaprojects.com)" });

    const domain = networkDomain || "wcaworld.com";
    const networkBase = getNetworkBase(domain);
    const networkInfo = NETWORK_DOMAINS[domain];

    addLog(`START: wcaId=${wcaId} domain=${domain} base=${networkBase}`);

    // ═══ STEP 1: AUTENTICAZIONE SSO sul network ═══
    let cookies = null;
    var ssoCookies = "";
    let authMethod = "cached";

    // getCachedCookies ora ritorna { cookies, ssoCookies } oppure null
    const cached = await getCachedCookies(domain);
    if (cached) {
      cookies = cached.cookies;
      ssoCookies = cached.ssoCookies || "";
      const valid = await testCookies(cookies, networkBase);
      if (!valid) {
        addLog(`Cookies cached NON validi per ${domain}, forzo SSO login`);
        cookies = null; ssoCookies = "";
      } else {
        addLog(`Cookies cached VALIDI per ${domain} (hasSsoCookies=${!!ssoCookies})`);
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
      ssoCookies = loginResult.ssoCookies || "";
      await saveCookiesToCache(cookies, domain, ssoCookies);
      addLog(`SSO OK: cookieLen=${cookies.length} hasASPXAUTH=${cookies.includes(".ASPXAUTH")} ssoCookieLen=${ssoCookies.length}`);
    }

    // ═══ STEP 2: FETCH PROFILO dal network ═══
    const profileUrl = `${networkBase}/directory/members/${wcaId}`;
    addLog(`Fetch profilo: ${profileUrl}`);

    let currentUrl = profileUrl;
    let redirectCount = 0;
    let resp;

    // Redirect manuale per preservare cookies (SSO-aware)
    // ssoCookies è già dichiarato sopra (var ssoCookies)
    while (redirectCount < 5) {
      // Usa cookies SSO quando redirect va a sso.api.wcaworld.com
      const isSSO = currentUrl.includes("sso.api.wcaworld.com");
      const cookiesToSend = isSSO ? ssoCookies : cookies;

      resp = await fetch(currentUrl, {
        headers: {
          "User-Agent": UA,
          "Cookie": cookiesToSend,
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Referer": `${networkBase}/Directory`,
        },
        redirect: "manual",
        timeout: 15000,
      });

      // Aggiorna cookies del dominio corretto
      const newCookies = (resp.headers.raw?.()?.["set-cookie"] || []).map(c => c.split(";")[0]);
      if (newCookies.length) {
        const source = isSSO ? ssoCookies : cookies;
        const cookieMap = {};
        for (const c of source.split("; ")) { const eq = c.indexOf("="); if (eq > 0) cookieMap[c.substring(0, eq)] = c; }
        for (const c of newCookies) { const eq = c.indexOf("="); if (eq > 0) cookieMap[c.substring(0, eq)] = c; }
        if (isSSO) ssoCookies = Object.values(cookieMap).join("; ");
        else cookies = Object.values(cookieMap).join("; ");
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

    // ═══ CHECK AUTENTICAZIONE ═══
    const hasLogout = /logout|sign.?out/i.test(html);
    const membersOnlyCount = (html.match(/Members\s*only/gi) || []).length;
    addLog(`Auth check: hasLogout=${hasLogout} membersOnlyCount=${membersOnlyCount}`);

    // Se NON siamo loggati (no logout link), forza SSO refresh e riprova
    if (!hasLogout && authMethod === "cached") {
      addLog(`⚠ Cookies cached NON autenticati — forzo SSO refresh`);
      const freshLogin = await ssoLogin(null, null, networkBase);
      if (freshLogin.success) {
        cookies = freshLogin.cookies;
        ssoCookies = freshLogin.ssoCookies || "";
        await saveCookiesToCache(cookies, domain, ssoCookies);
        authMethod = "sso_refresh";
        addLog(`SSO refresh OK — rifetch profilo con redirect manuale...`);

        // Rifetch con nuovi cookies — redirect MANUALE per gestire SSO cookies
        let retryUrl = profileUrl;
        let retryRedirects = 0;
        let retryResp;
        while (retryRedirects < 5) {
          const isSSO = retryUrl.includes("sso.api.wcaworld.com");
          const cookiesToSend = isSSO ? ssoCookies : cookies;
          retryResp = await fetch(retryUrl, {
            headers: { "User-Agent": UA, "Cookie": cookiesToSend, "Accept": "text/html,application/xhtml+xml", "Referer": `${networkBase}/Directory` },
            redirect: "manual", timeout: 15000,
          });
          // Aggiorna cookies
          const newC = (retryResp.headers.raw?.()?.["set-cookie"] || []).map(c => c.split(";")[0]);
          if (newC.length) {
            const src = isSSO ? ssoCookies : cookies;
            const cm = {};
            for (const c of src.split("; ")) { const eq = c.indexOf("="); if (eq > 0) cm[c.substring(0, eq)] = c; }
            for (const c of newC) { const eq = c.indexOf("="); if (eq > 0) cm[c.substring(0, eq)] = c; }
            if (isSSO) ssoCookies = Object.values(cm).join("; ");
            else cookies = Object.values(cm).join("; ");
          }
          if (retryResp.status >= 300 && retryResp.status < 400) {
            const loc = retryResp.headers.get("location") || "";
            if (!loc) break;
            retryUrl = loc.startsWith("http") ? loc : new URL(loc, retryUrl).href;
            retryRedirects++;
            continue;
          }
          break;
        }

        const retryHtml = await retryResp.text();
        const retryHasLogout = /logout|sign.?out/i.test(retryHtml);
        addLog(`Retry: status=${retryResp.status} len=${retryHtml.length} hasLogout=${retryHasLogout}`);
        if (retryHasLogout || retryHtml.length > html.length) {
          var $ = cheerio.load(retryHtml);
          var html2 = retryHtml;
        } else {
          var $ = cheerio.load(html);
          var html2 = html;
        }
      } else {
        addLog(`SSO refresh FALLITO: ${freshLogin.error}`);
        var $ = cheerio.load(html);
        var html2 = html;
      }
    } else {
      var $ = cheerio.load(html);
      var html2 = html;
    }

    // ═══ STEP 3: ESTRAI PROFILO ═══
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
    const officeMatch = (html2||html).match(/Office\s*Contacts([\s\S]{0,2000})/i);
    if (officeMatch) diagnostics.officeContactsSnippet = officeMatch[0].substring(0, 500);

    // ═══ RAW HTML DUMP per debug ═══
    // Cerca sezioni con nomi/email/telefoni per capire la struttura
    diagnostics.rawSnippets = {};

    // 1. Tutto il HTML con "contactperson" nel class
    const contactPersonHtml = [];
    $("[class*='contactperson'], [class*='contact_person'], [class*='ContactPerson']").each((i, el) => {
      if (i < 5) contactPersonHtml.push($.html(el).substring(0, 500));
    });
    diagnostics.rawSnippets.contactPersonElements = contactPersonHtml;

    // 2. Cerco nell'HTML raw pattern email e dintorni
    const finalHtml = html2 || html;
    const emailPatterns = finalHtml.match(/.{0,200}[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}.{0,200}/g) || [];
    diagnostics.rawSnippets.emailContexts = emailPatterns.slice(0, 5).map(s => s.substring(0, 300));

    // 3. Tutti i mailto links
    const mailtos = [];
    $("a[href^='mailto:']").each((i, el) => {
      mailtos.push({ email: $(el).attr("href"), text: $(el).text().trim(), parentClass: $(el).parent().attr("class") || "", parentHtml: $.html($(el).parent()).substring(0, 300) });
    });
    diagnostics.rawSnippets.mailtoLinks = mailtos;

    // 4. Tutti i .profile_row con label e val
    const profileRows = [];
    $(".profile_row").each((i, el) => {
      profileRows.push({ html: $.html(el).substring(0, 300), label: $(el).find(".profile_label").text().trim(), val: $(el).find(".profile_val").text().trim().substring(0, 100) });
    });
    diagnostics.rawSnippets.profileRows = profileRows;

    // 5. Cerca "Name" text nodes vicino a dati contatto
    const nameContexts = [];
    const nameRegex = /Name\s*:?\s*[^<]{2,50}/gi;
    let m;
    while ((m = nameRegex.exec(finalHtml)) !== null && nameContexts.length < 5) {
      const start = Math.max(0, m.index - 100);
      nameContexts.push(finalHtml.substring(start, m.index + m[0].length + 200));
    }
    diagnostics.rawSnippets.nameContexts = nameContexts;

    // 6. Primi 3000 chars dopo "Office Contacts" o "Contact" heading
    const contactSectionMatch = finalHtml.match(/(Office\s*Contacts|Contact\s*Details|Contact\s*Information)([\s\S]{0,3000})/i);
    if (contactSectionMatch) diagnostics.rawSnippets.contactSectionHtml = contactSectionMatch[0].substring(0, 2000);

    // 7. HTML len totale e se sembra un profilo completo
    diagnostics.htmlLength = finalHtml.length;
    diagnostics.hasPasswordField = finalHtml.includes('type="password"');
    diagnostics.bodyPreview = finalHtml.substring(0, 500);

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
