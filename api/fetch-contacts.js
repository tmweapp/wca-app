/**
 * api/fetch-contacts.js — PROCEDURA NUOVA STANDALONE v2
 *
 * NON usa auth.js, NON usa scrape.js, NON usa extract.js.
 * Fa tutto da solo: login SSO + fetch profilo + estrazione contatti.
 *
 * GET /api/fetch-contacts?wcaId=24995
 * GET /api/fetch-contacts?wcaId=24995&domain=elitegln.com
 * GET /api/fetch-contacts?mode=diag  (solo diagnostica SSO)
 *
 * v2: Diagnostica completa, log FULL redirect URLs, legge body 302,
 *     prova strategie multiple per SSO, gestisce WS-Fed token exchange.
 */
const fetch = require("node-fetch");
const cheerio = require("cheerio");

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const USERNAME = process.env.WCA_USERNAME || "tmsrlmin";
const PASSWORD = process.env.WCA_PASSWORD || "G0u3v!VvCn";

// Browser-like headers per SSO POST (manca solo Cookie)
const BROWSER_HEADERS = {
  "User-Agent": UA,
  "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9,it;q=0.8",
  "Accept-Encoding": "gzip, deflate, br",
  "Cache-Control": "no-cache",
  "Pragma": "no-cache",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "same-origin",
  "Sec-Fetch-User": "?1",
  "Upgrade-Insecure-Requests": "1",
};

// ═══ COOKIE JAR domain-aware ═══
function createJar() {
  const jar = {};
  return {
    add(domain, setCookieHeaders) {
      if (!jar[domain]) jar[domain] = {};
      for (const raw of (setCookieHeaders || [])) {
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
      for (const d of Object.keys(jar)) for (const [k, v] of Object.entries(jar[d])) all[k] = v;
      return Object.values(all).join("; ");
    },
    keys(domain) { return jar[domain] ? Object.keys(jar[domain]) : []; },
    getValue(domain, name) {
      if (!jar[domain] || !jar[domain][name]) return null;
      const eq = jar[domain][name].indexOf("=");
      return eq > 0 ? jar[domain][name].substring(eq + 1) : "";
    },
    dump() {
      const result = {};
      for (const d of Object.keys(jar)) {
        result[d] = {};
        for (const [k, v] of Object.entries(jar[d])) {
          const eq = v.indexOf("=");
          const val = eq > 0 ? v.substring(eq + 1) : "";
          result[d][k] = val.length > 20 ? `${val.substring(0, 20)}...(${val.length}c)` : val;
        }
      }
      return result;
    }
  };
}

function domainOf(url) {
  if (url.includes("sso.api.wcaworld.com")) return "sso.api.wcaworld.com";
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return "unknown"; }
}

