// WCA — Initialization & Startup

// bellAudio is declared in notifications.js

// scrapeStats is declared in scraping-stats.js
// activityTimerInterval is declared in ui-status.js
// completedNetworkLogos is declared in ui-country.js

const discoverCache = {};

let completedCountries = {};
try { completedCountries = JSON.parse(localStorage.getItem("wca_completed_countries") || "{}"); } catch(e){}

// bgJobId and bgPollInterval are declared in jobs.js

let failedProfilesList = [];
try { const saved = JSON.parse(localStorage.getItem("wca_failed_profiles")); if(Array.isArray(saved)) failedProfilesList = saved; } catch(e){}

function addFailedProfile(wcaId) {
  if (failedProfilesList.find(f => f.id === wcaId)) return;
  // Cerca il nome dal discover
  const memberName = discoveredMembers.find(m => m.id === wcaId)?.name || "";
  failedProfilesList.push({ id: wcaId, name: memberName });
  document.getElementById("failedCountHeader").textContent = failedProfilesList.length;
  try { localStorage.setItem("wca_failed_profiles", JSON.stringify(failedProfilesList)); } catch(e) {}
}

function openVerifica() {
  // Salva cookies e token per la pagina verifica
  try {
    localStorage.setItem("wca_failed_profiles", JSON.stringify(failedProfilesList));
    if (sessionCookies) localStorage.setItem("wca_cookies", sessionCookies);
    if (wcaToken) localStorage.setItem("wca_token", wcaToken);
  } catch(e) {}
  window.open('verifica.html', '_blank');
}

function openAgenda(){
  if(scrapedProfiles.length){
    try{ localStorage.setItem("wca_partners_scraped", JSON.stringify(scrapedProfiles)); }catch(e){}
  }
  window.open('agenda.html','_blank');
}

async function loadHeaderCounts(){
  try {
    const [respAll, respCounts] = await Promise.all([
      fetch(API+"/api/partners?select=wca_id,access_limited&limit=100000"),
      fetch(API+"/api/partners?action=country_counts")
    ]);
    const data = await respAll.json();
    if(data.success && data.partners){
      document.getElementById("headerTotalPartners").textContent = data.partners.length.toLocaleString();
      const limited = data.partners.filter(p => p.access_limited).length;
      document.getElementById("headerLimitedPartners").textContent = limited.toLocaleString();
    }
    const cData = await respCounts.json();
    if(cData.success && cData.counts){
      countryPartnerCounts = cData.counts;
      // Popola flags bar con nuovi chip
      renderFlagChips();
      // Mostra badge orfani se presenti
      if(cData.orphans > 0){
        const ob = document.getElementById("orphanBadge");
        const oh = document.getElementById("headerOrphans");
        if(ob){ ob.style.display = "inline-flex"; }
        if(oh){ oh.textContent = cData.orphans; }
      } else {
        const ob = document.getElementById("orphanBadge");
        if(ob) ob.style.display = "none";
      }
    }
  } catch(e){ console.warn("loadHeaderCounts error:", e.message); }
}

// Se c'era un sync interrotto, mostra badge sul tasto
function checkPendingDirSync(){
  const saved = getDirSyncState();
  if(saved && saved.lastIndex > 0 && saved.lastIndex < saved.total - 1){
    const btn = document.getElementById("btnSyncDir");
    if(btn){
      btn.style.borderColor = "rgba(245,158,11,0.3)";
      btn.style.background = "rgba(245,158,11,0.06)";
      btn.title = `Directory interrotta: ${saved.lastIndex+1}/${saved.total} (${saved.lastCountry}) — clicca per riprendere`;
    }
  }
}

// Request notification permission on first toggle
if("Notification" in window && Notification.permission === "default"){
  // will ask when user clicks bell
}

// Controlla se c'è un download interrotto all'avvio
(function checkSavedState(){
  // Mostra jobs sospesi nel log
  const jobs = getSuspendedJobs();
  if(jobs.length > 0){
    document.getElementById("btnResume").style.display = "inline-flex";
    for(const job of jobs){
      const ageMin = Math.round((Date.now() - job.ts) / 60000);
      const ageStr = ageMin < 60 ? ageMin+"min" : Math.round(ageMin/60)+"h";
      log(`⏸ Job sospeso: ${countryFlag(job.code)} ${job.name} — ${job.done}/${job.total} fatti, ${job.pending} rimanenti (${ageStr} fa)`,"warn");
    }
  }
  // Render Download Manager
  renderDownloadManager();
})();

// All'avvio, controlla se c'è un job attivo
(async function checkActiveJob(){
  try {
    const resp = await fetch(API+"/api/job-status");
    const data = await resp.json();
    if(data.success && data.job && ["pending","discovering","downloading","enriching","paused"].includes(data.job.status)){
      bgJobId = data.job.id;
      showBgPanel();
      startBgPolling();
      log(`Job #${bgJobId} in corso in background (${data.job.status})`, "ok");
    }
  } catch(e){ console.warn("bgJob restore error:", e.message); }
})();

loadHeaderCounts();
// Aggiorna ogni 30s durante lo scraping
setInterval(()=>{ if(scraping || bgJobId) loadHeaderCounts(); }, 30000);

// Fix profili orfani (senza country_code valido)
async function fixOrphanProfiles(){
  const ob = document.getElementById("orphanBadge");
  if(ob) ob.style.opacity = "0.5";
  log("🔧 Correzione profili orfani in corso...", "warn");
  try {
    const resp = await fetch(API+"/api/partners?action=fix_orphans");
    const data = await resp.json();
    if(data.success){
      log(`✅ Orfani corretti: ${data.fixed} aggiornati, ${data.deleted} rimossi, ${data.failed} errori (su ${data.total} totali)`, "ok");
      if(ob){ ob.style.display = "none"; ob.style.opacity = "1"; }
      loadHeaderCounts();
    } else {
      log("❌ Errore fix orfani: " + (data.error || "unknown"), "err");
      if(ob) ob.style.opacity = "1";
    }
  } catch(e){
    log("❌ Fix orfani exception: " + e.message, "err");
    if(ob) ob.style.opacity = "1";
  }
}
