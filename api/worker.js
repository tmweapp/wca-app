const fetch = require("node-fetch");
const cheerio = require("cheerio");
const { BASE, UA, SUPABASE_URL, SUPABASE_KEY, getCachedCookies, saveCookiesToCache, testCookies, ssoLogin } = require("./utils/auth");

const SB = { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}`, "Content-Type": "application/json" };

const DELAY_PATTERN = [3,3,2,3,8,3,5,3,12,3,4,3,6,3,9,3,3,3,10];
const MAX_EXEC_TIME = 25000; // 25s max per invocation (Vercel limit 30s)
const MAX_CONSECUTIVE_FAILURES = 5;

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function getDelay(idx) {
  const d = DELAY_PATTERN[idx % DELAY_PATTERN.length];
  if ((idx + 1) % DELAY_PATTERN.length === 0) return 15000;
  return d * 1000;
}

async function getValidCookies() {
  // getCachedCookies ritorna { cookies, ssoCookies } o null
  const cached = await getCachedCookies();
  if (cached && await testCookies(cached.cookies)) return cached.cookies;
  const result = await ssoLogin();
  if (result && result.success && result.cookies) {
    await saveCookiesToCache(result.cookies, undefined, result.ssoCookies || "");
    return result.cookies;
  }
  return null;
}

// === DISCOVER ===
async function discoverPage(cookies, wcaToken, country, page, networks, searchTerm, searchBy) {
  // Usa lo stesso endpoint discover che usa il frontend
  const body = { cookies, wcaToken, page, filters: { country, searchTerm, searchBy, networks } };
  // Chiamata diretta alla directory WCA
  let url = `${BASE}/Directory?page=${page}`;
  if (country) url += `&country=${country}`;

  const resp = await fetch(url, {
    headers: { "User-Agent": UA, "Cookie": cookies },
    redirect: "manual",
  });
  if (resp.status !== 200) return { members: [], hasNext: false };
  const html = await resp.text();
  const $ = cheerio.load(html);

  const members = [];
  $(".member-list-item, .directory-item, tr[data-id], .memberItem, .search-result-item").each((_, el) => {
    const $el = $(el);
    const link = $el.find("a[href*='/Profile/']").first();
    const href = link.attr("href") || "";
    const idMatch = href.match(/\/Profile\/(\d+)/);
    if (idMatch) {
      members.push({
        id: idMatch[1],
        name: link.text().trim() || $el.find(".company-name, .member-name, td:first-child").text().trim(),
        href,
      });
    }
  });

  // Fallback: prova anche pattern per links generici al profilo
  if (members.length === 0) {
    $("a[href*='/Profile/']").each((_, el) => {
      const href = $(el).attr("href") || "";
      const idMatch = href.match(/\/Profile\/(\d+)/);
      if (idMatch && !members.some(m => m.id === idMatch[1])) {
        members.push({ id: idMatch[1], name: $(el).text().trim(), href });
      }
    });
  }

  const hasNext = $("a.next, a[rel='next'], .pagination a").filter((_, el) => /next|succ|›|»/i.test($(el).text())).length > 0;
  return { members, hasNext };
}

// === SCRAPE PROFILO SINGOLO (semplificato) ===
async function scrapeProfile(cookies, wcaId, href) {
  const profileUrl = href ? `${BASE}${href}` : `${BASE}/Profile/${wcaId}`;
  const resp = await fetch(profileUrl, {
    headers: { "User-Agent": UA, "Cookie": cookies }, redirect: "manual",
  });
  if (resp.status >= 300) {
    const loc = (resp.headers.get("location") || "").toLowerCase();
    if (loc.includes("login") || loc.includes("signin")) return { state: "login_redirect" };
    return { state: "redirect" };
  }
  if (resp.status !== 200) return { state: "error", error: `HTTP ${resp.status}` };
  const html = await resp.text();
  if (html.includes('type="password"') || /login.?form/i.test(html)) return { state: "login_redirect" };
  const $ = cheerio.load(html);

  // Usa extractProfile importando la logica inline (versione semplificata)
  const result = { wca_id: parseInt(wcaId), state: "ok", company_name: "", contacts: [], networks: [], access_limited: false };
  const h1 = $("h1.company, h1").first().text().trim();
  result.company_name = h1;
  if (!h1 || /not\s*found|error|404/i.test(h1)) return { wca_id: wcaId, state: "not_found" };

  // Company info
  result.address = $(".address, .company-address, [itemprop='address']").text().trim().replace(/\s+/g, " ");
  result.phone = $("a[href^='tel:']").first().text().trim() || $(".phone, [itemprop='telephone']").text().trim();
  result.email = $("a[href^='mailto:']").first().text().trim();
  result.website = $("a[href^='http']:not([href*='wcaworld'])").filter((_, el) => /website|web site|visit/i.test($(el).text())).first().attr("href") || "";

  // Networks
  $(".network-badge, .network-item, .networks span, .networks a").each((_, el) => {
    const t = $(el).text().trim();
    if (t && t.length > 2 && t.length < 60) result.networks.push(t);
  });

  // Contacts
  $(".contact-item, .contact-card, .team-member, .people-item").each((_, el) => {
    const $c = $(el);
    const contact = {};
    contact.name = $c.find(".contact-name, .name, h4, h5, strong").first().text().trim();
    contact.title = $c.find(".contact-title, .title, .position, .role").first().text().trim();
    contact.email = $c.find("a[href^='mailto:']").first().text().trim();
    contact.direct_line = $c.find(".phone, .direct-line, a[href^='tel:']").first().text().trim();
    if (contact.name || contact.email) result.contacts.push(contact);
  });

  // Members-only detection
  const membersOnlyText = $("body").text();
  if (/members\s*only|access\s*restricted|login\s*to\s*view|limited\s*access/i.test(membersOnlyText) && result.contacts.length === 0) {
    result.access_limited = true;
  }

  // Profile text
  result.profile_text = $(".profile-text, .about, .company-description, .description").text().trim().substring(0, 2000);

  // GM coverage
  if (/GM\s*Covered|gold\s*member/i.test(membersOnlyText)) result.gm_coverage = true;
  if (/not\s*covered|no\s*gm/i.test(membersOnlyText)) result.gm_coverage = false;

  // Services, certifications
  result.services = [];
  result.certifications = [];
  $(".service-item, .services li").each((_, el) => result.services.push($(el).text().trim()));
  $(".certification-item, .certifications li").each((_, el) => result.certifications.push($(el).text().trim()));

  return result;
}

// === SAVE TO SUPABASE ===
async function savePartner(profile, countryCode) {
  if (!profile.country_code && countryCode) profile.country_code = countryCode;
  const row = {
    wca_id: profile.wca_id, company_name: profile.company_name || "",
    logo_url: profile.logo_url || null, branch: profile.branch || "",
    gm_coverage: profile.gm_coverage ?? null, gm_status_text: profile.gm_status_text || "",
    enrolled_offices: profile.enrolled_offices || [], enrolled_since: profile.enrolled_since || "",
    expires: profile.expires || "", networks: profile.networks || [],
    profile_text: profile.profile_text || "", address: profile.address || "",
    mailing: profile.mailing || "", phone: profile.phone || "",
    fax: profile.fax || "", emergency_call: profile.emergency_call || "",
    website: profile.website || "", email: profile.email || "",
    contacts: profile.contacts || [], services: profile.services || [],
    certifications: profile.certifications || [], branch_cities: profile.branch_cities || [],
    country_code: (profile.country_code || countryCode || "").toUpperCase(),
    raw_data: profile, updated_at: new Date().toISOString(),
    access_limited: profile.access_limited || false,
  };
  await fetch(`${SUPABASE_URL}/rest/v1/wca_partners`, {
    method: "POST", headers: { ...SB, "Prefer": "resolution=merge-duplicates" },
    body: JSON.stringify(row),
  });
}

// === LOAD EXISTING IDS ===
async function loadExistingIds() {
  const ids = new Set();
  let page = 0;
  while (true) {
    const resp = await fetch(`${SUPABASE_URL}/rest/v1/wca_partners?select=wca_id&limit=1000&offset=${page * 1000}`, {
      headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}` },
    });
    if (!resp.ok) break;
    const rows = await resp.json();
    if (!rows?.length) break;
    for (const r of rows) ids.add(String(r.wca_id));
    if (rows.length < 1000) break;
    page++;
  }
  return ids;
}