// ═══ PROCESS WS-FED FORM: estrai e POST il token ═══
async function processWsFedForm(html, jar, log, referer) {
  const $ = cheerio.load(html);
  const forms = [];
  $("form").each((_, f) => {
    const action = $(f).attr("action") || "";
    const fields = {};
    $(f).find("input[type='hidden']").each((_, inp) => {
      const n = $(inp).attr("name");
      if (n) fields[n] = $(inp).attr("value") || "";
    });
    forms.push({ action, fields, fieldCount: Object.keys(fields).length });
  });

  if (forms.length === 0) return false;

  // Find the WS-Fed form (has wresult or wctx or wa fields)
  let wsFedForm = forms.find(f => f.fields.wresult || f.fields.wctx || f.fields.wa);
  if (!wsFedForm) wsFedForm = forms.find(f => f.fieldCount > 0);
  if (!wsFedForm || !wsFedForm.action) return false;

  log.push(`  WS-Fed form found → action=${wsFedForm.action.substring(0, 100)} fields=${Object.keys(wsFedForm.fields).join(",")}`);
  log.push(`  wresult present=${!!wsFedForm.fields.wresult} len=${(wsFedForm.fields.wresult || "").length}`);

  const targetDomain = domainOf(wsFedForm.action);
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(wsFedForm.fields)) params.set(k, v);

  const pbResp = await fetch(wsFedForm.action, {
    method: "POST",
    headers: {
      ...BROWSER_HEADERS,
      "Content-Type": "application/x-www-form-urlencoded",
      "Cookie": jar.get(targetDomain),
      "Referer": referer || "",
      "Sec-Fetch-Site": "cross-site",
    },
    body: params.toString(),
    redirect: "manual",
  });

  jar.add(targetDomain, pbResp.headers.raw()["set-cookie"] || []);
  const aspxVal = jar.getValue(targetDomain, ".ASPXAUTH");
  log.push(`  WS-Fed POST → status=${pbResp.status} domain=${targetDomain} .ASPXAUTH=${aspxVal ? `len=${aspxVal.length}` : "NONE"}`);

  // Follow redirects after postback
  let loc = pbResp.headers.get("location") || "";
  for (let i = 0; i < 5 && loc; i++) {
    const next = loc.startsWith("http") ? loc : new URL(loc, wsFedForm.action).href;
    const d = domainOf(next);
    log.push(`  postback redirect[${i}]: ${next.substring(0, 120)} (${d})`);
    const r = await fetch(next, {
      headers: { ...BROWSER_HEADERS, "Cookie": jar.get(d) },
      redirect: "manual",
    });
    jar.add(d, r.headers.raw()["set-cookie"] || []);
    loc = r.headers.get("location") || "";

    if (r.status === 200) {
      const body = await r.text();
      // Check for nested WS-Fed form
      if (body.includes("<form") && (body.includes("wresult") || body.includes("wsignin"))) {
        log.push(`  nested WS-Fed form in postback redirect`);
        await processWsFedForm(body, jar, log, next);
      }
      break;
    }
  }

  return true;
}

