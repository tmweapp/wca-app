/**
 * api/fetch-contacts.js — PROCEDURA NUOVA STANDALONE
 *
 * NON usa auth.js, NON usa scrape.js, NON usa extract.js.
 * Fa tutto da solo: login SSO + fetch profilo + estrazione contatti.
 *
 * GET /api/fetch-contacts?wcaId=24995
 * GET /api/fetch-contacts?wcaId=24995&domain=elitegln.com
 *
 * Ritorna JSON con contatti completi (nome, email, telefono).
 */
const fetch = require("node-fetch");
const cheerio = require("cheerio");

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const USERNAME = process.env.WCA_USERNAME || "tmsrlmin";
const PASSWORD = process.env.WCA_PASSWORD || "G0u3v!VvCn";

// ═══ STEP 1: LOGIN SSO ═══
// Fa login su un dominio WCA e ritorna i cookies autenticati
async function loginSSO(targetBase) {
  const TARGET_DOMAIN = targetBase.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "");
  const SSO_DOMAIN = "sso.api.wcaworld.com";
  const log = [];

  // Cookie jar separato per dominio (come il browser)
  const jars = {}; // domain → { cookieName: "name=value" }
  function addCookies(domain, headers) {
    if (!jars[domain]) jars[domain] = {};
    for (const raw of (headers || [])) {
      const c = raw.split(";")[0];
      const eq = c.indexOf("=");
      if (eq > 0) jars[domain][c.substring(0, eq)] = c;
    }
  }
  function getCookies(domain) {
    if (!jars[domain]) return "";
    return Object.values(jars[domain]).join("; ");
  }

  // 1a. GET /Account/Login — segui redirect fino alla pagina SSO
  log.push(`GET ${targetBase}/Account/Login`);
  let resp = await fetch(`${targetBase}/Account/Login`, { headers: { "User-Agent": UA }, redirect: "manual" });
  addCookies(TARGET_DOMAIN, resp.headers.raw()["set-cookie"] || []);

  let currentUrl = `${targetBase}/Account/Login`;
  for (let i = 0; i < 5 && resp.status >= 300 && resp.status < 400; i++) {
    const loc = resp.headers.get("location") || "";
    if (!loc) break;
    currentUrl = loc.startsWith("http") ? loc : new URL(loc, currentUrl).href;
    const domain = currentUrl.includes("sso.api.wcaworld.com") ? SSO_DOMAIN : TARGET_DOMAIN;
    resp = await fetch(currentUrl, { headers: { "User-Agent": UA, "Cookie": getCookies(domain) }, redirect: "manual" });
    addCookies(domain, resp.headers.raw()["set-cookie"] || []);
    log.push(`  redirect → ${currentUrl.substring(0, 80)} (${resp.status})`);
  }

  const loginHtml = resp.status === 200 ? await resp.text() : "";
  log.push(`Login page: ${loginHtml.length} bytes`);

  // 1b. Trova URL del form SSO con regex (funziona anche se il form è in JavaScript)
  const ssoMatch = loginHtml.match(/action\s*[:=]\s*['"]?(https:\/\/sso\.api\.wcaworld\.com[^'"&\s]+[^'"]*)/i);
  if (!ssoMatch) {
    log.push("ERROR: SSO URL non trovato nella pagina di login");
    return { ok: false, log, error: "SSO URL not found" };
  }
  const ssoUrl = ssoMatch[1].replace(/&amp;/g, "&");
  log.push(`SSO URL: ${ssoUrl.substring(0, 80)}`);

  // 1c. Estrai campi hidden dal form SSO (CSRF tokens etc.)
  const $login = cheerio.load(loginHtml);
  const hiddenFields = {};
  $login("form").each((_, form) => {
    const action = $login(form).attr("action") || "";
    if (action.includes("sso.api.wcaworld.com")) {
      $login(form).find("input[type='hidden']").each((_, inp) => {
        const n = $login(inp).attr("name");
        const v = $login(inp).attr("value") || "";
        if (n) hiddenFields[n] = v;
      });
    }
  });
  log.push(`Hidden fields: ${Object.keys(hiddenFields).join(", ") || "nessuno"}`);

  // 1d. POST al server SSO con TUTTI i campi + credenziali
  const postBody = new URLSearchParams();
  for (const [k, v] of Object.entries(hiddenFields)) postBody.set(k, v);
  postBody.set("UserName", USERNAME);
  postBody.set("Password", PASSWORD);
  postBody.set("pwd", PASSWORD);

  const ssoResp = await fetch(ssoUrl, {
    method: "POST",
    headers: {
      "User-Agent": UA,
      "Content-Type": "application/x-www-form-urlencoded",
      "Origin": "https://sso.api.wcaworld.com",
      "Referer": ssoUrl,
      "Cookie": getCookies(SSO_DOMAIN),
    },
    body: postBody.toString(),
    redirect: "manual",
  });
  addCookies(SSO_DOMAIN, ssoResp.headers.raw()["set-cookie"] || []);
  log.push(`SSO POST: status=${ssoResp.status} hasAuth=${!!jars[SSO_DOMAIN]?.[".ASPXAUTH"]}`);

  // 1e. Processa WS-Fed postback (SSO ritorna 200 con form auto-submit)
  if (ssoResp.status === 200) {
    const pbHtml = await ssoResp.text();
    const $pb = cheerio.load(pbHtml);
    const pbAction = $pb("form").attr("action") || "";
    if (pbAction) {
      const pbParams = new URLSearchParams();
      $pb("input[type='hidden']").each((_, el) => {
        const n = $pb(el).attr("name");
        const v = $pb(el).attr("value") || "";
        if (n) pbParams.set(n, v);
      });
      log.push(`WS-Fed postback → ${pbAction.substring(0, 80)}`);
      const pbResp = await fetch(pbAction, {
        method: "POST",
        headers: { "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded", "Cookie": getCookies(TARGET_DOMAIN), "Referer": ssoUrl },
        body: pbParams.toString(),
        redirect: "manual",
      });
      addCookies(TARGET_DOMAIN, pbResp.headers.raw()["set-cookie"] || []);
      log.push(`Postback: status=${pbResp.status} targetAuth=${!!jars[TARGET_DOMAIN]?.[".ASPXAUTH"]}`);

      // Segui redirect dopo postback
      let pbLoc = pbResp.headers.get("location") || "";
      for (let i = 0; i < 5 && pbLoc; i++) {
        const next = pbLoc.startsWith("http") ? pbLoc : new URL(pbLoc, pbAction).href;
        const domain = next.includes("sso.api.wcaworld.com") ? SSO_DOMAIN : TARGET_DOMAIN;
        const r = await fetch(next, { headers: { "User-Agent": UA, "Cookie": getCookies(domain) }, redirect: "manual" });
        addCookies(domain, r.headers.raw()["set-cookie"] || []);
        pbLoc = r.headers.get("location") || "";
        if (r.status === 200) break;
      }
    }
  }

  // 1f. Se SSO ha dato 302, PRIMA leggi il body (potrebbe avere WS-Fed form)
  if (ssoResp.status >= 300 && ssoResp.status < 400) {
    // Il body della 302 può contenere un WS-Fed form (auto-submit)
    try {
      const ssoBody = await ssoResp.text();
      if (ssoBody && ssoBody.includes("<form")) {
        const $sf = cheerio.load(ssoBody);
        const sfAction = $sf("form").attr("action") || "";
        if (sfAction) {
          const sfParams = new URLSearchParams();
          $sf("input[type='hidden']").each((_, el) => { const n = $sf(el).attr("name"); if (n) sfParams.set(n, $sf(el).attr("value") || ""); });
          log.push(`SSO 302 body has WS-Fed form → ${sfAction.substring(0, 80)} fields=${[...sfParams.keys()].join(",")}`);
          const sfDomain = sfAction.includes("sso.api.wcaworld.com") ? SSO_DOMAIN : TARGET_DOMAIN;
          const sfResp = await fetch(sfAction, {
            method: "POST",
            headers: { "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded", "Cookie": getCookies(sfDomain), "Referer": ssoUrl },
            body: sfParams.toString(), redirect: "manual",
          });
          addCookies(sfDomain, sfResp.headers.raw()["set-cookie"] || []);
          log.push(`SSO 302 form POST: status=${sfResp.status} targetAuth=${!!jars[TARGET_DOMAIN]?.[".ASPXAUTH"]}`);
          // Segui redirect dopo postback
          let sfLoc = sfResp.headers.get("location") || "";
          for (let j = 0; j < 5 && sfLoc; j++) {
            const sfNext = sfLoc.startsWith("http") ? sfLoc : new URL(sfLoc, sfAction).href;
            const sfD = sfNext.includes("sso.api.wcaworld.com") ? SSO_DOMAIN : TARGET_DOMAIN;
            const sfR = await fetch(sfNext, { headers: { "User-Agent": UA, "Cookie": getCookies(sfD) }, redirect: "manual" });
            addCookies(sfD, sfR.headers.raw()["set-cookie"] || []);
            sfLoc = sfR.headers.get("location") || "";
            if (sfR.status === 200) {
              const sfHtml = await sfR.text();
              // Check for another WS-Fed form
              if (sfHtml.includes("<form") && sfHtml.includes("wresult")) {
                const $sf2 = cheerio.load(sfHtml);
                const sf2Action = $sf2("form").attr("action") || "";
                if (sf2Action) {
                  const sf2Params = new URLSearchParams();
                  $sf2("input[type='hidden']").each((_, el) => { const n = $sf2(el).attr("name"); if (n) sf2Params.set(n, $sf2(el).attr("value") || ""); });
                  const sf2D = sf2Action.includes("sso.api.wcaworld.com") ? SSO_DOMAIN : TARGET_DOMAIN;
                  const sf2Resp = await fetch(sf2Action, {
                    method: "POST",
                    headers: { "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded", "Cookie": getCookies(sf2D) },
                    body: sf2Params.toString(), redirect: "manual",
                  });
                  addCookies(sf2D, sf2Resp.headers.raw()["set-cookie"] || []);
                  log.push(`Nested WS-Fed POST: status=${sf2Resp.status}`);
                }
              }
              break;
            }
          }
        }
      }
    } catch(e) { /* body already consumed or empty */ }

    // Poi segui la redirect chain normalmente
    let loc = ssoResp.headers.get("location") || "";
    log.push(`SSO 302 redirect: ${loc.substring(0, 120)}`);
    for (let i = 0; i < 8 && loc; i++) {
      const url = loc.startsWith("http") ? loc : new URL(loc, ssoUrl).href;
      const domain = url.includes("sso.api.wcaworld.com") ? SSO_DOMAIN : TARGET_DOMAIN;
      const r = await fetch(url, { headers: { "User-Agent": UA, "Cookie": getCookies(domain) }, redirect: "manual" });
      addCookies(domain, r.headers.raw()["set-cookie"] || []);
      log.push(`  callback[${i}]: ${domain} status=${r.status} url=${url.substring(0, 80)}`);

      // .ASPXAUTH appena settato? Logga il valore
      if (r.headers.raw()["set-cookie"]?.some(c => c.includes(".ASPXAUTH"))) {
        const aspx = r.headers.raw()["set-cookie"].find(c => c.includes(".ASPXAUTH"));
        const val = aspx ? aspx.split(";")[0].split("=").slice(1).join("=") : "";
        log.push(`  → .ASPXAUTH set! len=${val.length} empty=${val === ""}`);
      }

      // Check per WS-Fed form nel body di 200
      if (r.status === 200) {
        const html = await r.text();
        log.push(`  200 body: len=${html.length} hasForm=${html.includes("<form")} hasWresult=${html.includes("wresult")}`);
        if (html.includes("<form") && (html.includes("wresult") || html.includes("wsignin"))) {
          const $f = cheerio.load(html);
          const fAction = $f("form").attr("action") || "";
          if (fAction) {
            const fParams = new URLSearchParams();
            $f("input[type='hidden']").each((_, el) => { const n = $f(el).attr("name"); if (n) fParams.set(n, $f(el).attr("value") || ""); });
            log.push(`  WS-Fed form → ${fAction.substring(0, 80)}`);
            const fD = fAction.includes("sso.api.wcaworld.com") ? SSO_DOMAIN : TARGET_DOMAIN;
            const fResp = await fetch(fAction, {
              method: "POST",
              headers: { "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded", "Cookie": getCookies(fD) },
              body: fParams.toString(), redirect: "manual",
            });
            addCookies(fD, fResp.headers.raw()["set-cookie"] || []);
            log.push(`  WS-Fed POST: status=${fResp.status}`);
            let fLoc = fResp.headers.get("location") || "";
            for (let j = 0; j < 3 && fLoc; j++) {
              const fn = fLoc.startsWith("http") ? fLoc : new URL(fLoc, fAction).href;
              const fr = await fetch(fn, { headers: { "User-Agent": UA, "Cookie": getCookies(TARGET_DOMAIN) }, redirect: "manual" });
              addCookies(TARGET_DOMAIN, fr.headers.raw()["set-cookie"] || []);
              fLoc = fr.headers.get("location") || "";
              if (fr.status === 200) break;
            }
          }
        }
        break;
      }
      loc = r.headers.get("location") || "";
    }
  }

  // 1g. Warmup: visita /Directory per confermare autenticazione
  const targetCookies = getCookies(TARGET_DOMAIN);
  const ssoCookies = getCookies(SSO_DOMAIN);
  log.push(`Target cookies: ${Object.keys(jars[TARGET_DOMAIN] || {}).join(", ")}`);
  log.push(`SSO cookies: ${Object.keys(jars[SSO_DOMAIN] || {}).join(", ")}`);

  let warmupResp = await fetch(`${targetBase}/Directory`, {
    headers: { "User-Agent": UA, "Cookie": targetCookies },
    redirect: "manual",
  });
  addCookies(TARGET_DOMAIN, warmupResp.headers.raw()["set-cookie"] || []);
  // Segui redirect del warmup
  let wLoc = warmupResp.headers.get("location") || "";
  for (let i = 0; i < 3 && wLoc; i++) {
    const wNext = wLoc.startsWith("http") ? wLoc : new URL(wLoc, `${targetBase}/Directory`).href;
    const wDomain = wNext.includes("sso.api.wcaworld.com") ? SSO_DOMAIN : TARGET_DOMAIN;
    warmupResp = await fetch(wNext, { headers: { "User-Agent": UA, "Cookie": getCookies(wDomain) }, redirect: "manual" });
    addCookies(wDomain, warmupResp.headers.raw()["set-cookie"] || []);
    wLoc = warmupResp.headers.get("location") || "";
    if (warmupResp.status === 200) break;
  }

  if (warmupResp.status === 200) {
    const wHtml = await warmupResp.text();
    const hasLogout = /logout|sign.?out/i.test(wHtml);
    log.push(`Warmup: hasLogout=${hasLogout}`);
    if (!hasLogout) {
      return { ok: false, log, error: "Login SSO completato ma NON autenticato (no logout)" };
    }
  }

  const finalCookies = getCookies(TARGET_DOMAIN);
  log.push(`OK! Cookie length: ${finalCookies.length}`);
  return { ok: true, cookies: finalCookies, ssoCookies: getCookies(SSO_DOMAIN), log };
}

