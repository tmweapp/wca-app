const fetch = require("node-fetch");
const cheerio = require("cheerio");

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

const NETWORK_DOMAINS = {
  "WCA First":                     "https://www.wcaworld.com",
  "WCA Advanced Professionals":    "https://www.wcaworld.com",
  "WCA China Global":              "https://www.wcachinaglobal.com",
  "WCA Inter Global":              "https://www.wcainterglobal.com",
  "Lognet Global":                 "https://www.lognetglobal.com",
  "Global Affinity Alliance":      "https://www.globalaffinityalliance.com",
  "Elite Global Logistics Network":"https://www.elitegln.com",
  "InFinite Connection (IFC8)":    "https://www.ifc8.com",
  "WCA Projects":                  "https://www.wcaprojects.com",
  "WCA Dangerous Goods":           "https://www.wcadangerousgoods.com",
  "WCA Perishables":               "https://www.wcaperishables.com",
  "WCA Time Critical":             "https://www.wcatimecritical.com",
  "WCA Relocations":               "https://www.wcarelocations.com",
  "WCA Pharma":                    "https://www.wcapharma.com",
  "WCA Vendors":                   "https://www.wcavendors.com",
  "WCA eCommerce Solutions":       "https://www.wcaecommerce.com",
  "WCA Live Events and Expo":      "https://www.wcaliveevents.com",
};

// Cookie jar separato per dominio
function cookieJar() {
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
    get(domain) { return jar[domain] ? Object.values(jar[domain]).join("; ") : ""; },
    keys(domain) { return jar[domain] ? Object.keys(jar[domain]) : []; },
  };
}

async function ssoLoginForDomain(base, username, password) {
  const WCA_DOMAIN = new URL(base).hostname;
  const SSO_DOMAIN = "sso.api.wcaworld.com";
  const jar = cookieJar();

  // Step 1: GET login page
  let resp = await fetch(`${base}/Account/Login`, { headers: { "User-Agent": UA }, redirect: "manual", timeout: 12000 });
  jar.add(WCA_DOMAIN, resp.headers.raw()["set-cookie"]);
  let currentUrl = `${base}/Account/Login`;
  let rc = 0;
  while (resp.status >= 300 && resp.status < 400 && rc < 5) {
    const loc = resp.headers.get("location") || "";
    currentUrl = loc.startsWith("http") ? loc : new URL(loc, currentUrl).href;
    resp = await fetch(currentUrl, { headers: { "User-Agent": UA, "Cookie": jar.get(WCA_DOMAIN) }, redirect: "manual", timeout: 12000 });
    jar.add(WCA_DOMAIN, resp.headers.raw()["set-cookie"]);
    rc++;
  }
  const loginHtml = resp.status === 200 ? await resp.text() : "";
  const ssoUrlMatch = loginHtml.match(/action\s*[:=]\s*['"]?(https:\/\/sso\.api\.wcaworld\.com[^'"&\s]+[^'"]*)/i);
  if (!ssoUrlMatch) return null;
  const ssoUrl = ssoUrlMatch[1].replace(/&amp;/g, "&");

  // Step 2: POST to SSO
  const ssoResp = await fetch(ssoUrl, {
    method: "POST",
    headers: { "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded", "Origin": "https://sso.api.wcaworld.com", "Referer": ssoUrl },
    body: `UserName=${encodeURIComponent(username)}&Password=${encodeURIComponent(password)}&pwd=${encodeURIComponent(password)}`,
    redirect: "manual", timeout: 12000,
  });
  jar.add(SSO_DOMAIN, ssoResp.headers.raw()["set-cookie"]);
  if (!jar.keys(SSO_DOMAIN).includes(".ASPXAUTH")) return null;

  // Step 3: Follow redirects
  let callbackUrl = ssoResp.headers.get("location") || "";
  let followCount = 0;
  while (callbackUrl && followCount < 8) {
    const cbUrl = callbackUrl.startsWith("http") ? callbackUrl : new URL(callbackUrl, ssoUrl).href;
    const cbDomain = cbUrl.includes("sso.api.wcaworld.com") ? SSO_DOMAIN : WCA_DOMAIN;
    const cbResp = await fetch(cbUrl, { headers: { "User-Agent": UA, "Cookie": jar.get(cbDomain) }, redirect: "manual", timeout: 12000 });
    jar.add(cbDomain, cbResp.headers.raw()["set-cookie"]);
    callbackUrl = cbResp.headers.get("location") || "";
    if (callbackUrl && !callbackUrl.startsWith("http")) callbackUrl = new URL(callbackUrl, cbUrl).href;
    if (cbResp.status === 200) { callbackUrl = null; break; }
    followCount++;
  }

  // Step 4: Warmup
  try {
    let wr = await fetch(`${base}/Directory`, { headers: { "User-Agent": UA, "Cookie": jar.get(WCA_DOMAIN) }, redirect: "manual", timeout: 12000 });
    jar.add(WCA_DOMAIN, wr.headers.raw()["set-cookie"]);
    let wLoc = wr.headers.get("location") || "";
    let wc = 0;
    while (wLoc && wc < 3) {
      const wNext = wLoc.startsWith("http") ? wLoc : new URL(wLoc, `${base}/Directory`).href;
      wr = await fetch(wNext, { headers: { "User-Agent": UA, "Cookie": jar.get(WCA_DOMAIN) }, redirect: "manual", timeout: 12000 });
      jar.add(WCA_DOMAIN, wr.headers.raw()["set-cookie"]);
      wLoc = wr.headers.get("location") || ""; wc++;
    }
  } catch(e) {}

  return jar.get(WCA_DOMAIN);
}

