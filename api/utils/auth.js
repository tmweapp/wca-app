/**
 * auth.js v30 — RISCRITTO DA ZERO
 *
 * Approccio: simulare ESATTAMENTE il browser.
 * 1. GET /Account/Login → segui tutti i redirect → ottieni la pagina con il form
 * 2. Parsa il form con cheerio → prendi action URL + TUTTI i campi hidden
 * 3. POST il form con username/password → segui TUTTI i redirect
 * 4. Se trovi un altro form HTML (WS-Fed postback) → POST pure quello
 * 5. Continua fino a che non arrivi a una pagina 200 senza form
 *
 * Tutto con un unico cookie string che accumula TUTTI i cookies di TUTTI i domini.
 * Come fa il browser.
 */
const fetch = require("node-fetch");
const cheerio = require("cheerio");

const BASE = "https://www.wcaworld.com";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const SUPABASE_URL = process.env.SUPABASE_URL || "https://dlldkrzoxvjxpgkkttxu.supabase.co";
const SUPABASE_KEY = (process.env.SUPABASE_SERVICE_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRsbGRrcnpveHZqeHBna2t0dHh1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1ODcyMDU4NCwiZXhwIjoyMDc0Mjk2NTg0fQ.py_d96kA6Mqvi0ugBm4gmIlJSoOC_KbwUM7cgDR-O_E").trim();

// ═══ COOKIE HELPERS ═══
// Semplice: un oggetto { nome: valore } — come fa il browser, TUTTI i cookies insieme
function parseCookies(cookieStr) {
  const map = {};
  if (!cookieStr) return map;
  for (const part of cookieStr.split("; ")) {
    const eq = part.indexOf("=");
    if (eq > 0) map[part.substring(0, eq)] = part.substring(eq + 1);
  }
  return map;
}

function cookiesToString(map) {
  return Object.entries(map).map(([k, v]) => `${k}=${v}`).join("; ");
}

function mergeSetCookies(map, setCookieHeaders) {
  if (!setCookieHeaders) return;
  for (const raw of setCookieHeaders) {
    const c = raw.split(";")[0];
    const eq = c.indexOf("=");
    if (eq > 0) {
      const name = c.substring(0, eq);
      const val = c.substring(eq + 1);
      // Non aggiungere cookies vuoti che sovrascrivono quelli validi
      if (val || !map[name]) map[name] = val;
    }
  }
}

// ═══ FORM PARSER ═══
// Trova il form di login nella pagina — preferisce form con password field o action SSO
function parseForm(html, preferAction, baseUrl) {
  const $ = cheerio.load(html);
  let bestForm = null;
  let bestScore = -1;

  $("form").each((_, form) => {
    let action = $(form).attr("action") || "";
    action = action.replace(/&amp;/g, "&");

    // Risolvi URL relativi
    if (action && !action.startsWith("http") && baseUrl) {
      try { action = new URL(action, baseUrl).href; } catch(e) {}
    }

    const fields = {};
    let hasPassword = false;
    $(form).find("input").each((_, inp) => {
      const name = $(inp).attr("name");
      const val = $(inp).attr("value") || "";
      const type = ($(inp).attr("type") || "").toLowerCase();
      if (type === "password") hasPassword = true;
      if (name && type !== "submit") fields[name] = val;
    });

    // Punteggio: form con password field o action SSO vince
    let score = 0;
    if (hasPassword) score += 10;
    if (preferAction && action.includes(preferAction)) score += 20;
    if (action.includes("sso")) score += 5;
    if (fields["UserName"] !== undefined || fields["Password"] !== undefined) score += 10;
    // Penalizza form inutili (language selector, search, etc.)
    if (action.includes("SetLanguage") || action.includes("Search")) score -= 50;

    if (score > bestScore) {
      bestScore = score;
      bestForm = { action, fields };
    }
  });

  return bestForm;
}

// Helper: estrai origin da URL (safe)
function safeOrigin(url) {
  try { return new URL(url).origin; } catch(e) { return ""; }
}

// ═══ HTTP REQUEST con cookie tracking ═══
// Fa UNA request, aggiorna cookies, ritorna { resp, body? }
async function doRequest(url, cookies, opts = {}) {
  const headers = {
    "User-Agent": UA,
    "Cookie": cookiesToString(cookies),
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "en-US,en;q=0.9",
    ...opts.headers,
  };

  const fetchOpts = {
    method: opts.method || "GET",
    headers,
    redirect: "manual",
    timeout: opts.timeout || 15000,
  };
  if (opts.body) fetchOpts.body = opts.body;

  const resp = await fetch(url, fetchOpts);
  mergeSetCookies(cookies, resp.headers.raw()["set-cookie"] || []);
  return resp;
}

// ═══ SEGUI REDIRECT CHAIN ═══
// Segue fino a 10 redirect, processa qualsiasi form HTML trovato lungo la strada
async function followAll(startUrl, cookies, log) {
  let url = startUrl;
  let lastHtml = "";
  let lastStatus = 0;

  for (let i = 0; i < 15; i++) {
    log.push(`  [${i}] ${url.substring(0, 120)}`);
    const resp = await doRequest(url, cookies);
    lastStatus = resp.status;

    if (resp.status >= 300 && resp.status < 400) {
      const loc = resp.headers.get("location") || "";
      if (!loc) { log.push(`  [${i}] redirect senza location, stop`); break; }
      url = loc.startsWith("http") ? loc : new URL(loc, url).href;
      // Consuma il body se c'è
      try { await resp.text(); } catch(e) {}
      continue;
    }

    // Status 200 — leggi il body
    const html = await resp.text();
    lastHtml = html;
    log.push(`  [${i}] status=${resp.status} len=${html.length} hasForm=${html.includes("<form")}`);

    // Se c'è un form auto-submit (WS-Fed postback), processalo
    if (html.includes("<form")) {
      const form = parseForm(html, null, url);
      if (form && form.action && Object.keys(form.fields).length > 0) {
        // Controlla che sia un WS-Fed form (ha wresult o wa o simili)
        const fieldNames = Object.keys(form.fields);
        const isAutoSubmit = fieldNames.some(n => /wresult|wa|wctx|wtrealm|wsignin/i.test(n));

        if (isAutoSubmit) {
          log.push(`  [${i}] WS-Fed form → POST ${form.action.substring(0, 80)} fields=[${fieldNames.join(",")}]`);
          const postBody = new URLSearchParams();
          for (const [k, v] of Object.entries(form.fields)) postBody.set(k, v);

          const postResp = await doRequest(form.action, cookies, {
            method: "POST",
            headers: {
              "Content-Type": "application/x-www-form-urlencoded",
              "Referer": url,
              "Origin": safeOrigin(form.action),
            },
            body: postBody.toString(),
          });

          if (postResp.status >= 300 && postResp.status < 400) {
            const loc = postResp.headers.get("location") || "";
            if (loc) {
              url = loc.startsWith("http") ? loc : new URL(loc, form.action).href;
              try { await postResp.text(); } catch(e) {}
              continue; // segui il redirect
            }
          }

          // 200 response — potrebbe avere un ALTRO form
          const postHtml = await postResp.text();
          lastHtml = postHtml;
          lastStatus = postResp.status;
          log.push(`  [${i}] WS-Fed POST result: status=${postResp.status} len=${postHtml.length}`);

          if (postHtml.includes("<form")) {
            // Ricorsione: un altro form? Seguiamolo
            const form2 = parseForm(postHtml, null, url);
            if (form2 && form2.action && Object.keys(form2.fields).some(n => /wresult|wa|wctx/i.test(n))) {
              log.push(`  [${i}] ANOTHER WS-Fed form → POST ${form2.action.substring(0, 80)}`);
              const postBody2 = new URLSearchParams();
              for (const [k, v] of Object.entries(form2.fields)) postBody2.set(k, v);
              const postResp2 = await doRequest(form2.action, cookies, {
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded", "Referer": url },
                body: postBody2.toString(),
              });
              if (postResp2.status >= 300 && postResp2.status < 400) {
                const loc2 = postResp2.headers.get("location") || "";
                if (loc2) { url = loc2.startsWith("http") ? loc2 : new URL(loc2, form2.action).href; try { await postResp2.text(); } catch(e) {} continue; }
              }
              lastHtml = await postResp2.text();
              lastStatus = postResp2.status;
            }
          }
          continue;
        }
      }
    }

    // Pagina normale senza form auto-submit → stop
    break;
  }

  return { html: lastHtml, status: lastStatus };
}

// ═══ SSO LOGIN — DA ZERO ═══
async function ssoLogin(username, password, targetBase) {
  username = username || process.env.WCA_USERNAME || "tmsrlmin";
  password = password || process.env.WCA_PASSWORD || "G0u3v!VvCn";
  targetBase = targetBase || BASE;

  const cookies = {}; // UN SOLO oggetto cookies per TUTTO
  const log = [];

  log.push(`=== SSO LOGIN target=${targetBase} ===`);

  try {
    // ═══ STEP 1: GET la pagina di login, seguendo tutti i redirect ═══
    log.push("STEP 1: GET login page + follow redirects");
    const loginPageResult = await followAll(`${targetBase}/Account/Login`, cookies, log);

    if (!loginPageResult.html) {
      log.push("ERROR: nessun HTML dalla pagina di login");
      console.log(log.join("\n"));
      return { success: false, error: "No login page HTML", log };
    }

    // ═══ STEP 2: Trova il form di login ═══
    log.push("STEP 2: Parse login form");
    const form = parseForm(loginPageResult.html, "sso.api.wcaworld.com", `${targetBase}/Account/Login`);

    if (!form || !form.action) {
      // Forse siamo già loggati? Controlla
      if (/logout|sign.?out/i.test(loginPageResult.html)) {
        log.push("Già loggati! (logout link trovato)");
        console.log(log.join("\n"));
        return { success: true, cookies: cookiesToString(cookies), log };
      }
      log.push("ERROR: nessun form trovato nella pagina di login");
      log.push("HTML snippet: " + loginPageResult.html.substring(0, 500));
      console.log(log.join("\n"));
      return { success: false, error: "No login form found", log };
    }

    const fieldNames = Object.keys(form.fields);
    log.push(`Form action: ${form.action.substring(0, 100)}`);
    log.push(`Form fields: ${fieldNames.join(", ")}`);

    // ═══ STEP 3: POST il form con credenziali ═══
    log.push("STEP 3: POST login form with credentials");

    // Metti TUTTI i campi hidden + le credenziali
    const postBody = new URLSearchParams();
    for (const [k, v] of Object.entries(form.fields)) {
      postBody.set(k, v);
    }
    postBody.set("UserName", username);
    postBody.set("Password", password);
    postBody.set("pwd", password);

    log.push(`POST fields: ${[...postBody.keys()].join(", ")}`);

    const loginResp = await doRequest(form.action, cookies, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        "Origin": safeOrigin(form.action),
        "Referer": form.action,
      },
      body: postBody.toString(),
    });

    log.push(`POST response: status=${loginResp.status}`);

    // ═══ STEP 4: Segui TUTTO quello che viene dopo il POST ═══
    log.push("STEP 4: Follow all post-login redirects and forms");

    let nextUrl = null;

    if (loginResp.status >= 300 && loginResp.status < 400) {
      nextUrl = loginResp.headers.get("location") || "";
      if (nextUrl && !nextUrl.startsWith("http")) nextUrl = new URL(nextUrl, form.action).href;
      try { await loginResp.text(); } catch(e) {}
    } else if (loginResp.status === 200) {
      // Body potrebbe contenere WS-Fed form
      const postHtml = await loginResp.text();
      log.push(`POST body len=${postHtml.length} hasForm=${postHtml.includes("<form")}`);

      if (postHtml.includes("<form")) {
        const wsFedForm = parseForm(postHtml);
        if (wsFedForm && wsFedForm.action) {
          log.push(`WS-Fed form found → ${wsFedForm.action.substring(0, 80)}`);
          const wsFedBody = new URLSearchParams();
          for (const [k, v] of Object.entries(wsFedForm.fields)) wsFedBody.set(k, v);

          const wsFedResp = await doRequest(wsFedForm.action, cookies, {
            method: "POST",
            headers: {
              "Content-Type": "application/x-www-form-urlencoded",
              "Referer": form.action,
              "Origin": safeOrigin(wsFedForm.action),
            },
            body: wsFedBody.toString(),
          });

          if (wsFedResp.status >= 300 && wsFedResp.status < 400) {
            nextUrl = wsFedResp.headers.get("location") || "";
            if (nextUrl && !nextUrl.startsWith("http")) nextUrl = new URL(nextUrl, wsFedForm.action).href;
            try { await wsFedResp.text(); } catch(e) {}
          } else {
            const wsFedHtml = await wsFedResp.text();
            log.push(`WS-Fed POST result: status=${wsFedResp.status} len=${wsFedHtml.length}`);
            // Potrebbe esserci un ALTRO form
            if (wsFedHtml.includes("<form")) {
              const form3 = parseForm(wsFedHtml);
              if (form3 && form3.action) {
                const body3 = new URLSearchParams();
                for (const [k, v] of Object.entries(form3.fields)) body3.set(k, v);
                const resp3 = await doRequest(form3.action, cookies, {
                  method: "POST",
                  headers: { "Content-Type": "application/x-www-form-urlencoded", "Referer": wsFedForm.action },
                  body: body3.toString(),
                });
                if (resp3.status >= 300 && resp3.status < 400) {
                  nextUrl = resp3.headers.get("location") || "";
                  if (nextUrl && !nextUrl.startsWith("http")) nextUrl = new URL(nextUrl, form3.action).href;
                  try { await resp3.text(); } catch(e) {}
                }
              }
            }
          }
        }
      }
    }

    // Segui la catena di redirect rimanente
    if (nextUrl) {
      log.push(`Following remaining chain from: ${nextUrl.substring(0, 120)}`);
      await followAll(nextUrl, cookies, log);
    }

    // ═══ STEP 5: Verifica — visita /Directory sul target ═══
    log.push("STEP 5: Verify — GET /Directory");
    const verifyResult = await followAll(`${targetBase}/Directory`, cookies, log);

    const hasAuth = cookies[".ASPXAUTH"];
    const hasLogout = /logout|sign.?out/i.test(verifyResult.html || "");
    const hasPassword = (verifyResult.html || "").includes('type="password"');

    log.push(`RESULT: hasASPXAUTH=${!!hasAuth} hasLogout=${hasLogout} hasPassword=${hasPassword}`);
    log.push(`Cookies: ${Object.keys(cookies).join(", ")}`);

    const cookieStr = cookiesToString(cookies);
    log.push(`Cookie string length: ${cookieStr.length}`);

    console.log(log.join("\n"));

    if (!hasLogout) {
      return { success: false, error: "Login completed but NOT authenticated (no logout link)", cookies: cookieStr, log };
    }

    return { success: true, cookies: cookieStr, log };

  } catch (e) {
    log.push(`EXCEPTION: ${e.message}`);
    console.log(log.join("\n"));
    return { success: false, error: e.message, log };
  }
}

