/**
 * api/test-auth.js v30 — Diagnostico SSO
 * GET /api/test-auth?wcaId=24995
 * Mostra TUTTO: log SSO, cookies, profilo, contatti
 */
const fetch = require("node-fetch");
const cheerio = require("cheerio");
const { BASE, UA, ssoLogin } = require("./utils/auth");
const { extractProfile } = require("./utils/extract");

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(200).end();

  const wcaId = req.query.wcaId || "24995";
  const diag = { wcaId, timestamp: new Date().toISOString() };

  try {
    // Fresh SSO login (no cache)
    const loginResult = await ssoLogin(null, null, BASE);
    diag.loginSuccess = loginResult.success;
    diag.loginError = loginResult.error || null;
    diag.ssoLog = loginResult.log || [];
    diag.cookieLen = loginResult.cookies ? loginResult.cookies.length : 0;

    if (loginResult.cookies) {
      const parts = loginResult.cookies.split("; ");
      diag.cookieNames = parts.map(p => p.split("=")[0]);
      diag.hasASPXAUTH = loginResult.cookies.includes(".ASPXAUTH");
      // Mostra lunghezza di ogni cookie value
      diag.cookieSizes = {};
      for (const p of parts) {
        const eq = p.indexOf("=");
        if (eq > 0) diag.cookieSizes[p.substring(0, eq)] = p.substring(eq + 1).length;
      }
    }

    if (!loginResult.success || !loginResult.cookies) {
      return res.json({ success: false, diag });
    }

    const cookies = loginResult.cookies;

    // Fetch profilo
    const profileUrl = `${BASE}/directory/members/${wcaId}`;
    diag.profileUrl = profileUrl;

    const resp = await fetch(profileUrl, {
      headers: { "User-Agent": UA, "Cookie": cookies, "Referer": BASE + "/Directory" },
      timeout: 15000,
    });
    const html = await resp.text();
    diag.profileStatus = resp.status;
    diag.profileLen = html.length;
    diag.hasLogout = /logout|sign.?out/i.test(html);
    diag.membersOnlyCount = (html.match(/Members\s*Only/gi) || []).length;

    const $ = cheerio.load(html);
    const profile = extractProfile($, wcaId, BASE);
    diag.profileState = profile.state;
    diag.company = profile.company_name;
    diag.email = profile.email || "";
    diag.phone = profile.phone || "";
    diag.contactCount = (profile.contacts || []).length;
    diag.contacts = (profile.contacts || []).slice(0, 5);

    // Test partner italiano
    try {
      const itResp = await fetch(`${BASE}/directory/members/97136`, {
        headers: { "User-Agent": UA, "Cookie": cookies, "Referer": BASE + "/Directory" },
        timeout: 15000,
      });
      const itHtml = await itResp.text();
      const $it = cheerio.load(itHtml);
      const itProfile = extractProfile($it, 97136, BASE);
      diag.italyTest = {
        hasLogout: /logout|sign.?out/i.test(itHtml),
        membersOnly: (itHtml.match(/Members\s*Only/gi) || []).length,
        contacts: (itProfile.contacts || []).slice(0, 3),
        email: itProfile.email || "",
      };
    } catch (e) { diag.italyTest = { error: e.message }; }

    return res.json({ success: true, diag });
  } catch (err) {
    diag.error = err.message;
    diag.stack = err.stack.split("\n").slice(0, 5);
    return res.json({ success: false, diag });
  }
};
