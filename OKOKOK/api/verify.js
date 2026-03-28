const fetch = require("node-fetch");
const cheerio = require("cheerio");

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// Mappa network → dominio
const NETWORK_DOMAINS = {
  "WCA First": "https://www.wcaworld.com",
  "WCA Advanced Professionals": "https://www.wcaworld.com",
  "WCA China Global": "https://www.wcachinaglobal.com",
  "WCA Inter Global": "https://www.wcainterglobal.com",
  "Lognet Global": "https://www.lognetglobal.com",
  "Global Affinity Alliance": "https://www.globalaffinityalliance.com",
  "Elite Global Logistics Network": "https://www.elitegln.com",
  "InFinite Connection (IFC8)": "https://www.ifc8.com",
  "WCA Projects": "https://www.wcaprojects.com",
  "WCA Dangerous Goods": "https://www.wcadangerousgoods.com",
  "WCA Perishables": "https://www.wcaperishables.com",
  "WCA Time Critical": "https://www.wcatimecritical.com",
  "WCA Relocations": "https://www.wcarelocations.com",
  "WCA Pharma": "https://www.wcapharma.com",
  "WCA Vendors": "https://www.wcavendors.com",
  "WCA eCommerce Solutions": "https://www.wcaecommerce.com",
  "WCA Live Events and Expo": "https://www.wcaliveevents.com",
};

// Importa extractProfile da scrape.js (stessa logica)
// Per evitare duplicazioni, copiamo la funzione tryFetchUrl
async function tryFetchUrl(url, cookies) {
  let currentUrl = url;
  let redirectCount = 0;
  let resp;
  while (redirectCount < 5) {
    resp = await fetch(currentUrl, {
      headers: {
        "User-Agent": UA, "Cookie": cookies || "",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Referer": url.match(/^https?:\/\/[^/]+/)?.[0] + "/Directory",
      },
      redirect: "manual", timeout: 15000,
    });
    const newCookies = (resp.headers.raw?.()?.["set-cookie"] || []).map(c => c.split(";")[0]);
    if (newCookies.length) {
      const cookieMap = {};
      for (const c of (cookies||"").split("; ")) { const eq = c.indexOf("="); if (eq > 0) cookieMap[c.substring(0, eq)] = c; }
      for (const c of newCookies) { const eq = c.indexOf("="); if (eq > 0) cookieMap[c.substring(0, eq)] = c; }
      cookies = Object.values(cookieMap).join("; ");
    }
    if (resp.status >= 300 && resp.status < 400) {
      const loc = resp.headers.get("location") || "";
      if (!loc) break;
      currentUrl = loc.startsWith("http") ? loc : new URL(loc, currentUrl).href;
      if (currentUrl.toLowerCase().includes("/login")) return { loginRedirect: true };
      redirectCount++;
      continue;
    }
    break;
  }
  if (resp.status === 404) return null;
  const html = await resp.text();
  if (html.includes('type="password"') || currentUrl.toLowerCase().includes("/login")) return { loginRedirect: true };
  const $ = cheerio.load(html);
  const h1 = $("h1").first().text().trim();
  if (/member\s*not\s*found|not\s*found.*try\s*again|page\s*not\s*found/i.test(h1)) return null;
  return { $, html, h1 };
}

