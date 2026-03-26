/**
 * utils/extract.js — Modulo unico per l'estrazione profili WCA
 *
 * CENTRALIZZA tutta la logica di parsing HTML dei profili partner.
 * Prima era duplicata in: scrape.js (404 righe), verify.js (175), enrich.js (162)
 */
const cheerio = require("cheerio");
const { BASE } = require("./auth");

// ═══ LABEL MAP per contatti ═══
const CONTACT_LABELS = {
  "name": "name", "nome": "name",
  "title": "title", "titolo": "title", "position": "title", "role": "title",
  "email": "email", "e-mail": "email",
  "direct line": "direct_line", "direct": "direct_line", "phone": "direct_line",
  "telephone": "direct_line", "tel": "direct_line",
  "fax": "fax",
  "mobile": "mobile", "cell": "mobile", "cellulare": "mobile",
  "skype": "skype",
};

// ═══ NAME → DOMAIN per auto-retry ═══
const NAME_TO_DOMAIN = {
  "wca projects": "wcaprojects.com",
  "wca dangerous goods": "wcadangerousgoods.com",
  "wca perishables": "wcaperishables.com",
  "wca time critical": "wcatimecritical.com",
  "wca pharma": "wcapharma.com",
  "wca relocations": "wcarelocations.com",
  "wca ecommerce": "wcaecommercesolutions.com",
  "wca expo": "wcaexpo.com",
  "wca live events": "wcaexpo.com",
  "lognet global": "lognetglobal.com",
  "lognet": "lognetglobal.com",
  "global affinity": "globalaffinityalliance.com",
  "gaa": "globalaffinityalliance.com",
  "elite global": "elitegln.com",
  "egln": "elitegln.com",
  "ifc8": "ifc8.network",
  "infinite connection": "ifc8.network",
};

// ═══ NETWORK DOMAINS ═══
const NETWORK_DOMAINS = {
  "wcaworld.com":              { siteId: 24,  base: "https://www.wcaworld.com" },
  "lognetglobal.com":          { siteId: 61,  base: "https://www.lognetglobal.com" },
  "globalaffinityalliance.com":{ siteId: 98,  base: "https://www.globalaffinityalliance.com" },
  "elitegln.com":              { siteId: 108, base: "https://www.elitegln.com" },
  "ifc8.network":              { siteId: 118, base: "https://ifc8.network" },
  "wcaprojects.com":           { siteId: 5,   base: "https://www.wcaprojects.com" },
  "wcadangerousgoods.com":     { siteId: 22,  base: "https://www.wcadangerousgoods.com" },
  "wcaperishables.com":        { siteId: 13,  base: "https://www.wcaperishables.com" },
  "wcatimecritical.com":       { siteId: 18,  base: "https://www.wcatimecritical.com" },
  "wcapharma.com":             { siteId: 16,  base: "https://www.wcapharma.com" },
  "wcarelocations.com":        { siteId: 15,  base: "https://www.wcarelocations.com" },
  "wcaecommercesolutions.com": { siteId: 107, base: "https://www.wcaecommercesolutions.com" },
  "wcaexpo.com":               { siteId: 124, base: "https://www.wcaexpo.com" },
};

// Helper: base URL per un dominio
function getNetworkBase(domain) {
  if (!domain || domain === "wcaworld.com") return BASE;
  const info = NETWORK_DOMAINS[domain];
  return info ? info.base : BASE;
}

// ═══ UTILITY FUNZIONI ═══

function isWcaSiteLogo(src) {
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
}

function resolveUrl(src, base) {
  if (!src || src.length < 5) return null;
  const b = base || BASE;
  if (src.startsWith("//")) return "https:" + src;
  if (src.startsWith("/")) return b + src;
  if (!src.startsWith("http")) return b + "/" + src;
  return src;
}

