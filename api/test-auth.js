/**
 * api/test-auth.js — Endpoint diagnostico per testare SSO login + scrape
 * GET /api/test-auth?wcaId=24995
 */
const fetch = require("node-fetch");
const cheerio = require("cheerio");
const { BASE, UA, ssoLogin, testCookies } = require("./utils/auth");
const { extractProfile } = require("./utils/extract");

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  if (req.method === "OPTIONS") return res.status(200).end();

  const wcaId = req.query.wcaId || "24995";
  const diag = { wcaId, steps: [], timestamp: new Date().toISOString() };

  try {
    // Step 1: Fresh SSO login (no cache)
    diag.steps.push("1. SSO login starting...");
    const loginResult = await ssoLogin(null, null, BASE);
    diag.loginSuccess = loginResult.success;
    diag.loginError = loginResult.error || null;
    diag.hasAuth = loginResult.cookies ? loginResult.cookies.includes(".ASPXAUTH") : false;
    diag.cookieLen = loginResult.cookies ? loginResult.cookies.length : 0;
    diag.ssoCookieLen = loginResult.ssoCookies ? loginResult.ssoCookies.length : 0;
    diag.wcaToken = loginResult.wcaToken ? loginResult.wcaToken.substring(0, 20) + "..." : "none";
    diag.jarDump = loginResult.jarDump || null;

    // Show cookie VALUES (masked) to check if .ASPXAUTH is real
    if (loginResult.cookies) {
      const cookieParts = loginResult.cookies.split("; ");
      diag.cookieValues = {};
      for (const cp of cookieParts) {
        const eq = cp.indexOf("=");
        if (eq > 0) {
          const name = cp.substring(0, eq);
          const val = cp.substring(eq + 1);
          diag.cookieValues[name] = val.length > 10 ? val.substring(0, 10) + `...(${val.length}chars)` : val;
        }
      }
    }

    if (!loginResult.success) {
      return res.json({ success: false, diag });
    }

    const cookies = loginResult.cookies;

    // Step 2: Test cookies with testCookies()
    diag.steps.push("2. Testing cookies with testCookies()...");
    const cookiesValid = await testCookies(cookies, BASE);
    diag.testCookiesResult = cookiesValid;

    // Step 3: Fetch /Directory to check login status
    diag.steps.push("3. Fetching /Directory...");
    const dirResp = await fetch(`${BASE}/Directory`, {
      headers: { "User-Agent": UA, "Cookie": cookies },
      redirect: "manual", timeout: 10000,
    });
    diag.directoryStatus = dirResp.status;
    diag.directoryLocation = dirResp.headers.get("location") || "none";
    if (dirResp.status === 200) {
      const dirHtml = await dirResp.text();
      diag.directoryHasLogout = /logout|sign.?out/i.test(dirHtml);
      diag.directoryHasPassword = dirHtml.includes('type="password"');
      diag.directoryLen = dirHtml.length;
      // Check for username display (logged in indicator)
      const userMatch = dirHtml.match(/Welcome,?\s*([^<]+)/i) || dirHtml.match(/tmsrlmin/i);
      diag.directoryUserFound = !!userMatch;
    }

    // Step 4: Fetch profile page for the requested partner
    const profileUrl = `${BASE}/directory/members/${wcaId}`;
    diag.steps.push(`4. Fetching profile ${profileUrl}...`);

    let currentUrl = profileUrl;
    let redirectCount = 0;
    let resp;
    diag.profileRedirects = [];

    while (redirectCount < 5) {
      resp = await fetch(currentUrl, {
        headers: {
          "User-Agent": UA, "Cookie": cookies,
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Referer": BASE + "/Directory",
        },
        redirect: "manual", timeout: 15000,
      });

      if (resp.status >= 300 && resp.status < 400) {
        const loc = resp.headers.get("location") || "";
        diag.profileRedirects.push(`${resp.status} → ${loc.substring(0, 120)}`);
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
    diag.steps.push(`5. Got profile HTML: status=${resp.status} len=${html.length}`);

    // Check auth indicators in HTML
    const $ = cheerio.load(html);
    diag.hasLogout = /logout|sign.?out/i.test(html);
    diag.hasPasswordField = html.includes('type="password"');
    diag.membersOnlyCount = (html.match(/Members\s*Only/gi) || []).length;
    diag.h1 = $("h1").first().text().trim().substring(0, 100);

    // Check for specific auth indicators in the page
    diag.hasLoginLink = /\/Account\/Login/i.test(html);
    diag.hasWelcome = /welcome/i.test(html);
    diag.hasMyProfile = /my.?profile/i.test(html);

    // Extract profile
    diag.steps.push("6. Extracting profile...");
    const profile = extractProfile($, wcaId, BASE);
    diag.profileState = profile.state;
    diag.contactCount = (profile.contacts || []).length;
    diag.contactsHaveEmail = (profile.contacts || []).some(c => c.email);
    diag.email = profile.email || "";
    diag.phone = profile.phone || "";
    diag.contacts = (profile.contacts || []).slice(0, 3).map(c => ({
      name: c.name, email: c.email || "-", phone: c.phone || "-"
    }));

    // Step 7: Also test an Italian partner (known to work on March 28)
    diag.steps.push("7. Testing Italian partner 97136 (A.P. Logistic)...");
    try {
      const itResp = await fetch(`${BASE}/directory/members/97136`, {
        headers: { "User-Agent": UA, "Cookie": cookies, "Referer": BASE + "/Directory" },
        timeout: 15000,
      });
      const itHtml = await itResp.text();
      const $it = cheerio.load(itHtml);
      const itProfile = extractProfile($it, 97136, BASE);
      diag.italyTest = {
        status: itResp.status,
        hasLogout: /logout|sign.?out/i.test(itHtml),
        membersOnly: (itHtml.match(/Members\s*Only/gi) || []).length,
        contactCount: (itProfile.contacts || []).length,
        contactsHaveEmail: (itProfile.contacts || []).some(c => c.email),
        firstContact: (itProfile.contacts || [])[0] || null
      };
    } catch (e) {
      diag.italyTest = { error: e.message };
    }

    return res.json({ success: true, diag });
  } catch (err) {
    diag.error = err.message;
    diag.stack = err.stack.split("\n").slice(0, 5);
    return res.json({ success: false, diag });
  }
};