// Cerca un'azienda nella directory del network e restituisce il primo match
async function searchCompanyInDirectory(base, cookies, companyName) {
  const params = new URLSearchParams();
  params.set("siteID", "24");
  params.set("au", "");
  params.set("pageIndex", "1");
  params.set("pageSize", "10");
  params.set("layout", "v1");
  params.set("submitted", "search");
  params.set("searchby", "CompanyName");
  params.set("country", "");
  params.set("city", "");
  params.set("keyword", companyName);
  params.set("orderby", "CompanyName");

  const url = `${base}/Directory?${params.toString()}`;
  const resp = await fetch(url, {
    headers: { "User-Agent": UA, "Cookie": cookies, "Accept": "text/html", "Referer": `${base}/Directory` },
    redirect: "follow", timeout: 15000,
  });
  const html = await resp.text();
  const $ = cheerio.load(html);

  // Cerca link a profili
  const members = [];
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href") || "";
    const match = href.match(/\/directory\/members\/(\d+)/i);
    if (match) {
      members.push({ id: parseInt(match[1]), name: $(el).text().trim(), href });
    }
  });

  // Trova il match migliore (nome più simile)
  const needle = companyName.toLowerCase().trim();
  let best = null;
  let bestScore = 0;
  for (const m of members) {
    const mName = m.name.toLowerCase().trim();
    // Match esatto
    if (mName === needle) return m;
    // Match parziale
    const words = needle.split(/\s+/);
    const score = words.filter(w => mName.includes(w)).length / words.length;
    if (score > bestScore) { bestScore = score; best = m; }
  }
  // Accetta solo match con score > 50%
  return bestScore > 0.5 ? best : (members[0] || null);
}

