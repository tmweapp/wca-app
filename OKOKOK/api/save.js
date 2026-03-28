const fetch = require("node-fetch");

const SUPABASE_URL = process.env.SUPABASE_URL || "https://dlldkrzoxvjxpgkkttxu.supabase.co";
const SUPABASE_KEY = (process.env.SUPABASE_SERVICE_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRsbGRrcnpveHZqeHBna2t0dHh1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1ODcyMDU4NCwiZXhwIjoyMDc0Mjk2NTg0fQ.py_d96kA6Mqvi0ugBm4gmIlJSoOC_KbwUM7cgDR-O_E").trim();

// ═══ ISO CODE → COUNTRY NAME ═══
const CC_TO_NAME = {
  "AF":"Afghanistan","AL":"Albania","DZ":"Algeria","AR":"Argentina","AM":"Armenia",
  "AU":"Australia","AT":"Austria","AZ":"Azerbaijan","BH":"Bahrain","BD":"Bangladesh",
  "BY":"Belarus","BE":"Belgium","BO":"Bolivia","BA":"Bosnia and Herzegovina","BR":"Brazil",
  "BN":"Brunei","BG":"Bulgaria","KH":"Cambodia","CM":"Cameroon","CA":"Canada",
  "CL":"Chile","CN":"China","CO":"Colombia","CR":"Costa Rica","HR":"Croatia",
  "CU":"Cuba","CY":"Cyprus","CZ":"Czech Republic","DK":"Denmark","DO":"Dominican Republic",
  "EC":"Ecuador","EG":"Egypt","SV":"El Salvador","EE":"Estonia","ET":"Ethiopia",
  "FI":"Finland","FR":"France","GE":"Georgia","DE":"Germany","GH":"Ghana",
  "GR":"Greece","GT":"Guatemala","HN":"Honduras","HK":"Hong Kong","HU":"Hungary",
  "IS":"Iceland","IN":"India","ID":"Indonesia","IR":"Iran","IQ":"Iraq",
  "IE":"Ireland","IL":"Israel","IT":"Italy","CI":"Ivory Coast","JM":"Jamaica",
  "JP":"Japan","JO":"Jordan","KZ":"Kazakhstan","KE":"Kenya","KR":"South Korea",
  "KW":"Kuwait","LA":"Laos","LV":"Latvia","LB":"Lebanon","LY":"Libya",
  "LT":"Lithuania","LU":"Luxembourg","MY":"Malaysia","MV":"Maldives","MT":"Malta",
  "MU":"Mauritius","MX":"Mexico","MN":"Mongolia","ME":"Montenegro","MA":"Morocco",
  "MZ":"Mozambique","MM":"Myanmar","NP":"Nepal","NL":"Netherlands","NZ":"New Zealand",
  "NI":"Nicaragua","NG":"Nigeria","NO":"Norway","OM":"Oman","PK":"Pakistan",
  "PA":"Panama","PY":"Paraguay","PE":"Peru","PH":"Philippines","PL":"Poland",
  "PT":"Portugal","QA":"Qatar","RO":"Romania","RU":"Russia","SA":"Saudi Arabia",
  "SN":"Senegal","RS":"Serbia","SG":"Singapore","SK":"Slovakia","SI":"Slovenia",
  "ZA":"South Africa","ES":"Spain","LK":"Sri Lanka","SD":"Sudan","SE":"Sweden",
  "CH":"Switzerland","SY":"Syria","TW":"Taiwan","TZ":"Tanzania","TH":"Thailand",
  "TN":"Tunisia","TR":"Turkey","AE":"United Arab Emirates","UG":"Uganda","UA":"Ukraine",
  "GB":"United Kingdom","US":"United States","UY":"Uruguay","UZ":"Uzbekistan",
  "VE":"Venezuela","VN":"Vietnam","YE":"Yemen","ZM":"Zambia","ZW":"Zimbabwe",
  "TT":"Trinidad and Tobago","BW":"Botswana","MW":"Malawi","NA":"Namibia","RW":"Rwanda",
  "MG":"Madagascar","FJ":"Fiji","PG":"Papua New Guinea","LA":"Laos","KG":"Kyrgyzstan",
  "TJ":"Tajikistan","TM":"Turkmenistan","MK":"North Macedonia","XK":"Kosovo",
  "LI":"Liechtenstein","MC":"Monaco","SM":"San Marino","AD":"Andorra",
  "PR":"Puerto Rico","BB":"Barbados","BS":"Bahamas","GY":"Guyana","SR":"Suriname",
  "BZ":"Belize","HT":"Haiti","CW":"Curaçao","MQ":"Martinique",
};

// ═══ EXTRACT CITY FROM ADDRESS ═══
function extractCity(address, branch, branchCities) {
  // 1. branch_cities è la fonte più affidabile
  if (Array.isArray(branchCities) && branchCities.length > 0) {
    // Prendi la prima città che non sia un paese
    const city = branchCities[0].replace(/\s*\(.*?\)\s*/g, "").trim();
    if (city && city.length > 1 && city.length < 50) return city;
  }

  // 2. branch spesso contiene la città
  if (branch) {
    const clean = branch.replace(/\s*\(.*?\)\s*/g, "").replace(/head\s*office/i, "").trim();
    if (clean && clean.length > 1 && clean.length < 50) return clean;
  }

  // 3. Estrai dall'address — tipico formato: "Via X, 123, City, Country" o "City, Country"
  if (address) {
    const parts = address.split(",").map(p => p.trim()).filter(Boolean);
    if (parts.length >= 2) {
      // L'ultimo pezzo è di solito il paese, il penultimo la città
      // Ma potrebbe esserci il CAP: "12345 City" o "City 12345"
      let cityCandidate = parts[parts.length - 2];

      // Rimuovi CAP/ZIP
      cityCandidate = cityCandidate.replace(/^\d{3,7}\s*/, "").replace(/\s*\d{3,7}$/, "").trim();

      // Controlla che non sia solo un numero, un indirizzo stradale, o troppo corto
      if (cityCandidate && cityCandidate.length > 1 && !/^\d+$/.test(cityCandidate) &&
          !/^(P\.?O\.?\s*Box|Suite|Floor|Unit|Building|Block|Lot)/i.test(cityCandidate)) {
        return cityCandidate;
      }

      // Prova il terzultimo se il penultimo era un CAP
      if (parts.length >= 3) {
        let alt = parts[parts.length - 3].replace(/^\d{3,7}\s*/, "").replace(/\s*\d{3,7}$/, "").trim();
        if (alt && alt.length > 1 && !/^\d+$/.test(alt) &&
            !/^(P\.?O\.?\s*Box|Suite|Floor|Unit|Building|Block|Lot|\d)/i.test(alt)) {
          return alt;
        }
      }
    }
  }

  return "";
}

// ═══ PARSE ENROLLED_SINCE → ISO DATE ═══
function parseMemberSince(enrolledSince) {
  if (!enrolledSince) return null;

  // Formati WCA: "June 15, 2010", "March 1, 2008", "Jun 15 2010", etc.
  const cleaned = enrolledSince.trim()
    .replace(/,/g, "")     // rimuovi virgole
    .replace(/\s+/g, " "); // normalizza spazi

  // Prova Date.parse nativo
  const d = new Date(cleaned);
  if (!isNaN(d.getTime()) && d.getFullYear() > 1990 && d.getFullYear() < 2030) {
    return d.toISOString().split("T")[0]; // "YYYY-MM-DD"
  }

  // Fallback: regex per "Month DD YYYY"
  const months = {"jan":"01","feb":"02","mar":"03","apr":"04","may":"05","jun":"06",
    "jul":"07","aug":"08","sep":"09","oct":"10","nov":"11","dec":"12",
    "january":"01","february":"02","march":"03","april":"04","june":"06",
    "july":"07","august":"08","september":"09","october":"10","november":"11","december":"12"};

  const m = cleaned.match(/([A-Za-z]+)\s+(\d{1,2})\s+(\d{4})/);
  if (m) {
    const mon = months[m[1].toLowerCase()];
    if (mon) return `${m[3]}-${mon}-${m[2].padStart(2, "0")}`;
  }

  // Fallback: solo anno
  const yearMatch = cleaned.match(/(\d{4})/);
  if (yearMatch) {
    const y = parseInt(yearMatch[1]);
    if (y > 1990 && y < 2030) return `${y}-01-01`;
  }

  return null;
}

// ═══ NORMALIZE CONTACTS: direct_phone fallback ═══
function normalizeContacts(contacts) {
  if (!Array.isArray(contacts)) return [];
  return contacts.map(c => {
    const normalized = { ...c };

    // direct_phone: usa direct_line, poi phone, poi mobile come fallback
    if (!normalized.direct_phone && !normalized.direct_line) {
      // Nessun telefono diretto — usa mobile come fallback
      if (normalized.mobile) {
        normalized.direct_phone = normalized.mobile;
      }
    } else if (normalized.direct_line && !normalized.direct_phone) {
      normalized.direct_phone = normalized.direct_line;
    }

    return normalized;
  });
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  try {
    const { profile } = req.body || {};
    if (!profile || !profile.wca_id) return res.status(400).json({ error: "profile con wca_id richiesto" });

    // ═══ FIX 1: COUNTRY CODE + COUNTRY NAME ═══
    let cc = profile.country_code || "";
    if (!cc || cc.length > 2) {
      const addr = profile.address || "";
      const addrParts = addr.split(",");
      cc = addrParts.length > 1 ? addrParts[addrParts.length - 1].trim() : "";
    }
    cc = cc.toUpperCase();
    const countryName = CC_TO_NAME[cc] || cc || "";

    // ═══ FIX 2: CITY — extraction robusta ═══
    const city = extractCity(
      profile.address || "",
      profile.branch || "",
      profile.branch_cities || []
    );

    // ═══ FIX 3: MEMBER SINCE — parse date ═══
    const memberSince = parseMemberSince(profile.enrolled_since);

    // ═══ FIX 4: CONTACTS — normalize direct_phone ═══
    const contacts = normalizeContacts(profile.contacts || []);

    const row = {
      wca_id: profile.wca_id, company_name: profile.company_name || "", logo_url: profile.logo_url || null,
      branch: profile.branch || "", gm_coverage: profile.gm_coverage ?? null,
      gm_status_text: profile.gm_status_text || "",
      enrolled_offices: profile.enrolled_offices || [], enrolled_since: profile.enrolled_since || "",
      expires: profile.expires || "", networks: profile.networks || [],
      profile_text: profile.profile_text || "",
      address: profile.address || "", mailing: profile.mailing || "", phone: profile.phone || "",
      fax: profile.fax || "", emergency_call: profile.emergency_call || "",
      website: profile.website || "", email: profile.email || "",
      contacts: contacts, services: profile.services || [],
      certifications: profile.certifications || [], branch_cities: profile.branch_cities || [],
      country_code: cc,
      country_name: countryName,       // ← NUOVO: nome esteso del paese
      city: city,                      // ← NUOVO: città estratta
      member_since: memberSince,       // ← NUOVO: data ISO
      raw_data: profile, updated_at: new Date().toISOString(),
    };

    console.log(`[save] Saving wca_id=${profile.wca_id} company="${profile.company_name}" country="${countryName}" city="${city}" member_since="${memberSince}" contacts=${contacts.length}`);
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/wca_partners?on_conflict=wca_id`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json", "apikey": SUPABASE_KEY,
        "Authorization": `Bearer ${SUPABASE_KEY}`, "Prefer": "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify(row),
    });

    if (!resp.ok) {
      const err = await resp.text();
      console.log(`[save] Supabase error ${resp.status}: ${err}`);
      return res.json({ success: false, error: `Supabase ${resp.status}: ${err}` });
    }

    console.log(`[save] OK wca_id=${profile.wca_id}`);
    return res.json({ success: true, wca_id: profile.wca_id });
  } catch (err) {
    console.log(`[save] Exception: ${err.message}`);
    return res.status(500).json({ success: false, error: err.message });
  }
};
