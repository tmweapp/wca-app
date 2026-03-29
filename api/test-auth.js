/**
 * api/test-auth.js — Endpoint diagnostico per testare SSO login + scrape
 * GET /api/test-auth?wcaId=24995
 */
const fetch = require("node-fetch");
const cheerio = require("cheerio");
const { BASE, UA, ssoLogin } = require("./utils/auth");
const { extractProfile } = require("./utils/extract");

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(200).end();

  const wcaId = req.query.wcaId || "24995";
  const diag = { wcaId, steps: [] };

  try {
    // Step 1: Fresh SSO login (no cache)
    diag.steps.push("1. SSO login starting...");
    const loginResult = await ssoLogin(null, null, BASE);
    diag.loginSuccess = loginResult.success;
    diag.loginError = loginResult.error || null;
    diag.hasAuth = loginResult.cookies ? loginResult.cookies.includes(".ASPXAUTH") : false;
    diag.cookieLen = loginResult.cookies ? loginResult.cookies.length : 0;
    diag.ssoCookieLen = loginResult.ssoCookies ? loginResult.ssoCookies.length : 0;
    diag.wcaToken = loginResult.wcaToken ? "yes" : "no";
    diag.jarDump = loginResult.jarDump || null;

    if (!loginResult.success) {
      return res.json({ success: false, diag });
    }

    const cookies = loginResult.cookies;
    const ssoCookies = loginResult.ssoCookies || "";

    // Step 2: Fetch profile page
    const profileUrl = `${BASE}/directory/members/${wcaId}`;
    diag.steps.push(`2. Fetching ${profileUrl}`);

    let currentUrl = profileUrl;
    let redirectCount = 0;
    let resp;

    while (redirectCount < 5) {
      const isSSO = currentUrl.includes("sso.api.wcaworld.com");
      const cookiesToSend = isSSO ? ssoCookies : cookies;

      resp = await fetch(currentUrl, {
        headers: {
          "User-Agent": UA, "Cookie": cookiesToSend,
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Referer": BASE + "/Directory",
        },
        redirect: "manual", timeout: 15000,
      });

      if (resp.status >= 300 && resp.status < 400) {
        const loc = resp.headers.get("location") || "";
        diag.steps.push(`  redirect ${resp.status} → ${loc.substring(0, 100)}`);
        if (!loc) break;
        currentUrl = loc.startsWith("http") ? loc : new URL(loc, currentUrl).href;
        if (currentUrl.toLowerCase().includes("/login")) {
          diag.steps.push("  ⚠ REDIRECT TO LOGIN — NOT AUTHENTICATED");
          diag.loginRedirect = true;
          return res.json({ success: false, diag });
        }
        redirectCount++;
        continue;
      }
      break;
    }

    const html = await resp.text();
    diag.steps.push(`3. Got HTML: status=${resp.status} len=${html.length}`);

    // Step 3: Check auth indicators in HTML
    const $ = cheerio.load(html);
    diag.hasLogout = /logout|sign.?out/i.test(html);
    diag.hasPasswordField = html.includes('type="password"');
    diag.membersOnlyCount = (html.match(/Members\s*Only/gi) || []).length;
    diag.profileLabels = $(".profile_label").length;
    diag.h1 = $("h1").first().text().trim().substring(0, 100);

    // Step 4: Extract profile
    diag.steps.push("4. Extracting profile...");
    const profile = extractProfile($, wcaId, BASE);
    diag.profileState = profile.state;
    diag.contactCount = (profile.contacts || []).length;
    diag.contactsHaveEmail = (profile.contacts || []).some(c => c.email);
    diag.email = profile.email || "";
    diag.phone = profile.phone || "";
    diag.networks = profile.networks || [];
    diag.accessLimited = profile.access_limited || false;
    diag.contacts = (profile.contacts || []).slice(0, 5).map(c => ({
      name: c.name, title: c.title, email: c.email || "-", phone: c.phone || "-",
      direct_line: c.direct_line || "-", mobile: c.mobile || "-"
    }));

    return res.json({ success: true, diag });
  } catch (err) {
    diag.error = err.message;
    diag.stack = err.stack;
    return res.json({ success: false, diag });
  }
};
