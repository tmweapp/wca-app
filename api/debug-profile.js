const fetch = require("node-fetch");
const cheerio = require("cheerio");

const BASE = "https://www.wcaworld.com";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const wcaId = req.body?.wcaId || req.query?.id || 52156;
  const debug = { steps: [] };

  try {
    const username = "tmsrlmin";
    const password = "G0u3v!VvCn";

    // Step 1: GET login page to get base cookies and SSO session ID
    debug.steps.push("1. GET /Account/Login");
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
    debug.steps.push(`   cookies=${baseCookies.length}, htmlLen=${loginHtml.length}`);

    // Extract SSO URL from the login page JavaScript
    const ssoUrlMatch = loginHtml.match(/action\s*[:=]\s*['"]?(https:\/\/sso\.api\.wcaworld\.com[^'"&\s]+[^'"]*)/i);
    const ssoUrl = ssoUrlMatch ? ssoUrlMatch[1].replace(/&amp;/g, "&") : null;
    debug.ssoUrl = ssoUrl ? ssoUrl.substring(0, 150) + "..." : "NOT FOUND";

    // Extract sid from SSO URL
    const sidMatch = ssoUrl ? ssoUrl.match(/sid=([^&]+)/) : null;
    const sid = sidMatch ? sidMatch[1] : null;
    debug.sid = sid;

    const cookieStr = baseCookies.join("; ");

    // Step 2: Call /api/ssorequest to get SSO configuration
    debug.steps.push("2. GET /api/ssorequest");
    let ssoReqResp;
    try {
      ssoReqResp = await fetch(`${BASE}/api/ssorequest`, {
        headers: { "User-Agent": UA, "Cookie": cookieStr, "X-Requested-With": "XMLHttpRequest" },
      });
      const ssoReqBody = await ssoReqResp.text();
      debug.ssoRequestStatus = ssoReqResp.status;
      debug.ssoRequestBody = ssoReqBody.substring(0, 500);
      debug.steps.push(`   status=${ssoReqResp.status} body=${ssoReqBody.substring(0, 100)}`);
    } catch (e) {
      debug.steps.push(`   ERROR: ${e.message}`);
    }

    // Step 3: POST credentials to SSO endpoint
    if (ssoUrl) {
      debug.steps.push("3. POST credentials to SSO endpoint");

      // Try form POST to SSO
      const ssoFormBody = `UserName=${encodeURIComponent(username)}&Password=${encodeURIComponent(password)}&pwd=${encodeURIComponent(password)}`;
      const ssoResp1 = await fetch(ssoUrl, {
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
      const ssoCookies1 = (ssoResp1.headers.raw()["set-cookie"] || []).map(c => c.split(";")[0]);
      let ssoBody1 = "";
      try { ssoBody1 = await ssoResp1.text(); } catch(e) {}
      debug.attempts = debug.attempts || [];
      debug.attempts.push({
        name: "Form POST to SSO URL",
        status: ssoResp1.status,
        location: ssoResp1.headers.get("location") || "none",
        cookies: ssoCookies1.map(c => c.split("=")[0]),
        bodySnippet: ssoBody1.substring(0, 400),
      });

      // Try JSON POST to SSO
      const ssoResp2 = await fetch(ssoUrl, {
        method: "POST",
        headers: {
          "User-Agent": UA,
          "Content-Type": "application/json",
          "Origin": "https://sso.api.wcaworld.com",
        },
        body: JSON.stringify({ UserName: username, Password: password, pwd: password }),
        redirect: "manual",
      });
      const ssoCookies2 = (ssoResp2.headers.raw()["set-cookie"] || []).map(c => c.split(";")[0]);
      let ssoBody2 = "";
      try { ssoBody2 = await ssoResp2.text(); } catch(e) {}
      debug.attempts.push({
        name: "JSON POST to SSO URL",
        status: ssoResp2.status,
        location: ssoResp2.headers.get("location") || "none",
        cookies: ssoCookies2.map(c => c.split("=")[0]),
        bodySnippet: ssoBody2.substring(0, 400),
      });

      // Try GET the SSO URL first (it might be a page with its own login form)
      const ssoGetResp = await fetch(ssoUrl, {
        headers: { "User-Agent": UA },
        redirect: "manual",
      });
      let ssoGetCookies = (ssoGetResp.headers.raw()["set-cookie"] || []).map(c => c.split(";")[0]);
      let ssoGetBody = "";
      if (ssoGetResp.status === 200) {
        ssoGetBody = await ssoGetResp.text();
      } else if (ssoGetResp.status >= 300 && ssoGetResp.status < 400) {
        ssoGetBody = `REDIRECT → ${ssoGetResp.headers.get("location")}`;
      }
      debug.ssoPageGet = {
        status: ssoGetResp.status,
        cookies: ssoGetCookies.map(c => c.split("=")[0]),
        bodySnippet: ssoGetBody.substring(0, 500),
        hasForm: ssoGetBody.includes("<form"),
        hasPasswordField: ssoGetBody.includes('type="password"') || ssoGetBody.includes("type='password'"),
      };

      // If SSO page has a form, parse it
      if (ssoGetBody.includes("<form") || ssoGetBody.includes('type="password"')) {
        debug.steps.push("3b. SSO page has a form - parsing it");
        const $sso = cheerio.load(ssoGetBody);
        const ssoForms = [];
        $sso("form").each((i, el) => {
          const action = $sso(el).attr("action") || "(no action)";
          const method = $sso(el).attr("method") || "GET";
          const inputs = [];
          $sso(el).find("input").each((_, inp) => {
            inputs.push({ name: $sso(inp).attr("name"), type: $sso(inp).attr("type"), id: $sso(inp).attr("id") });
          });
          ssoForms.push({ action, method, inputs });
        });
        debug.ssoForms = ssoForms;

        // Try to submit the SSO form
        if (ssoForms.length > 0) {
          const ssoForm = ssoForms.find(f => f.inputs.some(i => i.type === "password")) || ssoForms[0];
          const ssoFormAction = ssoForm.action.startsWith("http") ? ssoForm.action : new URL(ssoForm.action, ssoUrl).href;

          // Build form data
          const ssoFormData = {};
          $sso("form").first().find("input").each((_, el) => {
            const name = $sso(el).attr("name");
            const type = ($sso(el).attr("type") || "text").toLowerCase();
            if (name && type !== "submit" && type !== "button") {
              ssoFormData[name] = $sso(el).attr("value") || "";
            }
          });

          // Find and fill username/password
          for (const inp of ssoForm.inputs) {
            if (inp.type === "password") ssoFormData[inp.name] = password;
            else if ((inp.type === "text" || inp.type === "email") && (inp.name || "").toLowerCase().match(/user|email|login|name/)) ssoFormData[inp.name] = username;
          }

          debug.steps.push(`3c. POST SSO form to ${ssoFormAction.substring(0, 80)}`);
          debug.ssoFormData = Object.keys(ssoFormData);

          const ssoCookieStr = ssoGetCookies.join("; ");
          const ssoPostResp = await fetch(ssoFormAction, {
            method: "POST",
            headers: {
              "User-Agent": UA,
              "Content-Type": "application/x-www-form-urlencoded",
              "Cookie": ssoCookieStr,
              "Referer": ssoUrl,
              "Origin": new URL(ssoUrl).origin,
            },
            body: Object.entries(ssoFormData).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join("&"),
            redirect: "manual",
          });

          const ssoPostCookies = (ssoPostResp.headers.raw()["set-cookie"] || []).map(c => c.split(";")[0]);
          let ssoPostBody = "";
          try { ssoPostBody = await ssoPostResp.text(); } catch(e) {}

          debug.ssoFormPost = {
            status: ssoPostResp.status,
            location: ssoPostResp.headers.get("location") || "none",
            cookies: ssoPostCookies.map(c => c.split("=")[0]),
            bodySnippet: ssoPostBody.substring(0, 500),
          };

          // If SSO redirects back to WCA, follow it
          let ssoRedirectLoc = ssoPostResp.headers.get("location") || "";
          if (ssoRedirectLoc && (ssoRedirectLoc.includes("wcaworld") || ssoRedirectLoc.includes("SsoLoginResult"))) {
            debug.steps.push(`3d. SSO redirect back to WCA: ${ssoRedirectLoc.substring(0, 100)}`);

            // Follow the callback
            const callbackResp = await fetch(ssoRedirectLoc.startsWith("http") ? ssoRedirectLoc : new URL(ssoRedirectLoc, ssoUrl).href, {
              headers: { "User-Agent": UA, "Cookie": cookieStr },
              redirect: "manual",
            });
            const callbackCookies = (callbackResp.headers.raw()["set-cookie"] || []).map(c => c.split(";")[0]);

            debug.ssoCallback = {
              status: callbackResp.status,
              location: callbackResp.headers.get("location") || "none",
              cookies: callbackCookies.map(c => c.split("=")[0]),
              hasAuth: callbackCookies.some(c => c.includes(".ASPXAUTH") || c.includes("AspNet")),
            };

            // If we got auth cookies, try fetching profile
            if (callbackCookies.some(c => c.includes(".ASPXAUTH") || c.includes("AspNet"))) {
              const allCookieMap = {};
              for (const c of [...baseCookies, ...callbackCookies]) {
                const eq = c.indexOf("="); if (eq > 0) allCookieMap[c.substring(0, eq)] = c;
              }
              const authCookies = Object.values(allCookieMap).join("; ");

              debug.steps.push("4. AUTH SUCCESS! Fetching profile...");
              const profileResp = await fetch(`${BASE}/directory/members/${wcaId}`, {
                headers: { "User-Agent": UA, "Cookie": authCookies, "Referer": `${BASE}/Directory` },
                redirect: "follow",
              });
              const profileHtml = await profileResp.text();
              debug.profileMembersOnly = (profileHtml.match(/Members\s*only/gi) || []).length;
              debug.profileNameCount = (profileHtml.match(/Name\s*:/gi) || []).length;
              debug.steps.push(`   MembersOnly=${debug.profileMembersOnly} NameFields=${debug.profileNameCount}`);
            }

            // Follow further redirects
            let nextLoc = callbackResp.headers.get("location") || "";
            let followCount = 0;
            let allFollowCookies = [...baseCookies, ...callbackCookies];
            while (nextLoc && followCount < 5) {
              const nextUrl = nextLoc.startsWith("http") ? nextLoc : new URL(nextLoc, ssoRedirectLoc).href;
              const fr = await fetch(nextUrl, {
                headers: { "User-Agent": UA, "Cookie": allFollowCookies.join("; ") },
                redirect: "manual",
              });
              const fc = (fr.headers.raw()["set-cookie"] || []).map(c => c.split(";")[0]);
              allFollowCookies = [...allFollowCookies, ...fc];
              debug.steps.push(`   Follow ${followCount+1}: ${nextUrl.substring(0,80)} status=${fr.status} +${fc.length}cookies auth=${fc.some(c => c.includes(".ASPXAUTH"))}`);
              nextLoc = fr.headers.get("location") || "";
              followCount++;
            }
          }
        }
      }
    } else {
      debug.steps.push("3. SSO URL not found in login page");
    }

    return res.json({ success: true, debug });
  } catch (err) {
    debug.error = err.message;
    debug.stack = err.stack?.split("\n").slice(0, 5);
    return res.status(500).json({ success: false, debug });
  }
};
