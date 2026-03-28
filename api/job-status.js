const fetch = require("node-fetch");
const { SUPABASE_URL, SUPABASE_KEY } = require("./utils/auth");

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();

  try {
    const { jobId } = req.query || {};
    let url;
    if (jobId) {
      url = `${SUPABASE_URL}/rest/v1/wca_jobs?id=eq.${jobId}&select=id,status,config,current_country_idx,current_member_idx,delay_index,total_scraped,total_skipped,consecutive_failures,last_activity,error_log,created_at,updated_at&limit=1`;
    } else {
      // Ultimo job attivo o recente
      url = `${SUPABASE_URL}/rest/v1/wca_jobs?select=id,status,config,current_country_idx,current_member_idx,delay_index,total_scraped,total_skipped,consecutive_failures,last_activity,error_log,created_at,updated_at&order=created_at.desc&limit=1`;
    }

    const resp = await fetch(url, {
      headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}` },
    });

    if (!resp.ok) {
      const err = await resp.text();
      return res.json({ success: false, error: `Supabase ${resp.status}: ${err}` });
    }

    const jobs = await resp.json();
    if (!jobs?.length) return res.json({ success: true, job: null });

    const job = jobs[0];
    // Calcola totale members da scaricare (senza mandare l'intero array al frontend)
    // Lo prendiamo dal DB separatamente per non appesantire
    let totalMembers = 0;
    if (jobId || job.id) {
      const countResp = await fetch(`${SUPABASE_URL}/rest/v1/wca_jobs?id=eq.${job.id}&select=discovered_members`, {
        headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}` },
      });
      if (countResp.ok) {
        const countData = await countResp.json();
        totalMembers = countData?.[0]?.discovered_members?.length || 0;
      }
    }

    return res.json({
      success: true,
      job: {
        id: job.id,
        status: job.status,
        countries: job.config?.countries?.map(c => c.name) || [],
        currentCountry: job.config?.countries?.[job.current_country_idx]?.name || "",
        currentCountryIdx: job.current_country_idx,
        totalCountries: job.config?.countries?.length || 0,
        currentMemberIdx: job.current_member_idx,
        totalMembers,
        totalScraped: job.total_scraped,
        totalSkipped: job.total_skipped,
        consecutiveFailures: job.consecutive_failures,
        lastActivity: job.last_activity,
        recentLogs: (job.error_log || []).slice(-20),
        createdAt: job.created_at,
        updatedAt: job.updated_at,
      },
    });
  } catch (err) {
    return res.status(500).json({ success: false, error: err.message });
  }
};