// ═══ STEP 2: FETCH PROFILO + ESTRAI CONTATTI ═══
async function fetchAndExtract(wcaId, cookies, baseUrl, ssoCookies) {
  const url = `${baseUrl}/directory/members/${wcaId}`;

  // Fetch con gestione redirect (incluso SSO CheckLoggedIn)
  let currentUrl = url;
  let resp;
  for (let i = 0; i < 5; i++) {
    const isSSO = currentUrl.includes("sso.api.wcaworld.com");
    resp = await fetch(currentUrl, {
      headers: { "User-Agent": UA, "Cookie": isSSO ? (ssoCookies || cookies) : cookies, "Referer": baseUrl + "/Directory" },
      redirect: "manual", timeout: 15000,
    });
    if (resp.status >= 300 && resp.status < 400) {
      const loc = resp.headers.get("location") || "";
      if (!loc || loc.toLowerCase().includes("/login")) break;
      currentUrl = loc.startsWith("http") ? loc : new URL(loc, currentUrl).href;
      continue;
    }
    break;
  }

  const html = await resp.text();
  const $ = cheerio.load(html);
  const hasLogout = /logout|sign.?out/i.test(html);
  const membersOnlyCount = (html.match(/Members\s*Only/gi) || []).length;

  // Company name
  let company = $(".company_name .company, span.company").first().text().trim();
  if (!company) company = $(".company_name").first().text().trim();
  if (!company) company = $("h1").first().text().trim();
  company = company.replace(/\n/g, " ").replace(/\s{2,}/g, " ").trim();

  // Company-level fields
  let phone = "", fax = "", email = "", website = "", address = "";
  $(".profile_row").each((_, row) => {
    if ($(row).closest(".contactperson_row, .contactperson_info").length) return;
    const label = $(row).find(".profile_label").text().trim().replace(/:?\s*$/, "").toLowerCase();
    const valEl = $(row).find(".profile_val");
    let val = valEl.text().trim();
    if (/members\s*only/i.test(val)) val = "";
    if (/^phone|^telephone/.test(label) && !phone) phone = val;
    else if (/^fax/.test(label) && !fax) fax = val;
    else if (/^website|^url/.test(label) && !website) website = valEl.find("a").attr("href") || val;
    else if (/^email|^e-mail/.test(label) && !email) {
      const mailto = valEl.find("a[href^='mailto:']").attr("href");
      email = mailto ? mailto.replace("mailto:", "").trim() : (val.includes("@") ? val : "");
    }
  });

  // Address
  $(".profile_addr").each((_, el) => {
    if (!address) {
      const parts = [];
      $(el).find("span").each((_, s) => { const t = $(s).text().trim(); if (t) parts.push(t); });
      address = parts.length ? parts.join(", ") : $(el).text().trim().replace(/\s+/g, " ");
    }
  });

  // Contacts
  const contacts = [];
  const LABELS = { "name": "name", "nome": "name", "title": "title", "titolo": "title", "position": "title", "role": "title", "email": "email", "e-mail": "email", "direct line": "direct_line", "direct": "direct_line", "phone": "direct_line", "telephone": "direct_line", "fax": "fax", "mobile": "mobile", "cell": "mobile", "skype": "skype" };

  // Strategia 1: .contactperson_row → .profile_row
  const contactRows = $(".contactperson_row, [class*='contactperson']");
  contactRows.each((_, row) => {
    let contact = {};
    $(row).find(".profile_row").each((_, prow) => {
      const label = $(prow).find(".profile_label").text().trim().replace(/:?\s*$/, "").toLowerCase();
      const valEl = $(prow).find(".profile_val");
      let val = valEl.text().trim();
      if (/members\s*only/i.test(val)) val = "";
      const mailto = valEl.find("a[href^='mailto:']").attr("href");
      if (mailto) val = mailto.replace("mailto:", "").trim();

      const field = LABELS[label];
      if (!field) return;
      if (field === "name" && (contact.name || contact.email)) { contacts.push(contact); contact = {}; }
      if (val) {
        if (field === "email" && val.includes("@")) contact.email = val;
        else if (field !== "email") contact[field] = val;
      }
    });
    if (contact.name || contact.email || contact.title) contacts.push(contact);
  });

  // Strategia 2: regex fallback
  if (contacts.length === 0) {
    const fullText = $.text();
    const blocks = fullText.split(/(?=Name\s*:)/i);
    for (const block of blocks) {
      if (!/Name\s*:/i.test(block)) continue;
      const c = {};
      const nm = block.match(/Name\s*:\s*(.+?)(?=Title|Email|Direct|Phone|Fax|Mobile|$)/is);
      const ti = block.match(/Title\s*:\s*(.+?)(?=Name|Email|Direct|Phone|Fax|Mobile|$)/is);
      const em = block.match(/Email\s*:\s*(\S+@\S+)/i);
      const dl = block.match(/Direct\s*(?:Line)?\s*:\s*(.+?)(?=Name|Title|Email|Fax|Mobile|$)/is);
      const mo = block.match(/Mobile\s*:\s*(.+?)(?=Name|Title|Email|Direct|Fax|$)/is);
      if (nm) c.name = nm[1].trim();
      if (ti) c.title = ti[1].trim();
      if (em) c.email = em[1].trim();
      if (dl) c.direct_line = dl[1].trim();
      if (mo) c.mobile = mo[1].trim();
      if (c.name || c.email) contacts.push(c);
    }
  }

  // Strategia 3: mailto fallback
  if (contacts.length === 0) {
    $("a[href^='mailto:']").each((_, el) => {
      const em = ($(el).attr("href") || "").replace("mailto:", "").trim();
      if (em && !contacts.find(c => c.email === em)) contacts.push({ email: em, name: $(el).text().trim() || em });
    });
  }

  return {
    wca_id: wcaId,
    company,
    address,
    phone, fax, email, website,
    contacts,
    hasLogout,
    membersOnlyCount,
    htmlLen: html.length,
  };
}

