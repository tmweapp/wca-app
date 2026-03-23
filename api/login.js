const fetch = require("node-fetch");
const cheerio = require("cheerio");

const BASE = "https://www.wcaworld.com";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

// SSO login flow for WCA
async function ssoLogin(username, password) {
  // Step 1: GET login page → get base cookies + SSO URL
  let resp = await fetch(`${BASE}/Account/Login`, { headers: { "User-Agent": UA }, redirect: "manual" });
  let baseCookies = (resp.headers.raw()["set-cookie"] || []).map(c => c.split(";")[0]);
  let currentUrl = `${BASE}/Account/Login`;
  let rc = 0;
  while (resp.status >= 300 && resp.status < 400 && rc < 5) {
    const loc = resp.headers.get("location") || "";
    currentUrl = loc.startsWith("http") ? loc : new URL(loc, currentUrl).href;
    resp = await fetch(currentUrl, { headers: { "User-Agent": UA, "Cookie": baseCookies.join("; ") }, redirect: "manual" });
    baseCookies = [...baseCookies, ...(resp.headers.raw()["set-cookie"] || []).map(c => c.split(";")[0])];
    rc++;
  }
  const loginHtml = resp.status === 200 ? await resp.text() : "";

  // Extract SSO URL from JavaScript in the page
  const ssoUrlMatch = loginHtml.match(/action\s*[:=]\s*['"]?(https:\/\/sso\.api\.wcaworld\.com[^'"&\s]+[^'"]*)/i);
  if (!ssoUrlMatch) {
    return { success: false, error: "SSO URL not found in login page" };
  }
  const ssoUrl = ssoUrlMatch[1].replace(/&amp;/g, "&");
  console.log(`[login] SSO URL found: ${ssoUrl.substring(0, 80)}...`);

  // Step 2: POST credentials to SSO endpoint
  const ssoFormBody = `UserName=${encodeURIComponent(username)}&Password=${encodeURIComponent(password)}&pwd=${encodeURIComponent(password)}`;
  const ssoResp = await fetch(ssoUrl, {
    method: "POST",
    headers: {
      "User-Agent": UA,
      "Content-Type": "application/x-www-form-urlencoded",
      "Origin": "https://sso.api.wcaworld.com",
      "Referer": ssoUrl,
    },
    body: ssoFormBody,
    redirect: "manual",
  });

  const ssoCookies = (ssoResp.headers.raw()["set-cookie"] || []).map(c => c.split(";")[0]);
  const hasAuth = ssoCookies.some(c => c.includes(".ASPXAUTH"));
  console.log(`[login] SSO POST status=${ssoResp.status} hasAuth=${hasAuth} cookies=${ssoCookies.map(c => c.split("=")[0]).join(",")}`);

  if (!hasAuth || ssoResp.status < 300 || ssoResp.status >= 400) {
    return { success: false, error: "SSO login failed - no auth cookie", ssoStatus: ssoResp.status };
  }

  // Step 3: Follow redirect to WCA SsoLoginResult
  const ssoRedirectUrl = ssoResp.headers.get("location") || "";
  console.log(`[login] SSO redirect to: ${ssoRedirectUrl.substring(0, 100)}`);

  if (!ssoRedirectUrl) {
    return { success: false, error: "SSO no redirect URL" };
  }

  // Combine base cookies + SSO cookies
  let allCookies = [...baseCookies, ...ssoCookies];

  // Follow the callback chain back to WCA
  let callbackUrl = ssoRedirectUrl.startsWith("http") ? ssoRedirectUrl : new URL(ssoRedirectUrl, ssoUrl).href;
  let followCount = 0;
  while (callbackUrl && followCount < 8) {
    const cbResp = await fetch(callbackUrl, {
      headers: { "User-Agent": UA, "Cookie": allCookies.join("; ") },
      redirect: "manual",
    });
    const newCookies = (cbResp.headers.raw()["set-cookie"] || []).map(c => c.split(";")[0]);
    allCookies = [...allCookies, ...newCookies];
    console.log(`[login] Callback ${followCount + 1}: ${callbackUrl.substring(0, 80)} → status=${cbResp.status} +${newCookies.length}cookies`);

    const nextLoc = cbResp.headers.get("location") || "";
    if (nextLoc) {
      callbackUrl = nextLoc.startsWith("http") ? nextLoc : new URL(nextLoc, callbackUrl).href;
    } else {
      callbackUrl = null;
    }
    followCount++;

    // If 200, we're done
    if (cbResp.status === 200) break;
  }

  // Dedup cookies
  const cookieMap = {};
  for (const c of allCookies) {
    const eq = c.indexOf("=");
    if (eq > 0) cookieMap[c.substring(0, eq)] = c;
  }
  let sessionCookies = Object.values(cookieMap).join("; ");

  // Step 4: Warmup - visit Directory to get extra session cookies + wca.token
  let wcaToken = null;
  try {
    let wr = await fetch(`${BASE}/Directory`, {
      headers: { "User-Agent": UA, "Cookie": sessionCookies },
      redirect: "manual",
    });
    let wCookies = (wr.headers.raw()["set-cookie"] || []).map(c => c.split(";")[0]);
    let wLoc = wr.headers.get("location") || "";
    let wCount = 0;
    while (wLoc && wCount < 3) {
      const wNext = wLoc.startsWith("http") ? wLoc : new URL(wLoc, `${BASE}/Directory`).href;
      wr = await fetch(wNext, { headers: { "User-Agent": UA, "Cookie": sessionCookies }, redirect: "manual" });
      wCookies = [...wCookies, ...(wr.headers.raw()["set-cookie"] || []).map(c => c.split(";")[0])];
      wLoc = wr.headers.get("location") || "";
      wCount++;
    }
    if (wr.status === 200) {
      const wHtml = await wr.text();
      const tokenMatch = wHtml.match(/window\.wca\.token\s*=\s*["']([^"']+)["']/);
      if (tokenMatch) wcaToken = tokenMatch[1];
      if (!wcaToken) {
        const tokenMatch2 = wHtml.match(/wca\.token\s*=\s*["']([^"']+)["']/);
        if (tokenMatch2) wcaToken = tokenMatch2[1];
      }
    }
    if (wCookies.length) {
      const cMap = {};
      for (const c of sessionCookies.split("; ")) { const eq = c.indexOf("="); if (eq > 0) cMap[c.substring(0, eq)] = c; }
      for (const c of wCookies) { const eq = c.indexOf("="); if (eq > 0) cMap[c.substring(0, eq)] = c; }
      sessionCookies = Object.values(cMap).join("; ");
    }
  } catch (e) {
    console.log(`[login] Warmup error: ${e.message}`);
  }

  console.log(`[login] SSO login complete: cookieLen=${sessionCookies.length} hasAuth=${sessionCookies.includes(".ASPXAUTH")} keys=${Object.keys(cookieMap).join(",")}`);
  return { success: true, cookies: sessionCookies, wcaToken };
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  try {
    const { username: reqUser, password: reqPass } = req.body || {};
    const username = reqUser || process.env.WCA_USERNAME || "tmsrlmin";
    const password = reqPass || process.env.WCA_PASSWORD || "G0u3v!VvCn";

    const result = await ssoLogin(username, password);
    return res.json(result);
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message, stack: err.stack });
  }
};