// ═══ STEP 1: LOGIN SSO ═══
async function loginSSO(targetBase) {
  const TARGET_DOMAIN = targetBase.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "");
  const SSO_DOMAIN = "sso.api.wcaworld.com";
  const log = [];
  const jar = createJar();

  // ── 1a. GET /Account/Login → segui redirect fino alla pagina SSO ──
  log.push(`[1] GET ${targetBase}/Account/Login`);
  let resp = await fetch(`${targetBase}/Account/Login`, {
    headers: BROWSER_HEADERS,
    redirect: "manual",
  });
  jar.add(TARGET_DOMAIN, resp.headers.raw()["set-cookie"] || []);

  let currentUrl = `${targetBase}/Account/Login`;
  for (let i = 0; i < 8 && resp.status >= 300 && resp.status < 400; i++) {
    const loc = resp.headers.get("location") || "";
    if (!loc) break;
    currentUrl = loc.startsWith("http") ? loc : new URL(loc, currentUrl).href;
    const d = domainOf(currentUrl);
    resp = await fetch(currentUrl, {
      headers: { ...BROWSER_HEADERS, "Cookie": jar.get(d) },
      redirect: "manual",
    });
    jar.add(d, resp.headers.raw()["set-cookie"] || []);
    log.push(`  redirect[${i}] → ${currentUrl.substring(0, 120)} (${resp.status})`);
  }

  const loginHtml = resp.status === 200 ? await resp.text() : "";
  log.push(`[2] Login page: ${loginHtml.length} bytes, final URL: ${currentUrl.substring(0, 100)}`);

  // ── 1b. Trova SSO URL via regex ──
  const ssoMatch = loginHtml.match(/action\s*[:=]\s*['"]?(https:\/\/sso\.api\.wcaworld\.com[^'"&\s]+[^'"]*)/i);
  if (!ssoMatch) {
    log.push("ERROR: SSO URL non trovato nella pagina di login");
    // Log a snippet of the login HTML for debugging
    const snippet = loginHtml.substring(0, 500).replace(/\n/g, " ");
    log.push(`  HTML snippet: ${snippet}`);
    return { ok: false, log, error: "SSO URL not found" };
  }
  const ssoUrl = ssoMatch[1].replace(/&amp;/g, "&");
  log.push(`[3] SSO URL: ${ssoUrl}`);

  // ── 1c. Estrai campi hidden (probabilmente nessuno) ──
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
  log.push(`[4] Hidden fields: ${Object.keys(hiddenFields).length > 0 ? JSON.stringify(hiddenFields) : "nessuno"}`);

  // ── 1d. GET SSO URL first (come farebbe il browser) per ottenere session cookie ──
  log.push(`[5] GET SSO page (pre-POST)`);
  const ssoPageResp = await fetch(ssoUrl, {
    headers: { ...BROWSER_HEADERS, "Cookie": jar.get(SSO_DOMAIN) },
    redirect: "manual",
  });
  jar.add(SSO_DOMAIN, ssoPageResp.headers.raw()["set-cookie"] || []);
  log.push(`  SSO page GET: status=${ssoPageResp.status} cookies=${jar.keys(SSO_DOMAIN).join(",")}`);

  // Se la GET al SSO fa redirect, segui
  if (ssoPageResp.status >= 300 && ssoPageResp.status < 400) {
    const ssoLoc = ssoPageResp.headers.get("location") || "";
    if (ssoLoc) {
      log.push(`  SSO page redirects to: ${ssoLoc.substring(0, 120)}`);
      // Don't follow - just note it
    }
  }
  // Se 200, leggi il body per possibili campi addizionali
  if (ssoPageResp.status === 200) {
    const ssoPageHtml = await ssoPageResp.text();
    log.push(`  SSO page body: ${ssoPageHtml.length} bytes`);
    // Extract any hidden fields from SSO page
    const $sso = cheerio.load(ssoPageHtml);
    $sso("form input[type='hidden']").each((_, inp) => {
      const n = $sso(inp).attr("name");
      const v = $sso(inp).attr("value") || "";
      if (n && !hiddenFields[n]) {
        hiddenFields[n] = v;
        log.push(`  SSO hidden field: ${n}=${v.substring(0, 50)}`);
      }
    });
    // Also look for different action URL in SSO page
    const ssoFormAction = $sso("form").attr("action") || "";
    if (ssoFormAction && ssoFormAction !== ssoUrl) {
      log.push(`  SSO page has different form action: ${ssoFormAction.substring(0, 120)}`);
    }
  }

  // ── 1e. POST credenziali al SSO (SENZA Cookie header - come login fresco) ──
  const postBody = new URLSearchParams();
  for (const [k, v] of Object.entries(hiddenFields)) postBody.set(k, v);
  postBody.set("UserName", USERNAME);
  postBody.set("Password", PASSWORD);
  postBody.set("pwd", PASSWORD);

  log.push(`[6] SSO POST (senza Cookie) → ${ssoUrl.substring(0, 80)}`);
  log.push(`  POST fields: ${[...postBody.keys()].join(", ")}`);

  let ssoResp = await fetch(ssoUrl, {
    method: "POST",
    headers: {
      ...BROWSER_HEADERS,
      "Content-Type": "application/x-www-form-urlencoded",
      "Origin": "https://sso.api.wcaworld.com",
      "Referer": ssoUrl,
      "Sec-Fetch-Site": "same-origin",
      // NO Cookie header first try
    },
    body: postBody.toString(),
    redirect: "manual",
  });
  jar.add(SSO_DOMAIN, ssoResp.headers.raw()["set-cookie"] || []);

  const ssoStatus = ssoResp.status;
  const ssoLocation = ssoResp.headers.get("location") || "";
  log.push(`  SSO POST result: status=${ssoStatus} location=${ssoLocation.substring(0, 200)}`);
  log.push(`  SSO cookies after POST: ${jar.keys(SSO_DOMAIN).join(",")}`);
  log.push(`  SSO .ASPXAUTH value: ${jar.getValue(SSO_DOMAIN, ".ASPXAUTH") ? "len=" + jar.getValue(SSO_DOMAIN, ".ASPXAUTH").length : "NONE"}`);

  // Log ALL Set-Cookie headers from SSO POST
  const ssoCookieHeaders = ssoResp.headers.raw()["set-cookie"] || [];
  for (const c of ssoCookieHeaders) {
    log.push(`  Set-Cookie: ${c.substring(0, 150)}`);
  }

  // ── 1f. Se SSO ritorna 302, potrebbe avere il token nel redirect URL o nel body ──
  if (ssoStatus === 302 || ssoStatus === 301 || ssoStatus === 303) {
    // Check se il redirect URL contiene wresult/wa
    if (ssoLocation.includes("wresult") || ssoLocation.includes("wsignin")) {
      log.push(`  ★ Redirect URL contains WS-Fed token!`);
    }

    // Try to read 302 body (might contain WS-Fed form)
    let ssoBody = "";
    try {
      ssoBody = await ssoResp.text();
      log.push(`  302 body: ${ssoBody.length} bytes, hasForm=${ssoBody.includes("<form")}, hasWresult=${ssoBody.includes("wresult")}`);
    } catch (e) {
      log.push(`  302 body read error: ${e.message}`);
    }

    // If 302 body has WS-Fed form, process it
    if (ssoBody && ssoBody.includes("<form") && (ssoBody.includes("wresult") || ssoBody.includes("wa"))) {
      log.push(`  ★ Processing WS-Fed form from 302 body`);
      await processWsFedForm(ssoBody, jar, log, ssoUrl);
    }

    // Follow the redirect chain
    log.push(`[7] Following SSO redirect chain`);
    let loc = ssoLocation;
    for (let i = 0; i < 10 && loc; i++) {
      const url = loc.startsWith("http") ? loc : new URL(loc, ssoUrl).href;
      const d = domainOf(url);
      log.push(`  chain[${i}]: GET ${url.substring(0, 200)} (domain=${d})`);

      const r = await fetch(url, {
        headers: { ...BROWSER_HEADERS, "Cookie": jar.get(d) },
        redirect: "manual",
      });
      jar.add(d, r.headers.raw()["set-cookie"] || []);

      // Log Set-Cookie details
      const newCookies = r.headers.raw()["set-cookie"] || [];
      for (const c of newCookies) {
        const name = c.split("=")[0];
        if (name === ".ASPXAUTH") {
          const val = c.split(";")[0].split("=").slice(1).join("=");
          log.push(`  ★ .ASPXAUTH set on ${d}: len=${val.length} empty=${val === ""}`);
        }
      }

      log.push(`  → status=${r.status} cookies=${jar.keys(d).join(",")}`);

      // If 200, check for WS-Fed form in body
      if (r.status === 200) {
        const body = await r.text();
        log.push(`  200 body: ${body.length} bytes hasForm=${body.includes("<form")} hasWresult=${body.includes("wresult")}`);

        if (body.includes("<form") && (body.includes("wresult") || body.includes("wsignin"))) {
          log.push(`  ★ WS-Fed form found in redirect chain!`);
          await processWsFedForm(body, jar, log, url);
        }
        break;
      }

      loc = r.headers.get("location") || "";
    }
  }

  // ── 1g. Se SSO ritorna 200, cerca WS-Fed form nel body ──
  if (ssoStatus === 200) {
    const ssoBody = await ssoResp.text();
    log.push(`[7] SSO returned 200: ${ssoBody.length} bytes hasForm=${ssoBody.includes("<form")}`);

    if (ssoBody.includes("<form")) {
      const processed = await processWsFedForm(ssoBody, jar, log, ssoUrl);
      if (!processed) {
        log.push(`  No WS-Fed form found in SSO 200 body`);
        // Check if it's a login error page
        if (ssoBody.includes("invalid") || ssoBody.includes("error") || ssoBody.includes("incorrect")) {
          log.push(`  ⚠ SSO might have rejected credentials`);
        }
      }
    }
  }

  // ── 1h. Se ANCORA non autenticati, riprova con Cookie header ──
  const targetAspx = jar.getValue(TARGET_DOMAIN, ".ASPXAUTH");
  if (!targetAspx || targetAspx.length < 10) {
    log.push(`[8] TARGET .ASPXAUTH insufficiente (${targetAspx ? "len=" + targetAspx.length : "NONE"}), retry con Cookie`);

    const ssoResp2 = await fetch(ssoUrl, {
      method: "POST",
      headers: {
        ...BROWSER_HEADERS,
        "Content-Type": "application/x-www-form-urlencoded",
        "Origin": "https://sso.api.wcaworld.com",
        "Referer": ssoUrl,
        "Cookie": jar.get(SSO_DOMAIN), // questa volta CON cookie
        "Sec-Fetch-Site": "same-origin",
      },
      body: postBody.toString(),
      redirect: "manual",
    });
    jar.add(SSO_DOMAIN, ssoResp2.headers.raw()["set-cookie"] || []);
    const status2 = ssoResp2.status;
    const loc2 = ssoResp2.headers.get("location") || "";
    log.push(`  Retry SSO POST: status=${status2} location=${loc2.substring(0, 200)}`);

    // Same processing as above
    if (status2 === 200) {
      const body2 = await ssoResp2.text();
      if (body2.includes("<form")) {
        await processWsFedForm(body2, jar, log, ssoUrl);
      }
    } else if (status2 >= 300 && status2 < 400) {
      let body2 = "";
      try { body2 = await ssoResp2.text(); } catch(e) {}
      if (body2 && body2.includes("<form")) {
        await processWsFedForm(body2, jar, log, ssoUrl);
      }

      let retryLoc = loc2;
      for (let i = 0; i < 10 && retryLoc; i++) {
        const url = retryLoc.startsWith("http") ? retryLoc : new URL(retryLoc, ssoUrl).href;
        const d = domainOf(url);
        const r = await fetch(url, {
          headers: { ...BROWSER_HEADERS, "Cookie": jar.get(d) },
          redirect: "manual",
        });
        jar.add(d, r.headers.raw()["set-cookie"] || []);
        log.push(`  retry chain[${i}]: ${url.substring(0, 120)} → ${r.status}`);

        if (r.status === 200) {
          const body = await r.text();
          if (body.includes("<form") && (body.includes("wresult") || body.includes("wsignin"))) {
            await processWsFedForm(body, jar, log, url);
          }
          break;
        }
        retryLoc = r.headers.get("location") || "";
      }
    }
  }

  // ── 1i. Warmup: visita /Directory per confermare autenticazione ──
  log.push(`[9] Warmup /Directory`);
  const targetCookies = jar.get(TARGET_DOMAIN);
  log.push(`  TARGET cookies: ${jar.keys(TARGET_DOMAIN).join(",")}`);
  log.push(`  TARGET .ASPXAUTH: ${jar.getValue(TARGET_DOMAIN, ".ASPXAUTH") ? "len=" + jar.getValue(TARGET_DOMAIN, ".ASPXAUTH").length : "NONE/EMPTY"}`);
  log.push(`  SSO cookies: ${jar.keys(SSO_DOMAIN).join(",")}`);

  let warmupResp = await fetch(`${targetBase}/Directory`, {
    headers: { ...BROWSER_HEADERS, "Cookie": targetCookies },
    redirect: "manual",
  });
  jar.add(TARGET_DOMAIN, warmupResp.headers.raw()["set-cookie"] || []);

  // Follow redirects for warmup (could go through CheckLoggedIn)
  let wLoc = warmupResp.headers.get("location") || "";
  for (let i = 0; i < 5 && wLoc; i++) {
    const wNext = wLoc.startsWith("http") ? wLoc : new URL(wLoc, `${targetBase}/Directory`).href;
    const wD = domainOf(wNext);
    log.push(`  warmup redirect[${i}]: ${wNext.substring(0, 120)} (${wD})`);
    warmupResp = await fetch(wNext, {
      headers: { ...BROWSER_HEADERS, "Cookie": jar.get(wD) },
      redirect: "manual",
    });
    jar.add(wD, warmupResp.headers.raw()["set-cookie"] || []);
    wLoc = warmupResp.headers.get("location") || "";

    if (warmupResp.status === 200) {
      const wBody = await warmupResp.text();
      // CheckLoggedIn might return WS-Fed form
      if (wBody.includes("<form") && (wBody.includes("wresult") || wBody.includes("wsignin"))) {
        log.push(`  ★ WS-Fed form in warmup redirect!`);
        await processWsFedForm(wBody, jar, log, wNext);
        // Re-fetch directory with new cookies
        warmupResp = await fetch(`${targetBase}/Directory`, {
          headers: { ...BROWSER_HEADERS, "Cookie": jar.get(TARGET_DOMAIN) },
          redirect: "manual",
        });
        jar.add(TARGET_DOMAIN, warmupResp.headers.raw()["set-cookie"] || []);
      }
      break;
    }
  }

  let authenticated = false;
  if (warmupResp.status === 200) {
    const wHtml = await warmupResp.text();
    const hasLogout = /logout|sign.?out/i.test(wHtml);
    const hasPassword = wHtml.includes('type="password"');
    log.push(`  Warmup result: hasLogout=${hasLogout} hasPassword=${hasPassword} len=${wHtml.length}`);
    authenticated = hasLogout && !hasPassword;
  } else {
    log.push(`  Warmup status: ${warmupResp.status}`);
  }

  log.push(`[10] FINAL STATE: authenticated=${authenticated}`);
  log.push(`  jar dump: ${JSON.stringify(jar.dump())}`);

  const finalCookies = jar.get(TARGET_DOMAIN);
  const ssoCookies = jar.get(SSO_DOMAIN);

  return {
    ok: authenticated,
    cookies: finalCookies,
    ssoCookies,
    authenticated,
    log,
  };
}