// ═══ NETWORK DOMAINS ═══
const NETWORKS = {
  "wcaworld.com": "https://www.wcaworld.com",
  "lognetglobal.com": "https://www.lognetglobal.com",
  "globalaffinityalliance.com": "https://www.globalaffinityalliance.com",
  "elitegln.com": "https://www.elitegln.com",
  "ifc8.network": "https://ifc8.network",
  "wcaprojects.com": "https://www.wcaprojects.com",
  "wcadangerousgoods.com": "https://www.wcadangerousgoods.com",
  "wcaperishables.com": "https://www.wcaperishables.com",
  "wcatimecritical.com": "https://www.wcatimecritical.com",
  "wcapharma.com": "https://www.wcapharma.com",
  "wcarelocations.com": "https://www.wcarelocations.com",
  "wcaecommercesolutions.com": "https://www.wcaecommercesolutions.com",
  "wcaexpo.com": "https://www.wcaexpo.com",
};

// ═══ HANDLER ═══
module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(200).end();

  const wcaId = req.query.wcaId;
  const domain = req.query.domain || "wcaworld.com";

  if (!wcaId) return res.status(400).json({ error: "wcaId richiesto. Uso: /api/fetch-contacts?wcaId=24995" });

  const baseUrl = NETWORKS[domain] || "https://www.wcaworld.com";

  try {
    // Login
    const login = await loginSSO(baseUrl);

    // Fetch profilo ANCHE se login non è perfetto (i dati parziali possono bastare)
    const cookies = login.cookies || "";
    const ssoCookies = login.ssoCookies || "";
    const profile = await fetchAndExtract(parseInt(wcaId), cookies, baseUrl, ssoCookies);

    return res.json({
      success: login.ok,
      authenticated: login.ok,
      domain,
      profile,
      ssoLog: login.log,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message, stack: err.stack.split("\n").slice(0, 5) });
  }
};