// ═══ ESTRAZIONE CONTATTI DA CONTAINER ═══
// Struttura WCA reale:
//   .contactperson_row > .contactperson_info > .profile_row > .row > .profile_label + .profile_val
function extractContactsFromContainer($, $container) {
  const contacts = [];

  // STRATEGIA 1: Usa la struttura CSS label/val (più affidabile)
  const profileRows = $container.find(".profile_row");
  if (profileRows.length > 0) {
    let currentContact = {};
    profileRows.each((_, row) => {
      const label = $(row).find(".profile_label").text().trim().replace(/:\s*$/, "").toLowerCase();
      const valEl = $(row).find(".profile_val");
      let val = valEl.text().trim();

      // Salta "Members only" / "please Login"
      if (/members\s*only|please.*login/i.test(val)) val = "";

      // Cerca mailto nei link
      const mailtoLink = valEl.find("a[href^='mailto:']").attr("href");
      if (mailtoLink) val = mailtoLink.replace("mailto:", "").trim();

      const mappedField = CONTACT_LABELS[label];
      if (!mappedField) return;

      // Nuovo contatto quando troviamo un nuovo "name"
      if (mappedField === "name" && (currentContact.name || currentContact.email || currentContact.title)) {
        contacts.push({ ...currentContact });
        currentContact = {};
      }

      if (val) {
        if (mappedField === "email" && val.includes("@")) currentContact.email = val;
        else if (mappedField === "email") { /* skip non-email */ }
        else currentContact[mappedField] = val;
      }
    });
    if (currentContact.name || currentContact.email || currentContact.title) {
      contacts.push(currentContact);
    }
    return contacts;
  }

  // STRATEGIA 2: Fallback — walk all elements (per HTML non-standard)
  let currentContact = {};
  let lastLabel = null;
  const allEls = $container.find("*").toArray();

  for (const el of allEls) {
    const $el = $(el);
    if ($el.children().length > 5) continue;
    const directText = $el.clone().children().remove().end().text().trim();
    const text = directText || $el.text().trim();
    if (!text || text.length > 200) continue;

    const cleanLabel = text.replace(/:\s*$/, "").trim().toLowerCase();
    const mappedField = CONTACT_LABELS[cleanLabel];

    if (mappedField) {
      if (mappedField === "name" && (currentContact.name || currentContact.email || currentContact.title)) {
        contacts.push({ ...currentContact });
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
  if (currentContact.name || currentContact.email || currentContact.title) {
    contacts.push(currentContact);
  }
  return contacts;
}

// ═══ FUNZIONE PRINCIPALE: extractProfile ═══
function extractProfile($, wcaId, sourceBase) {
  const base = sourceBase || BASE;
  const result = {
    wca_id: wcaId, state: "ok", company_name: "", logo_url: null, branch: "",
    gm_coverage: null, gm_status_text: "", enrolled_offices: [], enrolled_since: "",
    expires: "", networks: [], profile_text: "", address: "", mailing: "", phone: "",
    fax: "", emergency_call: "", website: "", email: "", contacts: [], services: [],
    certifications: [], branch_cities: [], access_limited: false, members_only_count: 0,
  };

  // Company name — WCA usa <span class="company"> dentro <div class="company_name">, NON h1
  let companyName = $(".company_name .company, span.company").first().text().trim();
  if (!companyName) companyName = $(".company_name").first().text().trim();
  if (!companyName) companyName = $("h1.company, h1").first().text().trim(); // fallback h1
  // Pulisci: rimuovi newline, branch info tra parentesi, whitespace multiplo
  companyName = companyName.replace(/\n/g, " ").replace(/\s*\(.*?\)\s*$/, "").replace(/\s{2,}/g, " ").trim();
  result.company_name = companyName;
  if (!companyName || /not\s*found|error|404|page\s*not/i.test(companyName)) {
    // Ultima chance: controlla se c'è un profile_wrapper con dati
    const hasProfileData = $(".profile_wrapper").length > 0 && $(".profile_label").length > 0;
    if (!hasProfileData) return { wca_id: wcaId, state: "not_found" };
  }

  // Logo
  $("img[src]").each((_, el) => {
    if (result.logo_url) return;
    const src = $(el).attr("src") || "";
    if ((src.toLowerCase().includes("companylogo") || src.toLowerCase().includes("company_logo") || src.toLowerCase().includes("/companylogos/")) && !isWcaSiteLogo(src)) {
      result.logo_url = resolveUrl(src, base);
    }
  });
  if (!result.logo_url) {
    const logoSelectors = ["img.company_logo", "img.companylogo", ".company_logo img", ".companylogo img", ".profile_logo img", ".member-logo img", ".member_logo img", ".logo-container img"];
    for (const sel of logoSelectors) {
      const logoEl = $(sel).first();
      if (logoEl.length) {
        const src = logoEl.attr("src") || "";
        if (!isWcaSiteLogo(src)) { result.logo_url = resolveUrl(src, base); if (result.logo_url) break; }
      }
    }
  }
  if (!result.logo_url) {
    $("img[src*='logo'], img[src*='Logo']").each((_, el) => {
      if (result.logo_url) return;
      const src = $(el).attr("src") || "";
      if (!isWcaSiteLogo(src)) result.logo_url = resolveUrl(src, base);
    });
  }
  if (!result.logo_url) {
    $("img[src]").each((_, el) => {
      if (result.logo_url) return;
      const src = $(el).attr("src") || "";
      const w = parseInt($(el).attr("width") || "0");
      const h = parseInt($(el).attr("height") || "0");
      if ((w >= 50 || h >= 50) && !isWcaSiteLogo(src)) result.logo_url = resolveUrl(src, base);
    });
  }

  // Branch & ID
  result.branch = $(".branchname").first().text().trim();
  const compid = $(".compid span, .compid").first().text().trim();
  const idMatch = compid.match(/\d+/);
  if (idMatch) result.wca_id = parseInt(idMatch[0]);

  // GM Coverage
  const officeRow = $(".office_row").first();
  if (officeRow.length) {
    const alertText = officeRow.text().trim();
    result.gm_status_text = alertText;
    result.gm_coverage = !/no\s*coverage|not\s*covered/i.test(alertText);
  }

  // Enrolled offices
  $(".enrolledoffice_mainbox .office_country_wrapper, .enrolledoffice_mainbox tr").each((_, el) => {
    const text = $(el).text().trim();
    const goldNote = $(el).find(".gold_note").text().trim();
    const covered = !/not\s*covered/i.test(goldNote) && !/not\s*covered/i.test(text);
    const countryCity = text.replace(goldNote, "").trim();
    if (countryCity) result.enrolled_offices.push({ location: countryCity, covered });
  });

  // Enrolled since — cerca nel testo completo della pagina
  const fullPageText = $.text();
  const sinceMatch = fullPageText.match(/(?:Proudly\s+)?Enrolled\s+Since:?\s*([A-Za-z]+\s+\d{1,2},?\s+\d{4})/i);
  if (sinceMatch) result.enrolled_since = sinceMatch[1].trim();
  // Fallback vecchio metodo
  if (!result.enrolled_since) {
    $(".announce-display").each((_, el) => {
      const t = $(el).text().trim();
      const m = t.match(/since:?\s*(.+)/i);
      if (m) result.enrolled_since = m[1].trim();
    });
  }

  // Expires
  const expiresMatch = fullPageText.match(/Membership\s+Expires:?\s*([A-Za-z]+\s+\d{1,2},?\s+\d{4})/i);
  if (expiresMatch) result.expires = expiresMatch[1].trim();
  if (!result.expires) {
    $(".memberprofile_memberof, .memberof_expire").each((_, el) => {
      const t = $(el).text().trim();
      const m = t.match(/expires?:?\s*(.+)/i);
      if (m && !result.expires) result.expires = m[1].trim().split("\n")[0].trim();
    });
  }

  // Networks
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

  // Profile text
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

  // Address & Mailing — WCA usa .profile_addr con <span> per ogni riga
  $(".profile_addr").each((_, el) => {
    if (!result.address) {
      const parts = [];
      $(el).find("span").each((_, s) => { const t = $(s).text().trim(); if (t) parts.push(t); });
      if (parts.length) result.address = parts.join(", ");
      else result.address = $(el).text().trim().replace(/\s+/g, " ");
    }
  });
  // Fallback: vecchio metodo con .profile_headline
  if (!result.address) {
    $(".profile_headline").each((_, el) => {
      if (/address/i.test($(el).text())) {
        const next = $(el).next("span, div, p, .profile_addr");
        if (next.length) result.address = next.html().replace(/<br\s*\/?>/gi, ", ").replace(/<[^>]+>/g, "").trim();
      }
    });
  }
  $(".profile_headline").each((_, el) => {
    if (/mailing/i.test($(el).text())) {
      const next = $(el).next("span, div, p");
      if (next.length) result.mailing = next.text().trim();
    }
  });

  // Phone, fax, email, website — strategia 1: .profile_row
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

  // Strategia 2: .profile_label siblings
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

  // ═══ CONTACTS ═══
  // 1. Container CSS selectors
  const contactSelectors = [".contactperson_row", "[class*='contactperson']", "[class*='contact_person']", "[class*='office_contact']", "[class*='officecontact']", "[class*='ContactPerson']"];
  for (const sel of contactSelectors) {
    const rows = $(sel);
    if (rows.length === 0) continue;
    console.log(`[extract] ${wcaId}: found ${rows.length} elements for selector "${sel}"`);
    rows.each((_, row) => {
      const rowContacts = extractContactsFromContainer($, $(row));
      console.log(`[extract] ${wcaId}: selector "${sel}" row → ${rowContacts.length} contacts: ${JSON.stringify(rowContacts).substring(0, 200)}`);
      for (const c of rowContacts) {
        if (c.name || c.email || c.title) {
          if (!c.name && c.title) c.name = c.title;
          result.contacts.push(c);
        }
      }
    });
    if (result.contacts.length > 0) break;
  }

  // 2. Full "Office Contacts" section
  if (result.contacts.length === 0) {
    const bodyHtml = $.html();
    const contactSectionMatch = bodyHtml.match(/Office\s*Contacts([\s\S]*?)(?=<\/body>|$)/i);
    console.log(`[extract] ${wcaId}: "Office Contacts" section found: ${!!contactSectionMatch} (htmlLen=${bodyHtml.length})`);
    if (contactSectionMatch) {
      console.log(`[extract] ${wcaId}: Office Contacts snippet: ${contactSectionMatch[0].substring(0, 300)}`);
      const $section = cheerio.load(contactSectionMatch[0]);
      const sectionContacts = extractContactsFromContainer($section, $section.root());
      console.log(`[extract] ${wcaId}: Office Contacts extraction → ${sectionContacts.length} contacts`);
      for (const c of sectionContacts) {
        if (c.name || c.email || c.title) {
          if (!c.name && c.title) c.name = c.title;
          result.contacts.push(c);
        }
      }
    }
  }

  // 3. Regex text-based fallback
  if (result.contacts.length === 0) {
    console.log(`[extract] ${wcaId}: CSS+Office both empty, trying regex. mailto count: ${$("a[href^='mailto:']").length}`);
    const fullText = $.text();
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

  // 4. Mailto links fallback
  if (result.contacts.length === 0) {
    $("a[href^='mailto:']").each((_, el) => {
      const email = ($(el).attr("href") || "").replace("mailto:", "").trim();
      if (email && !result.contacts.find(c => c.email === email)) {
        result.contacts.push({ email, name: $(el).text().trim() || email });
      }
    });
  }

  // Services, certifications, branch_cities
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

  // ═══ ACCESS LIMITED detection ═══
  let membersOnlyInProfile = 0;
  $(".profile_label, .profile_detail, .profile_value, .profile_val, .contact_detail, .contact_info, [class*='profile'] td, [class*='contact'] td").each((_, el) => {
    if (/Members\s*Only/i.test($(el).text().trim())) membersOnlyInProfile++;
  });
  result.members_only_count = membersOnlyInProfile;

  const hasContactEmails = result.contacts.some(c => c.email);
  const hasCompanyEmail = !!result.email;
  const hasContacts = result.contacts.length > 0;
  const hasPhone = !!result.phone;

  // access_limited scatta quando ci sono campi "Members only" E mancano i contatti email
  // Prima era troppo restrittivo (richiedeva TUTTI i campi mancanti)
  // Ora: se ci sono >2 "Members only" E nessuna email nei contatti → limitato
  if (membersOnlyInProfile > 2 && !hasContactEmails) {
    result.access_limited = true;
  }

  // ═══ hasLogout — segnale di autenticazione riuscita ═══
  const fullHtml = $.html();
  result.hasLogout = /logout|sign.?out/i.test(fullHtml);

  console.log(`[extract] ${wcaId}: contacts=${result.contacts.length} email=${hasCompanyEmail} phone=${hasPhone} limited=${result.access_limited} membersOnly=${membersOnlyInProfile}`);
  return result;
}

// ═══ ESTRAZIONE MEMBRI DA DIRECTORY HTML ═══
function extractMembersFromHtml(html) {
  const members = [];
  const seenIds = new Set();
  const $ = cheerio.load(html);

  // Prima prova li.directoyname (typo WCA originale) e li.directoryname
  $("li.directoyname a[href], li.directoryname a[href]").each((_, el) => {
    const href = $(el).attr("href") || "";
    const match = href.match(/\/directory\/members\/(\d+)/i);
    if (match) {
      const id = parseInt(match[1]);
      if (!seenIds.has(id)) { seenIds.add(id); members.push({ id, name: $(el).text().trim(), href }); }
    }
  });

  // Fallback: qualsiasi link a /directory/members/
  if (members.length === 0) {
    $("a[href]").each((_, el) => {
      const href = $(el).attr("href") || "";
      const match = href.match(/\/directory\/members\/(\d+)/i);
      if (match) {
        const id = parseInt(match[1]);
        if (!seenIds.has(id) && id > 0) { seenIds.add(id); members.push({ id, name: $(el).text().trim(), href }); }
      }
    });
  }

  let totalResults = null;
  const totalMatch = html.match(/(\d[\d,]*)\s*(results?|members?|companies|records?|found|total)/i);
  if (totalMatch) totalResults = parseInt(totalMatch[1].replace(/,/g, ""));
  if (!totalResults) {
    const compMatch = html.match(/(\d[\d,]*)\s*compan/i);
    if (compMatch) totalResults = parseInt(compMatch[1].replace(/,/g, ""));
  }

  return { members, totalResults };
}

// ═══ NETWORK NAME → DOMAIN ═══
function networkNameToDomains(networkNames) {
  const domains = [];
  for (const netName of networkNames) {
    const lower = netName.toLowerCase();
    for (const [key, domain] of Object.entries(NAME_TO_DOMAIN)) {
      if (lower.includes(key) && !domains.includes(domain)) domains.push(domain);
    }
  }
  return domains;
}

module.exports = {
  extractProfile,
  extractMembersFromHtml,
  extractContactsFromContainer,
  networkNameToDomains,
  NETWORK_DOMAINS,
  getNetworkBase,
  NAME_TO_DOMAIN,
};