// SSO login con cookie separati per dominio (come un browser reale)
async function ssoLogin(baseDomain) {
  const base = baseDomain || "https://www.wcaworld.com";
  const username = process.env.WCA_USERNAME || "tmsrlmin";
  const password = process.env.WCA_PASSWORD || "G0u3v!VvCn";
  const WCA_DOMAIN = new URL(base).hostname;
  const SSO_DOMAIN = "sso.api.wcaworld.com";

  // Simple per-domain cookie jar
  const jar = {};
  const addC = (dom, hdrs) => {
    if (!jar[dom]) jar[dom] = {};
    for (const raw of hdrs) { const c = raw.split(";")[0]; const eq = c.indexOf("="); if (eq > 0) jar[dom][c.substring(0, eq)] = c; }
  };
  const getC = (dom) => jar[dom] ? Object.values(jar[dom]).join("; ") : "";
  const keysC = (dom) => jar[dom] ? Object.keys(jar[dom]) : [];

  // Step 1: GET login page
  let resp = await fetch(`${base}/Account/Login`, { headers: { "User-Agent": UA }, redirect: "manual" });
  addC(WCA_DOMAIN, resp.headers.raw()["set-cookie"] || []);
  let currentUrl = `${base}/Account/Login`;
  let rc = 0;
  while (resp.status >= 300 && resp.status < 400 && rc < 5) {
    const loc = resp.headers.get("location") || "";
    currentUrl = loc.startsWith("http") ? loc : new URL(loc, currentUrl).href;
    resp = await fetch(currentUrl, { headers: { "User-Agent": UA, "Cookie": getC(WCA_DOMAIN) }, redirect: "manual" });
    addC(WCA_DOMAIN, resp.headers.raw()["set-cookie"] || []);
    rc++;
  }
  const loginHtml = resp.status === 200 ? await resp.text() : "";
  const ssoUrlMatch = loginHtml.match(/action\s*[:=]\s*['"]?(https:\/\/sso\.api\.wcaworld\.com[^'"&\s]+[^'"]*)/i);
  if (!ssoUrlMatch) { console.log(`[verify] SSO URL not found on ${base}`); return null; }
  const ssoUrl = ssoUrlMatch[1].replace(/&amp;/g, "&");

  // Step 2: POST credentials to SSO (SSO domain cookies only)
  const ssoResp = await fetch(ssoUrl, {
    method: "POST",
    headers: { "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded", "Origin": "https://sso.api.wcaworld.com", "Referer": ssoUrl },
    body: `UserName=${encodeURIComponent(username)}&Password=${encodeURIComponent(password)}&pwd=${encodeURIComponent(password)}`,
    redirect: "manual",
  });
  addC(SSO_DOMAIN, ssoResp.headers.raw()["set-cookie"] || []);
  if (!keysC(SSO_DOMAIN).includes(".ASPXAUTH")) { console.log("[verify] SSO failed - no ASPXAUTH"); return null; }

  // Step 3: Follow redirect chain — send domain-appropriate cookies only
  let callbackUrl = ssoResp.headers.get("location") || "";
  let followCount = 0;
  while (callbackUrl && followCount < 8) {
    const cbUrl = callbackUrl.startsWith("http") ? callbackUrl : new URL(callbackUrl, ssoUrl).href;
    const cbDomain = cbUrl.includes("sso.api.wcaworld.com") ? SSO_DOMAIN : WCA_DOMAIN;
    const cbResp = await fetch(cbUrl, { headers: { "User-Agent": UA, "Cookie": getC(cbDomain) }, redirect: "manual" });
    addC(cbDomain, cbResp.headers.raw()["set-cookie"] || []);
    const nextLoc = cbResp.headers.get("location") || "";
    callbackUrl = nextLoc ? (nextLoc.startsWith("http") ? nextLoc : new URL(nextLoc, cbUrl).href) : null;
    if (cbResp.status === 200) break;
    followCount++;
  }

  // Step 4: Warmup — visit /Directory with WCA cookies
  try {
    let wr = await fetch(`${base}/Directory`, { headers: { "User-Agent": UA, "Cookie": getC(WCA_DOMAIN) }, redirect: "manual" });
    addC(WCA_DOMAIN, wr.headers.raw()["set-cookie"] || []);
    let wLoc = wr.headers.get("location") || "";
    let wCount = 0;
    while (wLoc && wCount < 3) {
      const wNext = wLoc.startsWith("http") ? wLoc : new URL(wLoc, `${base}/Directory`).href;
      wr = await fetch(wNext, { headers: { "User-Agent": UA, "Cookie": getC(WCA_DOMAIN) }, redirect: "manual" });
      addC(WCA_DOMAIN, wr.headers.raw()["set-cookie"] || []);
      wLoc = wr.headers.get("location") || ""; wCount++;
    }
  } catch (e) { console.log(`[verify] Warmup error: ${e.message}`); }

  const wcaCookies = getC(WCA_DOMAIN);
  console.log(`[verify] SSO on ${base}: WCA hasAuth=${keysC(WCA_DOMAIN).includes(".ASPXAUTH")} keys=${keysC(WCA_DOMAIN).join(",")}`);
  return wcaCookies;
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  try {
    const { wcaId, network } = req.body || {};
    if (!wcaId) return res.status(400).json({ error: "wcaId richiesto" });
    if (!network) return res.status(400).json({ error: "network richiesto" });

    const domain = NETWORK_DOMAINS[network];
    if (!domain) return res.status(400).json({ error: `Network sconosciuto: ${network}`, availableNetworks: Object.keys(NETWORK_DOMAINS) });

    // SSO login interno — stesso IP della fetch
    const cookies = await ssoLogin(domain);
    if (!cookies) return res.status(500).json({ error: "Login interno fallito" });

    const url = `${domain}/directory/members/${wcaId}`;
    console.log(`[verify] Checking wcaId=${wcaId} on ${network} → ${url}`);

    const result = await tryFetchUrl(url, cookies);
    if (!result) {
      console.log(`[verify] ${wcaId} NOT found on ${network}`);
      return res.json({ success: true, found: false, wcaId, network, domain });
    }
    if (result.loginRedirect) {
      return res.json({ success: false, error: "login_required", wcaId, network });
    }

    // Usa extractProfile inline (semplificato per verify — restituisce dati base)
    const { $, html } = result;
    console.log(`[verify] ${wcaId} FOUND on ${network}, extracting profile...`);

    const profile = miniExtract($, wcaId, url);
    return res.json({ success: true, found: true, wcaId, network, domain, profile });
  } catch (err) {
    console.log(`[verify] Error: ${err.message}`);
    return res.status(500).json({ success: false, error: err.message });
  }
};

