const { ssoLogin, saveCookiesToCache, testCookies, BASE } = require("./utils/auth");

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  try {
    const { username, password } = req.body || {};
    const result = await ssoLogin(username, password);

    // ═══ CRITICO: salva i cookies del login utente nella cache Supabase ═══
    // Così il /api/scrape li riusa invece delle credenziali hardcoded
    if (result.success && result.cookies) {
      // Salva SEMPRE se il login SSO ha avuto successo — non usare testCookies come gate.
      // testCookies può fallire anche con cookies validi (WCA risponde diversamente,
      // nessun logout link, timeout) e impedirebbe il salvataggio della sessione utente.
      await saveCookiesToCache(result.cookies, "wcaworld.com", result.ssoCookies || "");
      const hasASPX = result.cookies.includes(".ASPXAUTH");
      console.log(`[login] ✓ Cookies utente salvati in cache (hasASPX=${hasASPX}) — il scrape li userà`);
    }

    return res.json(result);
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message, stack: err.stack });
  }
};