// ═══ STEP 2: FETCH PROFILO + ESTRAI CONTATTI ═══
async function fetchAndExtract(wcaId, cookies, baseUrl, ssoCookies) {
  const url = `${baseUrl}/directory/members/${wcaId}`;
  const jar = createJar();
  const TARGET_DOMAIN = baseUrl.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, "");
  // Seed jar with provided cookies
  if (cookies) {
    for (const c of cookies.split("; ")) {
      const eq = c.indexOf("=");
      if (eq > 0) {
        if (!jar.dump()[TARGET_DOMAIN]) jar.add(TARGET_DOMAIN, [c]);
        else jar.add(TARGET_DOMAIN, [c]);
      }
    }
  }

  let currentUrl = url;
  let resp;
  for (let i = 0; i < 5; i++) {
    const isSSO = currentUrl.includes("sso.api.wcaworld.com");
    resp = await fetch(currentUrl, {
      headers: {
        ...BROWSER_HEADERS,
        "Cookie": isSSO ? (ssoCookies || cookies) : cookies,
        "Referer": baseUrl + "/Directory",
      },
      redirect: "manual",
      timeout: 15000,
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

  // Strategy 1: .contactperson_row → .profile_row
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

  // Strategy 2: regex fallback
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

  // Strategy 3: mailto fallback
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
  const mode = req.query.mode;

  // Diagnostic mode: only run SSO login and return full log
  if (mode === "diag") {
    const baseUrl = NETWORKS[domain] || "https://www.wcaworld.com";
    const login = await loginSSO(baseUrl);
    return res.json({
      mode: "diagnostic",
      domain,
      authenticated: login.ok,
      log: login.log,
    });
  }

  if (!wcaId) return res.status(400).json({ error: "wcaId richiesto. Uso: /api/fetch-contacts?wcaId=24995 oppure ?mode=diag" });

  const baseUrl = NETWORKS[domain] || "https://www.wcaworld.com";

  try {
    const login = await loginSSO(baseUrl);
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