// === UPDATE JOB ===
async function updateJob(jobId, updates) {
  updates.updated_at = new Date().toISOString();
  await fetch(`${SUPABASE_URL}/rest/v1/wca_jobs?id=eq.${jobId}`, {
    method: "PATCH", headers: { ...SB, "Prefer": "return=minimal" },
    body: JSON.stringify(updates),
  });
}

async function addJobLog(job, msg) {
  const log = job.error_log || [];
  log.push({ t: new Date().toISOString(), m: msg });
  if (log.length > 200) log.splice(0, log.length - 200);
  return log;
}

// === MAIN WORKER ===
module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  const startTime = Date.now();
  const timeLeft = () => MAX_EXEC_TIME - (Date.now() - startTime);

  try {
    // Carica job attivo
    const jobId = req.query?.jobId;
    let jobResp;
    if (jobId) {
      jobResp = await fetch(`${SUPABASE_URL}/rest/v1/wca_jobs?id=eq.${jobId}&select=*`, {
        headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}` },
      });
    } else {
      // Cerca job attivo (cron mode)
      jobResp = await fetch(`${SUPABASE_URL}/rest/v1/wca_jobs?status=in.(pending,discovering,downloading)&order=created_at.desc&limit=1`, {
        headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}` },
      });
    }
    if (!jobResp.ok) return res.json({ success: false, error: "DB error" });
    const jobs = await jobResp.json();
    if (!jobs?.length) return res.json({ success: true, message: "Nessun job attivo" });
    const job = jobs[0];

    // Job pausato o annullato? Non fare nulla
    if (job.status === "paused" || job.status === "cancelled" || job.status === "completed") {
      return res.json({ success: true, message: `Job ${job.id} è ${job.status}` });
    }

    const config = job.config || {};
    const countries = config.countries || [];
    if (!countries.length) {
      await updateJob(job.id, { status: "completed", last_activity: "Nessun paese configurato" });
      return res.json({ success: true, message: "No countries" });
    }

    // === FASE PENDING → DISCOVERING ===
    if (job.status === "pending") {
      console.log(`[worker] Job ${job.id} — inizio discover`);
      const cookies = await getValidCookies();
      if (!cookies) {
        await updateJob(job.id, { status: "error", last_activity: "SSO login fallito" });
        return res.json({ success: false, error: "SSO login failed" });
      }

      // Carica ID esistenti
      const existingIds = await loadExistingIds();
      const country = countries[job.current_country_idx || 0];
      let allMembers = [];
      let page = 1;

      // Discover tutte le pagine (entro il time budget)
      while (timeLeft() > 8000) {
        const result = await discoverPage(cookies, null, country.code, page, config.networks, config.searchTerm, config.searchBy);
        allMembers.push(...result.members);
        console.log(`[worker] Discover ${country.name} p${page}: +${result.members.length} (tot: ${allMembers.length})`);
        await updateJob(job.id, {
          status: "discovering",
          last_activity: `Discover ${country.name}: pagina ${page}, ${allMembers.length} trovati`,
        });
        if (!result.hasNext || result.members.length === 0) break;
        page++;
        const delay = getDelay(job.delay_index + page);
        if (timeLeft() < delay + 5000) break; // Non c'è tempo per un'altra pagina
        await sleep(delay);
      }

      // Filtra già scaricati
      const toDownload = allMembers.filter(m => !existingIds.has(String(m.id)));
      const skipped = allMembers.length - toDownload.length;

      await updateJob(job.id, {
        status: "downloading",
        discovered_members: toDownload,
        total_skipped: skipped,
        current_member_idx: 0,
        delay_index: 0,
        last_activity: `Discover completato: ${allMembers.length} trovati, ${skipped} già in DB, ${toDownload.length} da scaricare`,
        error_log: await addJobLog(job, `Discover ${country.name}: ${allMembers.length} trovati, ${skipped} skip, ${toDownload.length} nuovi`),
      });

      // Se c'è ancora tempo, inizia subito il download
      if (timeLeft() < 8000) {
        // Re-trigger per continuare
        const workerUrl = `https://${req.headers.host}/api/worker?jobId=${job.id}`;
        fetch(workerUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }).catch(e => console.log(`[worker] Retrigger error: ${e.message}`));
        return res.json({ success: true, phase: "discover_done", members: toDownload.length });
      }
    }

    // === FASE DOWNLOADING ===
    if (job.status === "downloading" || (job.status === "discovering" && timeLeft() > 8000)) {
      // Reload fresh job data
      const freshResp = await fetch(`${SUPABASE_URL}/rest/v1/wca_jobs?id=eq.${job.id}&select=*`, {
        headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}` },
      });
      const freshJobs = await freshResp.json();
      const freshJob = freshJobs?.[0] || job;

      if (freshJob.status === "paused" || freshJob.status === "cancelled") {
        return res.json({ success: true, message: `Job ${job.id} è stato ${freshJob.status}` });
      }

      const members = freshJob.discovered_members || [];
      let idx = freshJob.current_member_idx || 0;
      let delayIdx = freshJob.delay_index || 0;
      let scraped = freshJob.total_scraped || 0;
      let failures = freshJob.consecutive_failures || 0;
      const country = countries[freshJob.current_country_idx || 0];
      const countryCode = country?.code || "";
      let errorLog = freshJob.error_log || [];

      if (idx >= members.length) {
        // Country completa — prossima?
        const nextCountryIdx = (freshJob.current_country_idx || 0) + 1;
        if (nextCountryIdx < countries.length) {
          await updateJob(job.id, {
            status: "pending", // Ripartirà con discover del prossimo paese
            current_country_idx: nextCountryIdx,
            current_member_idx: 0,
            discovered_members: [],
            delay_index: 0,
            consecutive_failures: 0,
            last_activity: `${country.name} completato (${scraped} salvati). Prossimo: ${countries[nextCountryIdx].name} tra 15s...`,
          });
          await sleep(Math.min(15000, timeLeft() - 2000));
          const workerUrl = `https://${req.headers.host}/api/worker?jobId=${job.id}`;
          fetch(workerUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }).catch(e => console.log(`[worker] Retrigger error: ${e.message}`));
          return res.json({ success: true, phase: "next_country" });
        } else {
          await updateJob(job.id, {
            status: "completed",
            last_activity: `Completato! ${scraped} profili salvati da ${countries.map(c => c.name).join(", ")}`,
          });
          return res.json({ success: true, phase: "completed", total: scraped });
        }
      }

      // Login
      const cookies = await getValidCookies();
      if (!cookies) {
        errorLog = await addJobLog(freshJob, "SSO login fallito");
        await updateJob(job.id, { last_activity: "SSO login fallito — riproverò al prossimo ciclo", error_log: errorLog, consecutive_failures: failures + 1 });
        // Re-trigger tra un po'
        const workerUrl = `https://${req.headers.host}/api/worker?jobId=${job.id}`;
        setTimeout(() => fetch(workerUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }).catch(e => console.log(`[worker] Retrigger error: ${e.message}`)), 15000);
        return res.json({ success: false, error: "SSO failed, will retry" });
      }

      // Download loop
      let processed = 0;
      while (idx < members.length && timeLeft() > 5000 && failures < MAX_CONSECUTIVE_FAILURES) {
        const member = members[idx];
        await updateJob(job.id, {
          status: "downloading",
          current_member_idx: idx,
          last_activity: `📥 Download ${idx + 1}/${members.length} — ${member.name || "ID " + member.id}`,
        });

        const profile = await scrapeProfile(cookies, member.id, member.href);

        if (profile.state === "ok") {
          await savePartner(profile, countryCode);
          scraped++;
          failures = 0;
          console.log(`[worker] ✓ ${profile.company_name} (${member.id})`);
        } else if (profile.state === "login_redirect") {
          failures++;
          errorLog.push({ t: new Date().toISOString(), m: `login_redirect: ${member.id}` });
          // Invalida cookies
          await saveCookiesToCache("").catch(e => console.log(`[worker] Error clearing cache: ${e.message}`));
          console.log(`[worker] ✗ login_redirect ${member.id}`);
        } else if (profile.state === "not_found") {
          console.log(`[worker] ✗ not_found ${member.id}`);
        } else {
          failures++;
          errorLog.push({ t: new Date().toISOString(), m: `${profile.state}: ${member.id}` });
        }

        idx++;
        processed++;

        // Salva stato ogni profilo
        await updateJob(job.id, {
          current_member_idx: idx,
          total_scraped: scraped,
          consecutive_failures: failures,
          delay_index: delayIdx,
          error_log: errorLog.length > 200 ? errorLog.slice(-200) : errorLog,
        });

        // Delay pattern
        if (idx < members.length && timeLeft() > 5000) {
          const delay = getDelay(delayIdx);
          delayIdx++;
          const actualDelay = Math.min(delay, timeLeft() - 3000);
          if (actualDelay > 0) {
            const nextMember = members[idx];
            await updateJob(job.id, {
              last_activity: `⏳ Pausa ${Math.round(delay/1000)}s — prossimo: ${nextMember?.name || "ID " + nextMember?.id}`,
              delay_index: delayIdx,
            });
            await sleep(actualDelay);
          }
        }
      }

      // Too many failures?
      if (failures >= MAX_CONSECUTIVE_FAILURES) {
        await updateJob(job.id, {
          status: "paused",
          last_activity: `⛔ ${failures} fallimenti consecutivi — job in pausa. Riprendi manualmente.`,
        });
        return res.json({ success: true, phase: "paused_failures", processed });
      }

      // Se ci sono ancora profili, ri-triggera
      if (idx < members.length) {
        const workerUrl = `https://${req.headers.host}/api/worker?jobId=${job.id}`;
        fetch(workerUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }).catch(e => console.log(`[worker] Retrigger error: ${e.message}`));
        return res.json({ success: true, phase: "downloading", processed, remaining: members.length - idx });
      }

      // Country completa
      const nextCountryIdx = (freshJob.current_country_idx || 0) + 1;
      if (nextCountryIdx < countries.length) {
        await updateJob(job.id, {
          status: "pending",
          current_country_idx: nextCountryIdx,
          current_member_idx: 0,
          discovered_members: [],
          delay_index: 0,
          consecutive_failures: 0,
          last_activity: `✅ ${country.name} completato (${scraped} salvati). Pausa 15s, poi: ${countries[nextCountryIdx].name}`,
        });
        const workerUrl = `https://${req.headers.host}/api/worker?jobId=${job.id}`;
        setTimeout(() => fetch(workerUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }).catch(e => console.log(`[worker] Retrigger error: ${e.message}`)), 15000);
      } else {
        await updateJob(job.id, {
          status: "completed",
          last_activity: `🎉 Completato! ${scraped} profili salvati.`,
        });
      }

      return res.json({ success: true, phase: "batch_done", processed, total_scraped: scraped });
    }

    return res.json({ success: true, message: "Nothing to do", status: job.status });
  } catch (err) {
    console.error(`[worker] Error: ${err.message}`);
    return res.status(500).json({ success: false, error: err.message });
  }
};
