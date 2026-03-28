/**
 * api/save-directory.js — Salva i dati della directory in Supabase
 *
 * Riceve un batch di membri da un paese e li salva/aggiorna in wca_partners
 * con dati minimi (wca_id, company_name, country_code, networks).
 * Usa upsert: se il partner esiste già, aggiorna solo i campi directory.
 */
const fetch = require("node-fetch");
const { SUPABASE_URL, SUPABASE_KEY } = require("./utils/auth");

// ISO code → country name (compact)
const CC = {"AF":"Afghanistan","AL":"Albania","DZ":"Algeria","AR":"Argentina","AM":"Armenia","AU":"Australia","AT":"Austria","AZ":"Azerbaijan","BH":"Bahrain","BD":"Bangladesh","BY":"Belarus","BE":"Belgium","BO":"Bolivia","BA":"Bosnia and Herzegovina","BR":"Brazil","BN":"Brunei","BG":"Bulgaria","KH":"Cambodia","CM":"Cameroon","CA":"Canada","CL":"Chile","CN":"China","CO":"Colombia","CR":"Costa Rica","HR":"Croatia","CU":"Cuba","CY":"Cyprus","CZ":"Czech Republic","DK":"Denmark","DO":"Dominican Republic","EC":"Ecuador","EG":"Egypt","SV":"El Salvador","EE":"Estonia","ET":"Ethiopia","FI":"Finland","FR":"France","GE":"Georgia","DE":"Germany","GH":"Ghana","GR":"Greece","GT":"Guatemala","HN":"Honduras","HK":"Hong Kong","HU":"Hungary","IS":"Iceland","IN":"India","ID":"Indonesia","IR":"Iran","IQ":"Iraq","IE":"Ireland","IL":"Israel","IT":"Italy","CI":"Ivory Coast","JM":"Jamaica","JP":"Japan","JO":"Jordan","KZ":"Kazakhstan","KE":"Kenya","KR":"South Korea","KW":"Kuwait","LA":"Laos","LV":"Latvia","LB":"Lebanon","LY":"Libya","LT":"Lithuania","LU":"Luxembourg","MY":"Malaysia","MV":"Maldives","MT":"Malta","MU":"Mauritius","MX":"Mexico","MN":"Mongolia","ME":"Montenegro","MA":"Morocco","MZ":"Mozambique","MM":"Myanmar","NP":"Nepal","NL":"Netherlands","NZ":"New Zealand","NI":"Nicaragua","NG":"Nigeria","NO":"Norway","OM":"Oman","PK":"Pakistan","PA":"Panama","PY":"Paraguay","PE":"Peru","PH":"Philippines","PL":"Poland","PT":"Portugal","QA":"Qatar","RO":"Romania","RU":"Russia","SA":"Saudi Arabia","SN":"Senegal","RS":"Serbia","SG":"Singapore","SK":"Slovakia","SI":"Slovenia","ZA":"South Africa","ES":"Spain","LK":"Sri Lanka","SD":"Sudan","SE":"Sweden","CH":"Switzerland","SY":"Syria","TW":"Taiwan","TZ":"Tanzania","TH":"Thailand","TN":"Tunisia","TR":"Turkey","AE":"United Arab Emirates","UG":"Uganda","UA":"Ukraine","GB":"United Kingdom","US":"United States","UY":"Uruguay","UZ":"Uzbekistan","VE":"Venezuela","VN":"Vietnam","YE":"Yemen","ZM":"Zambia","ZW":"Zimbabwe","TT":"Trinidad and Tobago","BW":"Botswana","MW":"Malawi","NA":"Namibia","RW":"Rwanda","MG":"Madagascar","FJ":"Fiji","PG":"Papua New Guinea","KG":"Kyrgyzstan","TJ":"Tajikistan","TM":"Turkmenistan","MK":"North Macedonia","XK":"Kosovo","LI":"Liechtenstein","MC":"Monaco","SM":"San Marino","AD":"Andorra","PR":"Puerto Rico","BB":"Barbados","BS":"Bahamas","GY":"Guyana","SR":"Suriname","BZ":"Belize","HT":"Haiti","CW":"Curaçao","MQ":"Martinique"};

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  try {
    const { countryCode, members } = req.body || {};
    if (!countryCode) return res.status(400).json({ error: "countryCode richiesto" });
    if (!members || !Array.isArray(members) || members.length === 0) {
      return res.status(400).json({ error: "members array richiesto" });
    }

    const countryName = CC[countryCode] || countryCode;

    // Prepara righe per upsert batch — max 500 alla volta
    const BATCH_SIZE = 500;
    let saved = 0, errors = 0;

    for (let i = 0; i < members.length; i += BATCH_SIZE) {
      const batch = members.slice(i, i + BATCH_SIZE);
      const rows = batch.map(m => ({
        wca_id: m.id,
        company_name: m.name || "",
        country_code: countryCode,
        country_name: countryName,
        networks: m.networks || [],
        scrape_url: m.scrape_url || "",
        directory_synced_at: new Date().toISOString(),
      }));

      const resp = await fetch(`${SUPABASE_URL}/rest/v1/wca_partners?on_conflict=wca_id`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "apikey": SUPABASE_KEY,
          "Authorization": `Bearer ${SUPABASE_KEY}`,
          "Prefer": "resolution=merge-duplicates,return=minimal",
        },
        body: JSON.stringify(rows),
      });

      if (resp.ok) {
        saved += batch.length;
      } else {
        const err = await resp.text();
        console.log(`[save-directory] Supabase batch error ${resp.status}: ${err.substring(0, 200)}`);
        errors += batch.length;
      }
    }

    console.log(`[save-directory] ${countryCode} (${countryName}): ${saved} saved, ${errors} errors, total=${members.length}`);
    return res.json({ success: true, countryCode, countryName, saved, errors, total: members.length });
  } catch (err) {
    console.log(`[save-directory] Exception: ${err.message}`);
    return res.status(500).json({ success: false, error: err.message });
  }
};
