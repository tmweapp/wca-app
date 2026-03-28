// WCA — Initialization & Startup

const bellAudio = new Audio("data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1lZWltbW1zc3V1dXZ2dnV1c3FtaWViXltYVlRSUlRWWFxgZGhtcnZ6fX+BgoKBgH58eXVxbGdiXlpXVFJRUlRXW19kZ2xxdXh7foCBgoGAf316d3NuamViXltYVlVVVlhbXmJma3B0eHt+gIGCgYCAf3x5dnJuamZjYF5cW1tcXWBjZ2xwdHh7foCBgoGAf316d3RwbGlmYmBfXl5fYGNmaWxwc3d6fH6AgYKBgH9+e3h1cnBtamhmZWRkZGVmaWttcHN2eXt9f4CBgYGAf358e3l3dXNxcG9ub25vcHFzdXd5e31/gIGBgYB/fn17enl4d3Z2dXV1dXZ3eHl7fH5/gIGBgYCAf359fHt6enl5eXl5eXp7fH1+f4CBgYGAgH9+fXx8e3t7e3t7e3t8fH1+f3+AgYGBgIB/fn19fHx8fHx8fHx8fX1+fn9/gICBgYCAf39+fn19fX19fX1+fn5/f3+AgICBgICAf39/fn5+fn5+fn5+fn9/f39/gICAgICAf39/f39/fn5+fn5/f39/f39/gICAgICAf39/f39/f39/f39/f39/f4CAgICAgH9/f39/f39/f39/f39/f3+AgICAgIB/f39/f39/f39/f39/f39/f4CAgICAgH9/f39/f3+AgICAgH9/f39/f39/gICAgICAgH9/f39/gA==");

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
      fetch(API+"/api/partners?select=wca_id,access_limited&limit=10000"),
      fetch(API+"/api/partners?action=country_counts")
    ]);
    const data = await respAll.json();
    if(data.success && data.partners){
      document.getElementById("headerTotalPartners").textContent = data.partners.length;
      const limited = data.partners.filter(p => p.access_limited).length;
      document.getElementById("headerLimitedPartners").textContent = limited;
    }
    const cData = await respCounts.json();
    if(cData.success && cData.counts){
      countryPartnerCounts = cData.counts;
      // Popola flags bar con nuovi chip
      renderFlagChips();
    }
  } catch(e){ console.warn("loadHeaderCounts error:", e.message); }
}

function setTheme(t) { /* no-op */ }

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
