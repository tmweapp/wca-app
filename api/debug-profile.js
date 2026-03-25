const fetch = require("node-fetch");
const cheerio = require("cheerio");
const { ssoLogin, getCachedCookies, saveCookiesToCache, testCookies, BASE, UA } = require("./utils/auth");

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const wcaId = req.body?.wcaId || req.query?.id || 37861;

  try {
    // 1. Get cookies (cached or fresh SSO)
    let cookies = await getCachedCookies();
    if (cookies) {
      const valid = await testCookies(cookies);
      if (!valid) cookies = null;
    }
    if (!cookies) {
      const loginResult = await ssoLogin();
      if (!loginResult.success) return res.json({ success: false, error: "Login failed: " + loginResult.error });
      cookies = loginResult.cookies;
      await saveCookiesToCache(cookies);
    }

    // 2. Fetch profile page
    const url = `${BASE}/directory/members/${wcaId}`;
    const resp = await fetch(url, {
      headers: { "User-Agent": UA, "Cookie": cookies, "Referer": `${BASE}/Directory` },
      redirect: "follow",
    });
    const html = await resp.text();
    const $ = cheerio.load(html);

    // 3. Diagnostics
    const diag = {
      wcaId,
      httpStatus: resp.status,
      htmlLen: html.length,
      cookieLen: cookies.length,
      cookieKeys: cookies.split("; ").map(c => c.split("=")[0]),
      hasAuth: cookies.includes(".ASPXAUTH"),
      hasPasswordField: html.includes('type="password"'),
      membersOnlyCount: (html.match(/Members\s*Only/gi) || []).length,
      loginLinkCount: (html.match(/>Login<\/a>/gi) || []).length,
      h1: $("h1").first().text().trim(),
    };

    // 4. Extract contact section HTML raw
    const contactSelectors = [
      ".contactperson_row",
      "[class*='contactperson']",
      "[class*='office_contact']",
      "[class*='officecontact']",
    ];

    diag.contactSections = {};
    for (const sel of contactSelectors) {
      const els = $(sel);
      if (els.length > 0) {
        diag.contactSections[sel] = {
          count: els.length,
          htmlSamples: [],
        };
        els.each((i, el) => {
          if (i < 5) { // max 5 samples
            diag.contactSections[sel].htmlSamples.push($(el).html().substring(0, 1000));
          }
        });
      }
    }

    // 5. Find "Office Contacts" section via headline
    diag.officeContactsSection = null;
    $(".profile_headline").each((_, el) => {
      if (/office\s*contacts/i.test($(el).text())) {
        // Get everything after this headline until next headline
        let html = "";
        let next = $(el).next();
        let count = 0;
        while (next.length && count < 20 && !next.hasClass("profile_headline")) {
          html += $.html(next);
          next = next.next();
          count++;
        }
        diag.officeContactsSection = html.substring(0, 3000);
      }
    });

    // 6. Look for email addresses anywhere in page
    const emailMatches = html.match(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g) || [];
    diag.emailsFoundInPage = [...new Set(emailMatches)];

    // 7. Look for mailto links
    const mailtoLinks = [];
    $("a[href^='mailto:']").each((_, el) => {
      mailtoLinks.push({
        href: $(el).attr("href"),
        text: $(el).text().trim(),
        parent: $(el).parent().attr("class") || "no-class",
      });
    });
    diag.mailtoLinks = mailtoLinks;

    // 8. Profile labels and values in contact area
    diag.profileRows = [];
    $(".profile_row").each((_, row) => {
      const label = $(row).find(".profile_label").text().trim();
      const val = $(row).find(".profile_val").text().trim();
      const inContact = $(row).closest(".contactperson_row, .contactperson_info, [class*='contactperson']").length > 0;
      if (label) {
        diag.profileRows.push({ label, val: val.substring(0, 100), inContact });
      }
    });

    return res.json({ success: true, diag });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};
