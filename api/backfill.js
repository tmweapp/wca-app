/**
 * backfill.js — Ricalcola country_name, city, member_since, direct_phone
 * per tutti i record esistenti in wca_partners.
 *
 * GET /api/backfill         → esegue backfill completo
 * GET /api/backfill?dry=1   → mostra solo i cambiamenti senza scrivere
 */
const fetch = require("node-fetch");

const SUPABASE_URL = process.env.SUPABASE_URL || "https://dlldkrzoxvjxpgkkttxu.supabase.co";
const SUPABASE_KEY = (process.env.SUPABASE_SERVICE_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRsbGRrcnpveHZqeHBna2t0dHh1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1ODcyMDU4NCwiZXhwIjoyMDc0Mjk2NTg0fQ.py_d96kA6Mqvi0ugBm4gmIlJSoOC_KbwUM7cgDR-O_E").trim();
const HEADERS = { "Content-Type": "application/json", "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}` };

// Import the same logic from save.js (duplicated here for self-containment in serverless)
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
  "MG":"Madagascar","FJ":"Fiji","PG":"Papua New Guinea","KG":"Kyrgyzstan",
  "TJ":"Tajikistan","TM":"Turkmenistan","MK":"North Macedonia","XK":"Kosovo",
  "LI":"Liechtenstein","MC":"Monaco","SM":"San Marino","AD":"Andorra",
  "PR":"Puerto Rico","BB":"Barbados","BS":"Bahamas","GY":"Guyana","SR":"Suriname",
  "BZ":"Belize","HT":"Haiti","CW":"Curaçao","MQ":"Martinique",
};

function extractCity(address, branch, branchCities) {
  if (Array.isArray(branchCities) && branchCities.length > 0) {
    const city = branchCities[0].replace(/\s*\(.*?\)\s*/g, "").trim();
    if (city && city.length > 1 && city.length < 50) return city;
  }
  if (branch) {
    const clean = branch.replace(/\s*\(.*?\)\s*/g, "").replace(/head\s*office/i, "").trim();
    if (clean && clean.length > 1 && clean.length < 50) return clean;
  }
  if (address) {
    const parts = address.split(",").map(p => p.trim()).filter(Boolean);
    if (parts.length >= 2) {
      let cityCandidate = parts[parts.length - 2]
        .replace(/^\d{3,7}\s*/, "").replace(/\s*\d{3,7}$/, "").trim();
      if (cityCandidate && cityCandidate.length > 1 && !/^\d+$/.test(cityCandidate) &&
          !/^(P\.?O\.?\s*Box|Suite|Floor|Unit|Building|Block|Lot)/i.test(cityCandidate)) {
        return cityCandidate;
      }
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

function parseMemberSince(enrolledSince) {
  if (!enrolledSince) return null;
  const cleaned = enrolledSince.trim().replace(/,/g, "").replace(/\s+/g, " ");
  const d = new Date(cleaned);
  if (!isNaN(d.getTime()) && d.getFullYear() > 1990 && d.getFullYear() < 2030) {
    return d.toISOString().split("T")[0];
  }
  const months = {"jan":"01","feb":"02","mar":"03","apr":"04","may":"05","jun":"06",
    "jul":"07","aug":"08","sep":"09","oct":"10","nov":"11","dec":"12",
    "january":"01","february":"02","march":"03","april":"04","june":"06",
    "july":"07","august":"08","september":"09","october":"10","november":"11","december":"12"};
  const m = cleaned.match(/([A-Za-z]+)\s+(\d{1,2})\s+(\d{4})/);
  if (m) { const mon = months[m[1].toLowerCase()]; if (mon) return `${m[3]}-${mon}-${m[2].padStart(2, "0")}`; }
  const yearMatch = cleaned.match(/(\d{4})/);
  if (yearMatch) { const y = parseInt(yearMatch[1]); if (y > 1990 && y < 2030) return `${y}-01-01`; }
  return null;
}

function normalizeContacts(contacts) {
  if (!Array.isArray(contacts)) return [];
  return contacts.map(c => {
    const n = { ...c };
    if (!n.direct_phone && !n.direct_line) {
      if (n.mobile) n.direct_phone = n.mobile;
    } else if (n.direct_line && !n.direct_phone) {
      n.direct_phone = n.direct_line;
    }
    return n;
  });
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(200).end();

  const dry = req.query?.dry === "1";

  try {
    // Fetch all partners
    const r = await fetch(`${SUPABASE_URL}/rest/v1/wca_partners?select=wca_id,country_code,address,branch,branch_cities,enrolled_since,contacts,country_name,city,member_since&limit=5000`, {
      headers: HEADERS,
    });
    if (!r.ok) return res.status(500).json({ error: "Fetch partners failed: " + await r.text() });
    const partners = await r.json();

    const stats = {
      total: partners.length,
      country_name_fixed: 0, city_fixed: 0, member_since_fixed: 0, contacts_fixed: 0,
      still_missing_city: 0, still_missing_member_since: 0,
      samples: [],
    };

    for (const p of partners) {
      const cc = (p.country_code || "").toUpperCase();
      const newCountryName = CC_TO_NAME[cc] || cc || "";
      const newCity = extractCity(p.address || "", p.branch || "", p.branch_cities || []);
      const newMemberSince = parseMemberSince(p.enrolled_since);
      const newContacts = normalizeContacts(p.contacts || []);

      const changes = {};
      let changed = false;

      // country_name: fix se mancante o uguale al codice ISO
      if (!p.country_name || p.country_name === cc || p.country_name.length <= 2) {
        if (newCountryName && newCountryName !== cc) {
          changes.country_name = newCountryName;
          stats.country_name_fixed++;
          changed = true;
        }
      }

      // city: fix se mancante o "Unknown"
      if (!p.city || p.city === "Unknown" || p.city === "unknown") {
        if (newCity) {
          changes.city = newCity;
          stats.city_fixed++;
          changed = true;
        } else {
          stats.still_missing_city++;
        }
      }

      // member_since: fix se mancante
      if (!p.member_since) {
        if (newMemberSince) {
          changes.member_since = newMemberSince;
          stats.member_since_fixed++;
          changed = true;
        } else {
          stats.still_missing_member_since++;
        }
      }

      // contacts: fix direct_phone
      const hasDirectPhoneChange = newContacts.some((c, i) => {
        const old = (p.contacts || [])[i];
        return c.direct_phone && (!old || !old.direct_phone);
      });
      if (hasDirectPhoneChange) {
        changes.contacts = newContacts;
        stats.contacts_fixed++;
        changed = true;
      }

      if (changed && stats.samples.length < 5) {
        stats.samples.push({ wca_id: p.wca_id, changes });
      }

      if (changed && !dry) {
        changes.updated_at = new Date().toISOString();
        await fetch(`${SUPABASE_URL}/rest/v1/wca_partners?wca_id=eq.${p.wca_id}`, {
          method: "PATCH",
          headers: { ...HEADERS, "Prefer": "return=minimal" },
          body: JSON.stringify(changes),
        });
      }
    }

    return res.json({
      success: true,
      dry_run: dry,
      stats,
    });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
};
