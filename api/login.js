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
      const isValid = await testCookies(result.cookies, BASE);
      console.log(`[login] User login success, testCookies=${isValid}, saving to cache for scrape reuse`);
      if (isValid) {
        await saveCookiesToCache(result.cookies, "wcaworld.com", result.ssoCookies || "");
        console.log(`[login] ✓ Cookies utente salvati in cache — il scrape li userà`);
      }
    }

    return res.json(result);
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message, stack: err.stack });
  }
};
