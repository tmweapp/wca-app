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

    if (result.success && result.cookies) {
      const isValid = await testCookies(result.cookies, BASE);
      console.log(`[login] testCookies=${isValid}`);
      if (isValid) {
        await saveCookiesToCache(result.cookies, "wcaworld.com");
      }
    }

    // Non ritornare il log enorme al frontend
    return res.json({ success: result.success, error: result.error || null });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};
