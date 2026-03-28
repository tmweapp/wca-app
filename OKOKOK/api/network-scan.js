const fetch = require("node-fetch");
const cheerio = require("cheerio");
const { ssoLogin, getCachedCookies, saveCookiesToCache, testCookies, UA, SUPABASE_URL, SUPABASE_KEY } = require("./utils/auth");

const SB = { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json" };

// Delay pattern identico al worker — si applica ad OGNI chiamata HTTP verso WCA
const DELAY_PATTERN = [3,3,2,3,8,3,5,3,12,3,4,3,6,3,9,3,3,3,10];
const MAX_EXEC_TIME = 25000;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function getDelay(idx) {
  const d = DELAY_PATTERN[idx % DELAY_PATTERN.length];
  if ((idx + 1) % DELAY_PATTERN.length === 0) return 15000;
  return d * 1000;
}

// Tutti i network con sito dedicato
const ALL_NETWORKS = [
  { domain: "wcaprojects.com",           siteId: 5,   name: "WCA Projects" },
  { domain: "wcadangerousgoods.com",     siteId: 22,  name: "WCA Dangerous Goods" },
  { domain: "wcaperishables.com",        siteId: 13,  name: "WCA Perishables" },
  { domain: "wcatimecritical.com",       siteId: 18,  name: "WCA Time Critical" },
  { domain: "wcapharma.com",             siteId: 16,  name: "WCA Pharma" },
  { domain: "wcarelocations.com",        siteId: 15,  name: "WCA Relocations" },
  { domain: "wcaecommercesolutions.com", siteId: 107, name: "WCA eCommerce" },
  { domain: "wcaexpo.com",              siteId: 124, name: "WCA Expo" },
  { domain: "lognetglobal.com",           siteId: 61,  name: "Lognet Global" },
  { domain: "globalaffinityalliance.com", siteId: 98,  name: "GAA" },
  { domain: "elitegln.com",              siteId: 108, name: "EGLN" },
  { domain: "ifc8.network",             siteId: 118, name: "IFC8" },
];

function extractMembersFromHtml(html) {
  const members = [];
  const seenIds = new Set();
  const $ = cheerio.load(html);
  $("a[href]").each((_, el) => {
    const href = $(el).attr("href") || "";
    const match = href.match(/\/directory\/members\/(\d+)/i);
    if (match) {
      const id = parseInt(match[1]);
      if (!seenIds.has(id) && id > 0) {
        seenIds.add(id);
        members.push({ id, name: $(el).text().trim(), href });
      }
    }
  });
  let totalResults = null;
  const totalMatch = html.match(/(\d[\d,]*)\s*(results?|members?|companies|records?|found|total)/i);
  if (totalMatch) totalResults = parseInt(totalMatch[1].replace(/,/g, ""));
  return { members, totalResults };
}

async function discoverOnNetwork(network, country, cookies) {
  const base = network.domain === "ifc8.network"
    ? `https://${network.domain}`
    : `https://www.${network.domain}`;

  const params = new URLSearchParams({
    siteID: network.siteId,
    pageIndex: 1, pageNumber: 1, pageSize: 300,
    searchby: "CountryCode", countrycode: country, country: country,
    orderby: "CountryCity", submitted: "search", layout: "v1", au: "",
  });

  const directoryUrl = `${base}/Directory?${params.toString()}`;
  const resp = await fetch(directoryUrl, {
    headers: { "User-Agent": UA, "Cookie": cookies, "Referer": `${base}/Directory`, "Accept": "text/html,application/xhtml+xml" },
    redirect: "follow", timeout: 15000,
  });

  if (resp.url.toLowerCase().includes("/login")) {
    return { network: network.name, domain: network.domain, error: "login_required", members: [] };
  }

  const html = await resp.text();
  if (html.includes('type="password"')) {
    return { network: network.name, domain: network.domain, error: "login_required", members: [] };
  }

  const { members, totalResults } = extractMembersFromHtml(html);

  // Fallback API se no HTML members
  if (members.length === 0) {
    const tokenMatch = html.match(/window\.wca\.token\s*=\s*["']([^"']+)["']/) ||
                       html.match(/wca\.token\s*=\s*["']([^"']+)["']/);
    if (tokenMatch) {
      try {
        const apiUrl = `${base}/Api/directories/view?${params.toString()}`;
        const apiResp = await fetch(apiUrl, {
          headers: {
            "User-Agent": UA, "Cookie": cookies,
            "Authorization": `Basic ${tokenMatch[1]}`,
            "Accept": "application/json, text/html, */*",
            "X-Requested-With": "XMLHttpRequest",
            "Referer": `${base}/Directory`,
          },
          timeout: 15000,
        });
        if (apiResp.status === 200) {
          const apiHtml = await apiResp.text();
          const apiParsed = extractMembersFromHtml(apiHtml);
          if (apiParsed.members.length > 0) {
            return { network: network.name, domain: network.domain, members: apiParsed.members, total: apiParsed.totalResults };
          }
        }
      } catch (e) { /* ignore */ }
    }
  }

  return { network: network.name, domain: network.domain, members, total: totalResults };
}

// === JOB STATE in Supabase ===
async function loadScanJob(jobId) {
  const resp = await fetch(`${SUPABASE_URL}/rest/v1/wca_jobs?id=eq.${jobId}&select=*`, { headers: SB });
  const rows = await resp.json();
  return rows?.[0] || null;
}

async function updateScanJob(jobId, updates) {
  updates.updated_at = new Date().toISOString();
  await fetch(`${SUPABASE_URL}/rest/v1/wca_jobs?id=eq.${jobId}`, {
    method: "PATCH", headers: { ...SB, "Prefer": "return=minimal" },
    body: JSON.stringify(updates),
  });
}

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

  const startTime = Date.now();
  const timeLeft = () => MAX_EXEC_TIME - (Date.now() - startTime);

  try {
    const { country, delayIndex = 0 } = req.body || {};
    if (!country) return res.status(400).json({ error: "country (ISO2) richiesto, es: ES, MT, IT" });

    // 1. Auth — getCachedCookies ritorna { cookies, ssoCookies } o null
    let cookies = null;
    const cached = await getCachedCookies();
    if (cached) {
      cookies = cached.cookies;
      const valid = await testCookies(cookies);
      if (!valid) cookies = null;
    }
    if (!cookies) {
      const loginResult = await ssoLogin();
      if (!loginResult.success) return res.status(500).json({ error: "SSO login fallito" });
      cookies = loginResult.cookies;
      await saveCookiesToCache(cookies, undefined, loginResult.ssoCookies || "");
    }

    // 2. Discover su tutti i network — sequenziale con DELAY_PATTERN
    //    Ogni chiamata HTTP = 1 step del delay pattern
    //    Se il tempo scade, ritorna i risultati parziali + nextIndex per continuare
    let dIdx = delayIndex;
    const networkResults = [];
    const allMemberIds = new Set();
    const memberNetworkMap = {};

    for (let i = 0; i < ALL_NETWORKS.length; i++) {
      const network = ALL_NETWORKS[i];

      // Delay PRIMA della chiamata (tranne la prima in assoluto se delayIndex=0 e i=0)
      if (dIdx > 0) {
        const delay = getDelay(dIdx - 1);
        if (timeLeft() < delay + 5000) {
          // Non c'è tempo — ritorna risultati parziali
          console.log(`[network-scan] Tempo esaurito dopo ${i} network, riprendi da index ${i}`);
          return res.json({
            success: true, partial: true, country,
            completedNetworks: i,
            totalNetworks: ALL_NETWORKS.length,
            nextNetworkIndex: i,
            nextDelayIndex: dIdx,
            networkResults,
            totalUniqueMembers: allMemberIds.size,
            memberNetworkMap,
          });
        }
        await sleep(delay);
      }

      // Fetch directory
      const result = await discoverOnNetwork(network, country, cookies);
      dIdx++;

      networkResults.push({
        network: result.network, domain: result.domain,
        memberCount: result.members.length, total: result.total || null,
        error: result.error || null,
      });

      for (const m of result.members) {
        allMemberIds.add(m.id);
        if (!memberNetworkMap[m.id]) memberNetworkMap[m.id] = { name: m.name, networks: [] };
        memberNetworkMap[m.id].networks.push(result.domain);
      }

      console.log(`[network-scan] [${i+1}/${ALL_NETWORKS.length}] ${result.domain}: ${result.members.length} members`);
    }

    // 3. Tutti i 12 network completati = "chiuso"
    console.log(`[network-scan] ${country} CHIUSO: ${allMemberIds.size} unique members across ${ALL_NETWORKS.length} networks`);

    return res.json({
      success: true,
      partial: false,
      country,
      completedNetworks: ALL_NETWORKS.length,
      totalNetworks: ALL_NETWORKS.length,
      finalDelayIndex: dIdx,
      totalUniqueMembers: allMemberIds.size,
      networkResults,
      memberNetworkMap,
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};