function miniExtract($, wcaId, sourceUrl) {
  const result = {
    wca_id: wcaId, state: "ok", company_name: "", logo_url: null, branch: "",
    gm_coverage: null, gm_status_text: "", enrolled_offices: [], enrolled_since: "",
    expires: "", networks: [], profile_text: "", address: "", mailing: "", phone: "",
    fax: "", emergency_call: "", website: "", email: "", contacts: [], services: [],
    certifications: [], branch_cities: [], source_url: sourceUrl,
  };

  const h1 = $("h1.company, h1").first().text().trim();
  result.company_name = h1;
  if (!h1 || /not\s*found|error|404/i.test(h1)) return { wca_id: wcaId, state: "not_found" };

  // Logo
  const resolveUrl = (src, base) => {
    if (!src || src.length < 5) return null;
    const domain = sourceUrl.match(/^https?:\/\/[^/]+/)?.[0] || "https://www.wcaworld.com";
    if (src.startsWith("//")) return "https:" + src;
    if (src.startsWith("/")) return domain + src;
    if (!src.startsWith("http")) return domain + "/" + src;
    return src;
  };
  $("img[src]").each((_, el) => {
    if (result.logo_url) return;
    const src = $(el).attr("src") || "";
    const lower = src.toLowerCase();
    if ((lower.includes("companylogo") || lower.includes("company_logo") || lower.includes("/companylogos/")) &&
        !lower.includes("/images/wca") && !lower.includes("wca_logo")) {
      result.logo_url = resolveUrl(src);
    }
  });

  result.branch = $(".branchname").first().text().trim();

  // GM coverage
  const officeRow = $(".office_row").first();
  if (officeRow.length) {
    result.gm_status_text = officeRow.text().trim();
    result.gm_coverage = !/no\s*coverage|not\s*covered/i.test(result.gm_status_text);
  }

  // Enrolled offices
  $(".enrolledoffice_mainbox .office_country_wrapper, .enrolledoffice_mainbox tr").each((_, el) => {
    const text = $(el).text().trim();
    const goldNote = $(el).find(".gold_note").text().trim();
    const covered = !/not\s*covered/i.test(goldNote) && !/not\s*covered/i.test(text);
    const countryCity = text.replace(goldNote, "").trim();
    if (countryCity) result.enrolled_offices.push({ location: countryCity, covered });
  });

  // Enrolled since / expires
  $(".announce-display").each((_, el) => {
    const t = $(el).text().trim();
    const m = t.match(/since:?\s*(.+)/i);
    if (m) result.enrolled_since = m[1].trim();
  });
  $(".memberprofile_memberof, .memberof_expire").each((_, el) => {
    const t = $(el).text().trim();
    const m = t.match(/expires?:?\s*(.+)/i);
    if (m && !result.expires) result.expires = m[1].trim().split("\n")[0].trim();
  });

  // Networks
  $(".memberprofile_memberof img[alt], .memberof_img img[alt]").each((_, el) => {
    const name = $(el).attr("alt") || "";
    if (name && name.length > 2) result.networks.push(name.trim());
  });

  // Profile text
  $(".profile_table td").each((_, el) => {
    const t = $(el).text().trim();
    if (t.length > 30 && !result.profile_text) result.profile_text = t;
  });

  // Address
  $(".profile_headline").each((_, el) => {
    if (/address/i.test($(el).text())) {
      const next = $(el).next("span, div, p");
      if (next.length) result.address = next.html().replace(/<br\s*\/?>/gi, ", ").replace(/<[^>]+>/g, "").trim();
    }
  });

  // Contact info (phone, fax, email, website)
  $(".profile_row").each((_, row) => {
    if ($(row).closest(".contactperson_row, .contactperson_info").length) return;
    const label = $(row).find(".profile_label").text().trim().replace(/:?\s*$/, "").toLowerCase();
    const valEl = $(row).find(".profile_val");
    let val = valEl.text().trim();
    if (/members\s*only|please.*login/i.test(val)) val = "";
    if (/^phone|^telephone/.test(label)) result.phone = val;
    else if (/^fax/.test(label)) result.fax = val;
    else if (/^emergency/.test(label)) result.emergency_call = val;
    else if (/^website|^web\s*site|^url/.test(label)) result.website = valEl.find("a[href]").attr("href") || val;
    else if (/^email|^e-mail/.test(label)) {
      const mailto = valEl.find("a[href^='mailto:']").attr("href");
      if (mailto) result.email = mailto.replace("mailto:", "").trim();
      else if (val.includes("@")) result.email = val;
    }
  });

  // Contacts
  $(".contactperson_row").each((_, row) => {
    const contact = {};
    $(row).find(".profile_label").each((_, lbl) => {
      const cLabel = $(lbl).text().trim().replace(/:?\s*$/, "").toLowerCase();
      const cValEl = $(lbl).nextAll(".profile_val").first();
      if (!cValEl.length) return;
      let cVal = cValEl.text().trim();
      if (/members\s*only|please.*login/i.test(cVal)) cVal = "";
      if (/^title|^position|^role/.test(cLabel)) contact.title = cVal;
      else if (/^name/.test(cLabel)) contact.name = cVal;
      else if (/^(direct\s*line|phone|tel)/.test(cLabel)) contact.direct_line = cVal;
      else if (/^(email|e-mail)/.test(cLabel)) {
        const mailto = cValEl.find("a[href^='mailto:']").attr("href");
        contact.email = mailto ? mailto.replace("mailto:", "").trim() : cVal;
      }
      else if (/^fax/.test(cLabel)) contact.fax = cVal;
      else if (/^mobile|^cell/.test(cLabel)) contact.mobile = cVal;
      else if (/^skype/.test(cLabel)) contact.skype = cVal;
    });
    if (contact.title || contact.name || contact.email || contact.direct_line || contact.mobile) {
      if (!contact.name && contact.title) contact.name = contact.title;
      result.contacts.push(contact);
    }
  });

  // Strategy 3: text regex for contacts
  if (result.contacts.length === 0) {
    const bodyHtml = $.html();
    const contactSectionMatch = bodyHtml.match(/Office\s*Contacts[\s\S]*$/i);
    if (contactSectionMatch) {
      const textBlocks = cheerio.load(contactSectionMatch[0]).text();
      const nameBlocks = textBlocks.split(/(?=Name\s*:)/i);
      for (const block of nameBlocks) {
        if (!/Name\s*:/i.test(block)) continue;
        const contact = {};
        const nameM = block.match(/Name\s*:\s*(.+?)(?=Title|Email|Direct|Phone|Fax|Mobile|Skype|Name|$)/is);
        const titleM = block.match(/Title\s*:\s*(.+?)(?=Name|Email|Direct|Phone|Fax|Mobile|Skype|$)/is);
        const emailM = block.match(/Email\s*:\s*(\S+@\S+)/i);
        const directM = block.match(/Direct\s*Line\s*:\s*(.+?)(?=Name|Title|Email|Fax|Mobile|Skype|$)/is);
        const faxM = block.match(/Fax\s*:\s*(.+?)(?=Name|Title|Email|Direct|Phone|Mobile|Skype|$)/is);
        const mobileM = block.match(/Mobile\s*:\s*(.+?)(?=Name|Title|Email|Direct|Phone|Fax|Skype|$)/is);
        const skypeM = block.match(/Skype\s*:\s*(.+?)(?=Name|Title|Email|Direct|Phone|Fax|Mobile|$)/is);
        if (nameM) contact.name = nameM[1].trim();
        if (titleM) contact.title = titleM[1].trim();
        if (emailM) contact.email = emailM[1].trim();
        if (directM) contact.direct_line = directM[1].trim();
        if (faxM) contact.fax = faxM[1].trim();
        if (mobileM) contact.mobile = mobileM[1].trim();
        if (skypeM) contact.skype = skypeM[1].trim();
        if (contact.name || contact.email) result.contacts.push(contact);
      }
    }
  }

  // Services
  $("[class*='service'] span, [class*='service'] li, [class*='service'] a").each((_, el) => {
    const svc = $(el).text().trim();
    if (svc && svc.length > 2 && svc.length < 100 && !result.services.includes(svc)) result.services.push(svc);
  });

  // Certifications
  $("[class*='certif'] span, [class*='certif'] img, [class*='license'] span").each((_, el) => {
    const cert = ($(el).attr("alt") || $(el).attr("title") || $(el).text() || "").trim();
    if (cert && cert.length > 1 && cert.length < 60 && !result.certifications.includes(cert)) result.certifications.push(cert);
  });

  // Branch cities
  $("[class*='branch'] li, [class*='branch'] a").each((_, el) => {
    const bc = $(el).text().trim();
    if (bc && bc.length > 1 && bc.length < 80 && !result.branch_cities.includes(bc)) result.branch_cities.push(bc);
  });

  return result;
}
