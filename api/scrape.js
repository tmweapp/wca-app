const fetch = require("node-fetch");
const cheerio = require("cheerio");
const { BASE, UA, SUPABASE_URL, SUPABASE_KEY, getCachedCookies, saveCookiesToCache, testCookies, ssoLogin, cookieJar } = require("./utils/auth");


function extractProfile($, wcaId) {
  const result = {
    wca_id: wcaId, state: "ok", company_name: "", logo_url: null, branch: "",
    gm_coverage: null, gm_status_text: "", enrolled_offices: [], enrolled_since: "",
    expires: "", networks: [], profile_text: "", address: "", mailing: "", phone: "",
    fax: "", emergency_call: "", website: "", email: "", contacts: [], services: [],
    certifications: [], branch_cities: [], access_limited: false, members_only_count: 0,
  };

  const h1 = $("h1.company, h1").first().text().trim();
  result.company_name = h1;
  if (!h1 || /not\s*found|error|404/i.test(h1)) return { wca_id: wcaId, state: "not_found" };

  const isWcaSiteLogo = (src) => {
    if (!src) return true;
    const lower = src.toLowerCase();
    return lower.includes("/images/wca") || lower.includes("/images/logo") ||
           lower.includes("wca_logo") || lower.includes("wcaworld") ||
           lower.includes("/images/network") || lower.includes("/images/badge") ||
           lower.includes("/images/icon") || lower.includes("/images/flag") ||
           lower.includes("/images/gold") || lower.includes("/images/header") ||
           lower.includes("/images/footer") || lower.includes("/images/nav") ||
           lower.includes("/images/site") || lower.includes("/images/bg") ||
           lower.includes("sprite") || lower.includes("spacer") ||
           lower.includes("placeholder") || lower.includes("noimage") ||
           lower.includes("no-image") || lower.includes("default_logo");
  };
  const resolveUrl = (src) => {
    if (!src || src.length < 5) return null;
    if (src.startsWith("//")) return "https:" + src;
    if (src.startsWith("/")) return BASE + src;
    if (!src.startsWith("http")) return BASE + "/" + src;
    return src;
  };

  $("img[src]").each((_, el) => {
    if (result.logo_url) return;
    const src = $(el).attr("src") || "";
    const lower = src.toLowerCase();
    if ((lower.includes("companylogo") || lower.includes("company_logo") || lower.includes("/companylogos/")) && !isWcaSiteLogo(src)) {
      result.logo_url = resolveUrl(src);
    }
  });

  if (!result.logo_url) {
    const logoSelectors = ["img.company_logo", "img.companylogo", ".company_logo img", ".companylogo img", ".profile_logo img", ".member-logo img", ".member_logo img", ".logo-container img"];
    for (const sel of logoSelectors) {
      const logoEl = $(sel).first();
      if (logoEl.length) {
        const src = logoEl.attr("src") || "";
        if (!isWcaSiteLogo(src)) { result.logo_url = resolveUrl(src); if (result.logo_url) break; }
      }
    }
  }

  if (!result.logo_url) {
    $("img[src*='logo'], img[src*='Logo']").each((_, el) => {
      if (result.logo_url) return;
      const src = $(el).attr("src") || "";
      if (!isWcaSiteLogo(src)) result.logo_url = resolveUrl(src);
    });
  }

  if (!result.logo_url) {
    $("img[src]").each((_, el) => {
      if (result.logo_url) return;
      const src = $(el).attr("src") || "";
      const w = parseInt($(el).attr("width") || "0");
      const h = parseInt($(el).attr("height") || "0");
      if ((w >= 50 || h >= 50) && !isWcaSiteLogo(src)) result.logo_url = resolveUrl(src);
    });
  }

  result.branch = $(".branchname").first().text().trim();
  const compid = $(".compid span, .compid").first().text().trim();
  const idMatch = compid.match(/\d+/);
  if (idMatch) result.wca_id = parseInt(idMatch[0]);

  const officeRow = $(".office_row").first();
  if (officeRow.length) {
    const alertText = officeRow.text().trim();
    result.gm_status_text = alertText;
    result.gm_coverage = !/no\s*coverage|not\s*covered/i.test(alertText);
  }

  $(".enrolledoffice_mainbox .office_country_wrapper, .enrolledoffice_mainbox tr").each((_, el) => {
    const text = $(el).text().trim();
    const goldNote = $(el).find(".gold_note").text().trim();
    const covered = !/not\s*covered/i.test(goldNote) && !/not\s*covered/i.test(text);
    const countryCity = text.replace(goldNote, "").trim();
    if (countryCity) result.enrolled_offices.push({ location: countryCity, covered });
  });

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

  $(".memberprofile_memberof img[alt], .memberof_img img[alt]").each((_, el) => {
    const name = $(el).attr("alt") || "";
    if (name && name.length > 2) result.networks.push(name.trim());
  });
  $(".memberprofile_memberof").each((_, el) => {
    const t = $(el).text().trim();
    if (t && !result.networks.includes(t) && t.length > 3 && t.length < 80) {
      const nm = t.split(/expires/i)[0].trim();
      if (nm && nm.length > 3 && !result.networks.includes(nm)) result.networks.push(nm);
    }
  });

  $(".profile_table td, .profile_headline + .profile_table td").each((_, el) => {
    const t = $(el).text().trim();
    if (t.length > 30 && !result.profile_text) result.profile_text = t;
  });
  if (!result.profile_text) {
    $(".profile_headline").each((_, el) => {
      if (/profile/i.test($(el).text())) {
        const next = $(el).next();
        const t = next.text().trim();
        if (t.length > 30) result.profile_text = t;
      }
    });
  }

  $(".profile_headline").each((_, el) => {
    if (/address/i.test($(el).text())) {
      const next = $(el).next("span, div, p");
      if (next.length) result.address = next.html().replace(/<br\s*\/?>/gi, ", ").replace(/<[^>]+>/g, "").trim();
    }
  });

  $(".profile_headline").each((_, el) => {
    if (/mailing/i.test($(el).text())) {
      const next = $(el).next("span, div, p");
      if (next.length) result.mailing = next.text().trim();
    }
  });

  $(".profile_row").each((_, row) => {
    if ($(row).closest(".contactperson_row, .contactperson_info").length) return;
    const label = $(row).find(".profile_label").text().trim().replace(/:?\s*$/, "").toLowerCase();
    const valEl = $(row).find(".profile_val");
    let val = valEl.text().trim();
    if (/members\s*only|please.*login/i.test(val)) val = "";
    if (/^phone|^telephone/.test(label)) result.phone = val;
    else if (/^fax/.test(label)) result.fax = val;
    else if (/^emergency/.test(label)) result.emergency_call = val;
    else if (/^website|^web\s*site|^url/.test(label)) { result.website = valEl.find("a[href]").attr("href") || val; }
    else if (/^email|^e-mail/.test(label)) {
      const mailto = valEl.find("a[href^='mailto:']").attr("href");
      if (mailto) result.email = mailto.replace("mailto:", "").trim();
      else if (val.includes("@")) result.email = val;
    }
  });

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
    else if (/^(website|web\s*site|url)/.test(label) && !result.website) { result.website = valEl.find("a[href]").attr("href") || val; }
    else if (/^(email|e-mail)/.test(label) && !result.email) {
      const mailto = valEl.find("a[href^='mailto:']").attr("href");
      if (mailto) result.email = mailto.replace("mailto:", "").trim();
      else if (val.includes("@")) result.email = val;
    }
  });

  // === CONTACT EXTRACTION ===
  // WCA uses sequential generic elements: label element ("Name:") followed by value element ("Mr. Luca Arcana")
  // No specific CSS classes on label/value pairs - just sibling elements in sequence

  // Primary strategy: Walk through ALL children of contact containers looking for label→value pattern
  const CONTACT_LABELS = {
    "name": "name", "nome": "name",
    "title": "title", "titolo": "title", "position": "title", "role": "title",
    "email": "email", "e-mail": "email",
    "direct line": "direct_line", "direct": "direct_line", "phone": "direct_line", "telephone": "direct_line", "tel": "direct_line",
    "fax": "fax",
    "mobile": "mobile", "cell": "mobile", "cellulare": "mobile",
    "skype": "skype",
  };

  function extractContactsFromContainer($container) {
    const contacts = [];
    // Get all leaf-level elements (elements with minimal/no children that contain text)
    const allEls = $container.find("*").toArray();
    let currentContact = {};
    let lastLabel = null;

    for (const el of allEls) {
      const $el = $(el);
      // Skip elements that are containers of other elements with text
      if ($el.children().length > 2) continue;

      let text = "";
      // Get direct text content (not nested)
      const directText = $el.clone().children().remove().end().text().trim();
      text = directText || $el.text().trim();
      if (!text || text.length > 200) continue;

      // Check if this is a label (e.g., "Name:", "Title:", "Email:")
      const cleanLabel = text.replace(/:\s*$/, "").trim().toLowerCase();
      const mappedField = CONTACT_LABELS[cleanLabel];

      if (mappedField) {
        // This is a label - if it's "name" and we already have data, save previous contact
        if (mappedField === "name" && (currentContact.name || currentContact.email || currentContact.title)) {
          contacts.push({...currentContact});
          currentContact = {};
        }
        lastLabel = mappedField;
      } else if (lastLabel && text && !/members\s*only|please.*login/i.test(text) && text.toLowerCase() !== "login") {
        // This is a value for the previous label
        if (lastLabel === "email") {
          // Check for mailto link
          const mailto = $el.find("a[href^='mailto:']").attr("href") || $el.closest("a[href^='mailto:']").attr("href");
          if (mailto) {
            currentContact.email = mailto.replace("mailto:", "").trim();
          } else if (text.includes("@")) {
            currentContact.email = text;
          } else {
            // Might be a link text like the email itself
            const linkHref = $el.is("a") ? ($el.attr("href") || "") : "";
            if (linkHref.startsWith("mailto:")) {
              currentContact.email = linkHref.replace("mailto:", "").trim();
            }
          }
        } else {
          currentContact[lastLabel] = text;
        }
        lastLabel = null; // consumed
      }
    }
    // Push last contact
    if (currentContact.name || currentContact.email || currentContact.title) {
      contacts.push(currentContact);
    }
    return contacts;
  }

  // Try different container selectors
  const contactSelectors = [
    ".contactperson_row",
    "[class*='contactperson']",
    "[class*='office_contact']",
    "[class*='officecontact']",
  ];

  // First: try extracting from each individual contact row
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

  // Second: try extracting from the full "Office Contacts" section as one block
  if (result.contacts.length === 0) {
    // Find the section header and get everything after it
    const bodyHtml = $.html();
    const contactSectionMatch = bodyHtml.match(/Office\s*Contacts([\s\S]*?)(?=<\/body>|$)/i);
    if (contactSectionMatch) {
      const $section = cheerio.load(contactSectionMatch[0]);
      const sectionContacts = extractContactsFromContainer($section.root());
      for (const c of sectionContacts) {
        if (c.name || c.email || c.title) {
          if (!c.name && c.title) c.name = c.title;
          result.contacts.push(c);
        }
      }
    }
  }

  // Third: text-based regex on full page as last resort
  if (result.contacts.length === 0) {
    const fullText = $.text();
    // Split by "Name:" pattern to get individual contacts
    const nameBlocks = fullText.split(/(?=Name\s*:)/i);
    for (const block of nameBlocks) {
      if (!/Name\s*:/i.test(block)) continue;
      const contact = {};
      const nameM = block.match(/Name\s*:\s*(.+?)(?=Title|Email|Direct|Phone|Fax|Mobile|Skype|Name|$)/is);
      const titleM = block.match(/Title\s*:\s*(.+?)(?=Name|Email|Direct|Phone|Fax|Mobile|Skype|$)/is);
      const emailM = block.match(/Email\s*:\s*(\S+@\S+)/i);
      const directM = block.match(/Direct\s*(?:Line)?\s*:\s*(.+?)(?=Name|Title|Email|Fax|Mobile|Skype|$)/is);
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

  // Final fallback: at least extract mailto links
  if (result.contacts.length === 0) {
    $("a[href^='mailto:']").each((_, el) => {
      const email = ($(el).attr("href") || "").replace("mailto:", "").trim();
      if (email && !result.contacts.find(c => c.email === email)) {
        result.contacts.push({ email, name: $(el).text().trim() || email });
      }
    });
  }

  console.log(`[contacts] Extracted ${result.contacts.length} contacts: ${JSON.stringify(result.contacts.map(c => ({n:c.name,e:c.email,t:c.title})))}`);

  $("[class*='service'] span, [class*='service'] li, [class*='service'] a").each((_, el) => {
    const svc = $(el).text().trim();
    if (svc && svc.length > 2 && svc.length < 100 && !result.services.includes(svc)) result.services.push(svc);
  });

  $("[class*='certif'] span, [class*='certif'] img, [class*='license'] span").each((_, el) => {
    const cert = ($(el).attr("alt") || $(el).attr("title") || $(el).text() || "").trim();
    if (cert && cert.length > 1 && cert.length < 60 && !result.certifications.includes(cert)) result.certifications.push(cert);
  });

  $("[class*='branch'] li, [class*='branch'] a").each((_, el) => {
    const bc = $(el).text().trim();
    if (bc && bc.length > 1 && bc.length < 80 && !result.branch_cities.includes(bc)) result.branch_cities.push(bc);
  });

  // Detect "Members only" / restricted access
  const fullText = $.html();
  const membersOnlyMatches = fullText.match(/Members\s*Only/gi) || [];
  const loginOnlyMatches = fullText.match(/>Login<\/a>/gi) || [];
  result.members_only_count = membersOnlyMatches.length + loginOnlyMatches.length;
  // Se ci sono campi "Members only" e non abbiamo email nei contatti → accesso limitato
  const hasContactEmails = result.contacts.some(c => c.email);
  const hasCompanyEmail = !!result.email;
  if (result.members_only_count > 0 && !hasContactEmails && !hasCompanyEmail) {
    result.access_limited = true;
  }
  console.log(`[scrape] Profile ${wcaId}: membersOnly=${result.members_only_count} hasEmails=${hasContactEmails||hasCompanyEmail} access_limited=${result.access_limited}`);

  return result;
}

async function tryFetchUrl(url, cookies, refererBase) {
  // Gestione redirect manuale per preservare i cookies di autenticazione
  const baseForReferer = refererBase || BASE;
  let currentUrl = url;
  let redirectCount = 0;
  let resp;

  while (redirectCount < 5) {
    resp = await fetch(currentUrl, {
      headers: {
        "User-Agent": UA,
        "Cookie": cookies,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9,it;q=0.8",
        "Referer": baseForReferer + "/Directory",
      },
      redirect: "manual",
      timeout: 15000,
    });

    // Raccogliere nuovi cookies dal redirect
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
      // Se redirect al login → sessione scaduta
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
  console.log(`[scrape] Fetched ${currentUrl.substring(0,60)} status=${resp.status} len=${html.length} hasLogin=${html.includes('type="password"')}`);

  if (html.includes('type="password"') || currentUrl.toLowerCase().includes("/login")) {
    return { loginRedirect: true, status: resp.status, finalUrl: currentUrl };
  }
  const $ = cheerio.load(html);
  const h1 = $("h1").first().text().trim();
  if (/member\s*not\s*found|not\s*found.*try\s*again|page\s*not\s*found/i.test(h1)) return null;

  // Debug: check if page shows "Login" in contact fields (means not authenticated)
  const memberOnly = $("*:contains('Members Only')").length;
  const loginText = html.match(/Login<\/a>/gi)?.length || 0;
  console.log(`[scrape] Auth check: "Members Only" count=${memberOnly}, "Login</a>" count=${loginText}, cookie len=${cookies.length}`);

  return { $, html, resp, h1 };
}

// NETWORK_DOMAINS — mappa dominio → base URL
const NETWORK_DOMAINS = {
  "wcaworld.com":              "https://www.wcaworld.com",
  "lognetglobal.com":          "https://www.lognetglobal.com",
  "globalaffinityalliance.com":"https://www.globalaffinityalliance.com",
  "elitegln.com":              "https://www.elitegln.com",
  "ifc8.network":              "https://ifc8.network",
  "wcaprojects.com":           "https://www.wcaprojects.com",
  "wcadangerousgoods.com":     "https://www.wcadangerousgoods.com",
  "wcaperishables.com":        "https://www.wcaperishables.com",
  "wcatimecritical.com":       "https://www.wcatimecritical.com",
  "wcapharma.com":             "https://www.wcapharma.com",
  "wcarelocations.com":        "https://www.wcarelocations.com",
  "wcaecommercesolutions.com": "https://www.wcaecommercesolutions.com",
  "wcaexpo.com":               "https://www.wcaexpo.com",
};

async function fetchProfile(wcaId, cookies, profileHref, networkDomain) {
  // Determina il base URL: network specifico o wcaworld.com
  const networkBase = networkDomain ? (NETWORK_DOMAINS[networkDomain] || BASE) : BASE;

  const primaryUrls = [];
  if (profileHref) {
    const fullHref = profileHref.startsWith("http") ? profileHref : networkBase + profileHref;
    primaryUrls.push(fullHref);
  }
  primaryUrls.push(`${networkBase}/directory/members/${wcaId}`);
  // Fallback su wcaworld.com se stiamo cercando su un network specifico
  if (networkDomain && networkDomain !== "wcaworld.com") {
    primaryUrls.push(`${BASE}/directory/members/${wcaId}`);
  }

  for (const url of primaryUrls) {
    try {
      console.log(`[scrape] Try ${wcaId} ${url.substring(0,80)}`);
      const result = await tryFetchUrl(url, cookies, networkBase);
      if (!result) continue;
      if (result.loginRedirect) {
        return { wca_id: wcaId, state: "login_redirect", debug: { url, finalUrl: result.finalUrl } };
      }
      const { $, html } = result;
      console.log(`[scrape] OK ${wcaId} labels=${$(".profile_label").length} len=${html.length}`);
      const loginLinks = html.match(/>Login<\/a>/gi)?.length || 0;
      const membersOnly = html.match(/Members\s*Only/gi)?.length || 0;
      const contactSection = html.match(/Office\s*Contacts/i) ? "found" : "not_found";
      const profile = extractProfile($, wcaId);
      profile._debug = { loginLinks, membersOnly, contactSection, cookieLen: cookies.length, htmlLen: html.length, cookieKeys: cookies.split("; ").map(c => c.split("=")[0]).join(",") };
      profile.source_network = networkDomain || "wcaworld.com";
      if (profile.state === "ok") { profile.source_url = url; return profile; }
    } catch (err) { console.log(`[scrape] Err ${url.substring(0,50)}: ${err.message}`); }
  }

  const state = networkDomain ? "not_in_network" : "not_found";
  console.log(`[scrape] ${wcaId} ${state} on ${networkDomain || "wcaworld.com"}`);
  return { wca_id: wcaId, state, source_network: networkDomain || "wcaworld.com" };
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  try {
    const { wcaIds, members, networkDomain } = req.body || {};
    if (!wcaIds || !Array.isArray(wcaIds) || wcaIds.length === 0) return res.status(400).json({ error: "wcaIds richiesto" });

    // 1. Prova cookies cached da Supabase (evita SSO login ripetuto)
    let cookies = await getCachedCookies();
    let fromCache = !!cookies;
    if (cookies) {
      const valid = await testCookies(cookies);
      if (!valid) {
        console.log("[scrape] Cookies cached non validi, SSO login...");
        cookies = null;
        fromCache = false;
      }
    }
    // 2. Se no cache valida, SSO login e salva in cache
    if (!cookies) {
      const loginResult = await ssoLogin();
      if (!loginResult.success) return res.status(500).json({ success: false, error: loginResult.error || "SSO login fallito" });
      cookies = loginResult.cookies;
      await saveCookiesToCache(cookies);
    }

    if (networkDomain) {
      console.log(`[scrape] Network mode: ${networkDomain}`);
    }

    const batch = wcaIds.slice(0, 1); // 1 SOLO profilo per request — MAI più di uno
    const memberMap = {};
    if (members && Array.isArray(members)) {
      for (const m of members) { if (m.id && m.href) memberMap[m.id] = m.href; }
    }
    const results = [];
    for (const wcaId of batch) {
      const profile = await fetchProfile(wcaId, cookies, memberMap[wcaId], networkDomain);
      results.push(profile);
    }
    return res.json({ success: true, results });
  } catch (err) { return res.status(500).json({ success: false, error: err.message }); }
};
