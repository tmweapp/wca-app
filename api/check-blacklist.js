/**
 * api/check-blacklist.js — Verifica partner nella blacklist WCA
 *
 * Flusso:
 * 1. Riceve lista di wca_id (o country_code per check massivo)
 * 2. Per ogni ID, controlla la pagina profilo WCA per status "suspended", "terminated", "blacklisted"
 * 3. Aggiorna il campo `blacklist_status` in Supabase
 * 4. Ritorna lista di partner con status aggiornato
 */
const fetch = require("node-fetch");
const { ssoLogin, getCachedCookies, saveCookiesToCache, testCookies, UA, BASE, SUPABASE_URL, SUPABASE_KEY } = require("./utils/auth");

// Parole chiave che indicano blacklist/sospensione sulla pagina profilo WCA
const BLACKLIST_KEYWORDS = [
  /\bsuspended\b/i,
  /\bterminated\b/i,
  /\bblacklisted\b/i,
  /\bblack\s*list/i,
  /\bno longer a member\b/i,
  /\bmembership.*cancelled/i,
  /\bmembership.*revoked/i,
  /\bexpelled\b/i,
  /\bremoved from.*network/i,
];

async function checkSingleBlacklist(wcaId, cookies) {
  const url = `${BASE}/Profile?CompanyId=${wcaId}`;
  try {
    const resp = await fetch(url, {
      headers: {
        "User-Agent": UA,
        "Cookie": cookies,
        "Accept": "text/html",
      },
      redirect: "follow",
      timeout: 12000,
    });
    if (!resp.ok) return { wca_id: wcaId, status: "error", detail: `HTTP ${resp.status}` };

    const html = await resp.text();

    // Check per redirect al login
    if (html.includes('type="password"') || resp.url.toLowerCase().includes("/login")) {
      return { wca_id: wcaId, status: "login_required" };
    }

    // Check se il membro non esiste più
    if (/member\s*not\s*found|page\s*not\s*found/i.test(html)) {
      return { wca_id: wcaId, status: "not_found", blacklisted: false };
    }

    // Cerca keyword blacklist nel testo della pagina
    const textContent = html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    for (const pattern of BLACKLIST_KEYWORDS) {
      const match = textContent.match(pattern);
      if (match) {
        // Estrai contesto attorno al match
        const idx = textContent.indexOf(match[0]);
        const context = textContent.substring(Math.max(0, idx - 80), Math.min(textContent.length, idx + 120)).trim();
        return { wca_id: wcaId, status: "blacklisted", blacklisted: true, keyword: match[0], context };
      }
    }

    // Controlla se membership è scaduta controllando il testo "expires"
    const expiresMatch = textContent.match(/Membership\s+Expires:?\s*([A-Za-z]+\s+\d{1,2},?\s+\d{4})/i);
    let expired = false;
    let expiresDate = null;
    if (expiresMatch) {
      expiresDate = expiresMatch[1].trim();
      const d = new Date(expiresDate);
      if (!isNaN(d.getTime()) && d < new Date()) {
        expired = true;
      }
    }

    return {
      wca_id: wcaId,
      status: expired ? "expired" : "active",
      blacklisted: false,
      expired,
      expires: expiresDate,
    };
  } catch (e) {
    return { wca_id: wcaId, status: "error", detail: e.message };
  }
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  try {
    const { wcaIds, countryCode, limit: maxCheck = 50 } = req.body || {};

    // Ottieni cookies SSO
    let cookies = null;
    const cached = await getCachedCookies("wcaworld.com");
    if (cached) {
      cookies = cached.cookies;
      const valid = await testCookies(cookies, BASE);
      if (!valid) cookies = null;
    }
    if (!cookies) {
      const loginResult = await ssoLogin(null, null, BASE);
      if (!loginResult.success) return res.status(500).json({ error: "SSO login fallito: " + loginResult.error });
      cookies = loginResult.cookies;
      await saveCookiesToCache(cookies, "wcaworld.com", loginResult.ssoCookies || "");
    }

    let idsToCheck = [];

    if (wcaIds && Array.isArray(wcaIds) && wcaIds.length > 0) {
      idsToCheck = wcaIds.slice(0, maxCheck);
    } else if (countryCode) {
      // Carica tutti gli ID per il paese da Supabase
      const url = `${SUPABASE_URL}/rest/v1/wca_partners?select=wca_id&country_code=eq.${countryCode.toUpperCase()}&limit=${maxCheck}`;
      const dbResp = await fetch(url, {
        headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}` },
      });
      if (dbResp.ok) {
        const rows = await dbResp.json();
        idsToCheck = rows.map(r => r.wca_id);
      }
    }

    if (idsToCheck.length === 0) {
      return res.json({ success: true, results: [], message: "Nessun ID da verificare" });
    }

    console.log(`[check-blacklist] Verificando ${idsToCheck.length} partner...`);
    const results = [];
    let blacklisted = 0;
    let expired = 0;

    for (const id of idsToCheck) {
      const result = await checkSingleBlacklist(id, cookies);
      results.push(result);

      if (result.blacklisted) blacklisted++;
      if (result.expired) expired++;

      // Aggiorna Supabase con lo status
      if (result.status !== "error" && result.status !== "login_required") {
        try {
          await fetch(`${SUPABASE_URL}/rest/v1/wca_partners?wca_id=eq.${id}`, {
            method: "PATCH",
            headers: {
              "Content-Type": "application/json",
              "apikey": SUPABASE_KEY,
              "Authorization": `Bearer ${SUPABASE_KEY}`,
              "Prefer": "return=minimal",
            },
            body: JSON.stringify({
              blacklist_status: result.blacklisted ? "blacklisted" : (result.expired ? "expired" : "active"),
              blacklist_checked_at: new Date().toISOString(),
            }),
          });
        } catch (e) {
          console.warn(`[check-blacklist] DB update failed for ${id}:`, e.message);
        }
      }

      // Pausa 1s tra richieste
      if (idsToCheck.indexOf(id) < idsToCheck.length - 1) {
        await new Promise(r => setTimeout(r, 1000));
      }
    }

    return res.json({
      success: true,
      results,
      summary: {
        total: results.length,
        active: results.filter(r => r.status === "active").length,
        blacklisted,
        expired,
        errors: results.filter(r => r.status === "error").length,
      },
    });
  } catch (err) {
    console.error("[check-blacklist] Error:", err.message);
    return res.status(500).json({ success: false, error: err.message });
  }
};