// Estrae il profilo completo (stessa logica di scrape.js)
function extractProfile($, wcaId, base) {
  const result = {
    wca_id: wcaId, state: "ok", company_name: "", logo_url: null, branch: "",
    gm_coverage: null, gm_status_text: "", enrolled_offices: [], enrolled_since: "",
    expires: "", networks: [], profile_text: "", address: "", mailing: "", phone: "",
    fax: "", emergency_call: "", website: "", email: "", contacts: [], services: [],
    certifications: [], branch_cities: [], access_limited: false, members_only_count: 0,
  };

  const h1 = $("h1.company, h1").first().text().trim();
  result.company_name = h1;
  if (!h1 || /not\s*found|error|404/i.test(h1)) return null;

  const resolveUrl = (src) => {
    if (!src || src.length < 5) return null;
    if (src.startsWith("//")) return "https:" + src;
    if (src.startsWith("/")) return base + src;
    if (!src.startsWith("http")) return base + "/" + src;
    return src;
  };

  // Company email
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

  // Also try profile_label pattern
  $(".profile_label").each((_, el) => {
    if ($(el).closest(".contactperson_row, .contactperson_info").length) return;
    const label = $(el).text().trim().replace(/:?\s*$/, "").toLowerCase();
    const valEl = $(el).nextAll(".profile_val").first();
    if (!valEl.length) return;
    let val = valEl.text().trim();
    if (/members\s*only|please.*login/i.test(val) || val.toLowerCase() === "login") val = "";
    if (!val) return;
    if (/^phone|^telephone/.test(label) && !result.phone) result.phone = val;
    else if (/^fax/.test(label) && !result.fax) result.fax = val;
    else if (/^emergency/.test(label) && !result.emergency_call) result.emergency_call = val;
    else if (/^(website|web\s*site|url)/.test(label) && !result.website) result.website = valEl.find("a[href]").attr("href") || val;
    else if (/^(email|e-mail)/.test(label) && !result.email) {
      const mailto = valEl.find("a[href^='mailto:']").attr("href");
      if (mailto) result.email = mailto.replace("mailto:", "").trim();
      else if (val.includes("@")) result.email = val;
    }
  });

  // Contact extraction
  const CONTACT_LABELS = {
    "name": "name", "nome": "name",
    "title": "title", "titolo": "title", "position": "title", "role": "title",
    "email": "email", "e-mail": "email",
    "direct line": "direct_line", "direct": "direct_line", "phone": "direct_line", "telephone": "direct_line", "tel": "direct_line",
    "fax": "fax", "mobile": "mobile", "cell": "mobile", "cellulare": "mobile", "skype": "skype",
  };

  function extractContactsFromContainer($container) {
    const contacts = [];
    const allEls = $container.find("*").toArray();
    let currentContact = {};
    let lastLabel = null;
    for (const el of allEls) {
      const $el = $(el);
      if ($el.children().length > 2) continue;
      const directText = $el.clone().children().remove().end().text().trim();
      const text = directText || $el.text().trim();
      if (!text || text.length > 200) continue;
      const cleanLabel = text.replace(/:\s*$/, "").trim().toLowerCase();
      const mappedField = CONTACT_LABELS[cleanLabel];
      if (mappedField) {
        if (mappedField === "name" && (currentContact.name || currentContact.email || currentContact.title)) {
          contacts.push({...currentContact});
          currentContact = {};
        }
        lastLabel = mappedField;
      } else if (lastLabel && text && !/members\s*only|please.*login/i.test(text) && text.toLowerCase() !== "login") {
        if (lastLabel === "email") {
          const mailto = $el.find("a[href^='mailto:']").attr("href") || $el.closest("a[href^='mailto:']").attr("href");
          if (mailto) currentContact.email = mailto.replace("mailto:", "").trim();
          else if (text.includes("@")) currentContact.email = text;
        } else {
          currentContact[lastLabel] = text;
        }
        lastLabel = null;
      }
    }
    if (currentContact.name || currentContact.email || currentContact.title) contacts.push(currentContact);
    return contacts;
  }

  const contactSelectors = [".contactperson_row", "[class*='contactperson']", "[class*='office_contact']", "[class*='officecontact']"];
  for (const sel of contactSelectors) {
    const rows = $(sel);
    if (rows.length === 0) continue;
    rows.each((_, row) => {
      const rowContacts = extractContactsFromContainer($(row));
      for (const c of rowContacts) {
        if (c.name || c.email || c.title) {
          if (!c.name && c.title) c.name = c.title;
          result.contacts.push(c);
        }
      }
    });
    if (result.contacts.length > 0) break;
  }

  // Fallback: text regex
  if (result.contacts.length === 0) {
    const fullText = $.text();
    const nameBlocks = fullText.split(/(?=Name\s*:)/i);
    for (const block of nameBlocks) {
      if (!/Name\s*:/i.test(block)) continue;
      const contact = {};
      const nameM = block.match(/Name\s*:\s*(.+?)(?=Title|Email|Direct|Phone|Fax|Mobile|Skype|Name|$)/is);
      const titleM = block.match(/Title\s*:\s*(.+?)(?=Name|Email|Direct|Phone|Fax|Mobile|Skype|$)/is);
      const emailM = block.match(/Email\s*:\s*(\S+@\S+)/i);
      const directM = block.match(/Direct\s*(?:Line)?\s*:\s*(.+?)(?=Name|Title|Email|Fax|Mobile|Skype|$)/is);
      const mobileM = block.match(/Mobile\s*:\s*(.+?)(?=Name|Title|Email|Direct|Phone|Fax|Skype|$)/is);
      if (nameM) contact.name = nameM[1].trim();
      if (titleM) contact.title = titleM[1].trim();
      if (emailM) contact.email = emailM[1].trim();
      if (directM) contact.direct_line = directM[1].trim();
      if (mobileM) contact.mobile = mobileM[1].trim();
      if (contact.name || contact.email) result.contacts.push(contact);
    }
  }

  // Fallback: mailto links
  if (result.contacts.length === 0) {
    $("a[href^='mailto:']").each((_, el) => {
      const email = ($(el).attr("href") || "").replace("mailto:", "").trim();
      if (email && !result.contacts.find(c => c.email === email)) {
        result.contacts.push({ email, name: $(el).text().trim() || email });
      }
    });
  }

  // Members Only detection
  const fullHtml = $.html();
  const membersOnlyMatches = fullHtml.match(/Members\s*Only/gi) || [];
  const loginOnlyMatches = fullHtml.match(/>Login<\/a>/gi) || [];
  result.members_only_count = membersOnlyMatches.length + loginOnlyMatches.length;
  const hasContactEmails = result.contacts.some(c => c.email);
  const hasCompanyEmail = !!result.email;
  if (result.members_only_count > 0 && !hasContactEmails && !hasCompanyEmail) {
    result.access_limited = true;
  }

  return result;
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  try {
    const { companyName, originalWcaId, networkName, networkDomain } = req.body || {};
    if (!companyName || !networkDomain) {
      return res.status(400).json({ error: "companyName e networkDomain richiesti" });
    }

    const username = process.env.WCA_USERNAME || "tmsrlmin";
    const password = process.env.WCA_PASSWORD || "G0u3v!VvCn";
    const base = networkDomain.replace(/\/$/, "");

    console.log(`[enrich] SSO login su ${base} per "${companyName}"...`);

    // 1. SSO login sul dominio del network
    const cookies = await ssoLoginForDomain(base, username, password);
    if (!cookies) {
      return res.json({ success: false, error: "SSO login fallito su " + base });
    }

    // 2. Cerca l'azienda nella directory del network
    console.log(`[enrich] Ricerca "${companyName}" su ${base}...`);
    const member = await searchCompanyInDirectory(base, cookies, companyName);
    if (!member) {
      return res.json({ success: false, error: "Azienda non trovata nella directory di " + (networkName || base) });
    }
    console.log(`[enrich] Trovato: ID=${member.id} nome="${member.name}" href=${member.href}`);

    // Pausa 2s tra ricerca directory e fetch profilo per non stressare WCA
    await new Promise(r => setTimeout(r, 2000));

    // 3. Scarica il profilo completo dal dominio del network
    const profileUrl = member.href.startsWith("http") ? member.href : base + member.href;
    let resp = await fetch(profileUrl, {
      headers: { "User-Agent": UA, "Cookie": cookies, "Accept": "text/html", "Referer": `${base}/Directory` },
      redirect: "manual", timeout: 15000,
    });
    // Follow redirects
    let rc = 0;
    while (resp.status >= 300 && resp.status < 400 && rc < 5) {
      const loc = resp.headers.get("location") || "";
      if (loc.toLowerCase().includes("/login")) {
        return res.json({ success: false, error: "Redirect al login — sessione non valida" });
      }
      const next = loc.startsWith("http") ? loc : new URL(loc, profileUrl).href;
      resp = await fetch(next, { headers: { "User-Agent": UA, "Cookie": cookies }, redirect: "manual", timeout: 15000 });
      rc++;
    }

    if (resp.status !== 200) {
      return res.json({ success: false, error: `HTTP ${resp.status} su ${profileUrl}` });
    }

    const html = await resp.text();
    const $ = cheerio.load(html);
    const profile = extractProfile($, originalWcaId || member.id, base);

    if (!profile) {
      return res.json({ success: false, error: "Profilo non valido" });
    }

    profile.source_url = profileUrl;
    profile.source_network = networkName || base;
    profile.network_member_id = member.id;
    // Mantieni l'ID WCA originale per il merge nel frontend
    if (originalWcaId) profile.wca_id = originalWcaId;

    const isEnriched = !profile.access_limited && (profile.contacts.some(c => c.email) || !!profile.email);
    console.log(`[enrich] Profilo: ${profile.company_name} contatti=${profile.contacts.length} email=${!!profile.email} enriched=${isEnriched}`);

    return res.json({
      success: true,
      enriched: isEnriched,
      profile,
      searchedName: companyName,
      foundName: member.name,
      networkMemberId: member.id,
    });
  } catch (err) {
    console.log(`[enrich] Error: ${err.message}`);
    return res.status(500).json({ success: false, error: err.message });
  }
};
