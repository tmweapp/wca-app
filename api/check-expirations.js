/**
 * api/check-expirations.js — Controlla le date di scadenza dei partner
 *
 * Flusso:
 * 1. Legge tutti i partner da Supabase con campo `expires`
 * 2. Identifica: scaduti, in scadenza (30/60/90 giorni), attivi
 * 3. Opzionale: ri-scarica il profilo per aggiornare la data di scadenza
 * 4. Ritorna report di scadenze
 */
const fetch = require("node-fetch");

const SUPABASE_URL = process.env.SUPABASE_URL || "https://dlldkrzoxvjxpgkkttxu.supabase.co";
const SUPABASE_KEY = (process.env.SUPABASE_SERVICE_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRsbGRrcnpveHZqeHBna2t0dHh1Iiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc1ODcyMDU4NCwiZXhwIjoyMDc0Mjk2NTg0fQ.py_d96kA6Mqvi0ugBm4gmIlJSoOC_KbwUM7cgDR-O_E").trim();

// Mesi inglesi per parsing
const MONTHS = {
  "jan":0,"feb":1,"mar":2,"apr":3,"may":4,"jun":5,
  "jul":6,"aug":7,"sep":8,"oct":9,"nov":10,"dec":11,
  "january":0,"february":1,"march":2,"april":3,"june":5,
  "july":6,"august":7,"september":8,"october":9,"november":10,"december":11
};

function parseExpiresDate(str) {
  if (!str) return null;
  const cleaned = str.trim().replace(/,/g, "").replace(/\s+/g, " ");

  // Prova Date.parse nativo
  const d = new Date(cleaned);
  if (!isNaN(d.getTime()) && d.getFullYear() > 2000 && d.getFullYear() < 2040) return d;

  // Fallback: "Month DD YYYY"
  const m = cleaned.match(/([A-Za-z]+)\s+(\d{1,2})\s+(\d{4})/);
  if (m) {
    const mon = MONTHS[m[1].toLowerCase()];
    if (mon !== undefined) return new Date(parseInt(m[3]), mon, parseInt(m[2]));
  }

  // Fallback: "DD Month YYYY"
  const m2 = cleaned.match(/(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})/);
  if (m2) {
    const mon = MONTHS[m2[2].toLowerCase()];
    if (mon !== undefined) return new Date(parseInt(m2[3]), mon, parseInt(m2[1]));
  }

  return null;
}

function daysBetween(d1, d2) {
  return Math.ceil((d2 - d1) / (1000 * 60 * 60 * 24));
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const { countryCode, thresholdDays = 90, page = 1, limit = 500 } = req.method === "POST" ? (req.body || {}) : (req.query || {});

    // Carica partner con campo expires da Supabase
    let url = `${SUPABASE_URL}/rest/v1/wca_partners?select=wca_id,company_name,country_code,expires,updated_at,blacklist_status&limit=${limit}&offset=${(parseInt(page) - 1) * parseInt(limit)}`;
    if (countryCode) url += `&country_code=eq.${countryCode.toUpperCase()}`;

    const dbResp = await fetch(url, {
      headers: {
        "apikey": SUPABASE_KEY,
        "Authorization": `Bearer ${SUPABASE_KEY}`,
        "Prefer": "count=exact",
      },
    });

    if (!dbResp.ok) {
      const err = await dbResp.text();
      return res.json({ success: false, error: `Supabase ${dbResp.status}: ${err}` });
    }

    const partners = await dbResp.json();
    const total = parseInt(dbResp.headers.get("content-range")?.split("/")?.[1] || partners.length);
    const now = new Date();

    const expiredList = [];
    const expiringList = [];
    const activeList = [];
    const unknownList = [];
    let noDate = 0;

    for (const p of partners) {
      const expDate = parseExpiresDate(p.expires);
      if (!expDate) {
        noDate++;
        unknownList.push({
          wca_id: p.wca_id,
          company_name: p.company_name,
          country_code: p.country_code,
          expires: p.expires || "",
          status: "unknown",
          blacklist_status: p.blacklist_status || null,
        });
        continue;
      }

      const daysRemaining = daysBetween(now, expDate);
      const entry = {
        wca_id: p.wca_id,
        company_name: p.company_name,
        country_code: p.country_code,
        expires: p.expires,
        expires_date: expDate.toISOString().split("T")[0],
        days_remaining: daysRemaining,
        updated_at: p.updated_at,
        blacklist_status: p.blacklist_status || null,
      };

      if (daysRemaining < 0) {
        entry.status = "expired";
        expiredList.push(entry);
      } else if (daysRemaining <= parseInt(thresholdDays)) {
        entry.status = "expiring";
        expiringList.push(entry);
      } else {
        entry.status = "active";
        activeList.push(entry);
      }
    }

    // Ordina per urgenza
    expiredList.sort((a, b) => a.days_remaining - b.days_remaining);
    expiringList.sort((a, b) => a.days_remaining - b.days_remaining);

    return res.json({
      success: true,
      total,
      summary: {
        total: partners.length,
        expired: expiredList.length,
        expiring: expiringList.length,
        active: activeList.length,
        unknown: noDate,
      },
      expired: expiredList,
      expiring: expiringList,
      unknown: unknownList.slice(0, 50), // max 50 sconosciuti
    });
  } catch (err) {
    console.error("[check-expirations] Error:", err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
};