// ═══ SUPABASE CACHE ═══
function domainToId(domain) {
  if (!domain || domain === "wcaworld.com") return 1;
  let hash = 100;
  for (let i = 0; i < domain.length; i++) hash = ((hash * 31 + domain.charCodeAt(i)) % 9000) + 100;
  return hash;
}

async function getCachedCookies(domain) {
  const id = domainToId(domain);
  try {
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/wca_session?select=*&id=eq.${id}`, {
      headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}` },
      timeout: 5000,
    });
    if (!resp.ok) return null;
    const rows = await resp.json();
    if (!rows || rows.length === 0) return null;
    const row = rows[0];
    const age = Date.now() - new Date(row.updated_at).getTime();
    if (age > 30 * 60 * 1000) { console.log(`[auth] Cache scaduta (${Math.round(age/60000)}min) domain=${domain||"wcaworld.com"}`); return null; }
    console.log(`[auth] Cache hit (${Math.round(age/1000)}s) domain=${domain||"wcaworld.com"}`);
    return { cookies: row.cookies, ssoCookies: row.sso_cookies || "" };
  } catch (e) { console.log("[auth] Cache read error: " + e.message); return null; }
}

async function saveCookiesToCache(cookies, domain, ssoCookies) {
  const id = domainToId(domain);
  try {
    const data = { id, cookies, updated_at: new Date().toISOString() };
    if (ssoCookies) data.sso_cookies = ssoCookies;
    await fetch(`${SUPABASE_URL}/rest/v1/wca_session`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json", "apikey": SUPABASE_KEY,
        "Authorization": `Bearer ${SUPABASE_KEY}`, "Prefer": "resolution=merge-duplicates",
      },
      body: JSON.stringify(data),
      timeout: 5000,
    });
    console.log(`[auth] Cache saved domain=${domain||"wcaworld.com"} id=${id}`);
  } catch (e) { console.log("[auth] Cache save error: " + e.message); }
}

async function testCookies(cookies, targetBase) {
  const testBase = targetBase || BASE;
  try {
    const resp = await fetch(`${testBase}/Directory`, {
      headers: { "User-Agent": UA, "Cookie": cookies },
      redirect: "manual", timeout: 8000,
    });
    const loc = resp.headers.get("location") || "";
    if (loc.toLowerCase().includes("/login") || loc.toLowerCase().includes("/signin")) return false;
    if (resp.status === 200) {
      const html = await resp.text();
      if (html.includes('type="password"')) return false;
      if (!/logout|sign.?out/i.test(html)) return false;
      if (!cookies.includes(".ASPXAUTH")) return false;
      return true;
    }
    return resp.status >= 200 && resp.status < 400;
  } catch (e) { return false; }
}

module.exports = {
  getCachedCookies,
  saveCookiesToCache,
  testCookies,
  ssoLogin,
  BASE,
  UA,
  SUPABASE_URL,
  SUPABASE_KEY,
};
