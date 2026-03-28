// WCA — Jobs (Suspended, Download History, Download Manager, Background Jobs)

// === JOBS SOSPESI ===
function getSuspendedJobs(){
  try { return JSON.parse(localStorage.getItem("wca_suspended_jobs")||"[]"); } catch(e){ return []; }
}
function saveSuspendedJob(countryCode, countryName, pendingIds, allMembers, networkMap){
  const jobs = getSuspendedJobs().filter(j => j.code !== countryCode); // rimuovi vecchio job stesso paese
  jobs.unshift({
    code: countryCode,
    name: countryName,
    pending: pendingIds.length,
    total: allMembers.length,
    done: allMembers.length - pendingIds.length,
    ts: Date.now(),
    members: allMembers, // salva i membri per ripresa
    networkMap: networkMap || {}, // mappa wcaId → {networks:[...]}
  });
  try { localStorage.setItem("wca_suspended_jobs", JSON.stringify(jobs)); } catch(e){ console.warn("saveSuspendedJob:", e.message); }
  renderDownloadManager();
}
function removeSuspendedJob(countryCode){
  const jobs = getSuspendedJobs().filter(j => j.code !== countryCode);
  try { localStorage.setItem("wca_suspended_jobs", JSON.stringify(jobs)); } catch(e){ console.warn("removeSuspendedJob:", e.message); }
  renderDownloadManager();
}

// === DOWNLOAD HISTORY (completati) ===
function getCompletedJobs(){
  try { return JSON.parse(localStorage.getItem("wca_completed_jobs")||"[]"); } catch(e){ return []; }
}
function addCompletedJob(countryCode, countryName, totalSaved, mode, networks){
  const jobs = getCompletedJobs();
  // Aggiorna se esiste già per lo stesso paese
  const idx = jobs.findIndex(j => j.code === countryCode);
  const entry = {
    code: countryCode,
    name: countryName,
    total: totalSaved,
    mode: mode || currentMode || "discover",
    networks: networks || [],
    ts: Date.now()
  };
  if(idx >= 0) jobs[idx] = entry;
  else jobs.unshift(entry);
  // Tieni max 100
  if(jobs.length > 100) jobs.length = 100;
  try { localStorage.setItem("wca_completed_jobs", JSON.stringify(jobs)); } catch(e){ console.warn("addCompletedJob:", e.message); }
  renderDownloadManager();
}
function clearCompletedJobs(){
  try { localStorage.setItem("wca_completed_jobs", "[]"); } catch(e){ console.warn("clearCompletedJobs:", e.message); }
  renderDownloadManager();
}
function clearAllJobs(){
  try {
    localStorage.setItem("wca_completed_jobs", "[]");
    localStorage.setItem("wca_suspended_jobs", "[]");
    localStorage.removeItem("wca_scraping_state");
  } catch(e){ console.warn("clearAllJobs:", e.message); }
  const btnR = document.getElementById("btnResume");
  if(btnR) btnR.style.display = "none";
  renderDownloadManager();
}

// === DOWNLOAD MANAGER — render ===
function renderDownloadManager(){
  const panel = document.getElementById("downloadManagerPanel");
  const listEl = document.getElementById("dmJobList");
  const emptyEl = document.getElementById("dmEmpty");
  const countEl = document.getElementById("dmJobCount");
  if(!panel || !listEl) return;

  const suspended = getSuspendedJobs();
  const completed = getCompletedJobs();
  const total = suspended.length + completed.length;

  if(total === 0){
    panel.style.display = "none";
    return;
  }
  panel.style.display = "block";
  countEl.textContent = suspended.length > 0
    ? `${suspended.length} sospesi · ${completed.length} completati`
    : `${completed.length} completati`;

  let html = "";

  // Job attivo (se scraping in corso)
  if(scraping && currentScrapingCountry){
    const flag = countryFlag(currentScrapingCountry);
    const cName = selectedCountries.find(c => c.code === currentScrapingCountry)?.name || currentScrapingCountry;
    html += `<div style="display:flex;align-items:center;gap:10px;padding:8px 12px;border-radius:8px;background:rgba(16,185,129,0.08);border:1px solid rgba(16,185,129,0.2)">
      <span style="font-size:1.4rem">${flag}</span>
      <div style="flex:1;min-width:0">
        <div style="font-size:.78rem;font-weight:700;color:#6ee7b7">${cName}</div>
        <div style="font-size:.65rem;color:var(--text-muted)">In corso...</div>
      </div>
      <span style="font-size:.6rem;padding:2px 8px;border-radius:6px;background:rgba(16,185,129,0.15);color:#6ee7b7;font-weight:600;animation:pulse 2s infinite">● ATTIVO</span>
    </div>`;
  }

  // Job sospesi
  for(const job of suspended){
    const flag = countryFlag(job.code);
    const ageMin = Math.round((Date.now() - job.ts) / 60000);
    const ageStr = ageMin < 60 ? ageMin+"min fa" : Math.round(ageMin/60)+"h fa";
    const pct = job.total > 0 ? Math.round(job.done / job.total * 100) : 0;
    html += `<div style="display:flex;align-items:center;gap:10px;padding:8px 12px;border-radius:8px;background:rgba(245,158,11,0.06);border:1px solid rgba(245,158,11,0.18)">
      <span style="font-size:1.4rem">${flag}</span>
      <div style="flex:1;min-width:0">
        <div style="display:flex;align-items:center;gap:6px">
          <span style="font-size:.78rem;font-weight:700;color:#fbbf24">${job.name}</span>
          <span style="font-size:.6rem;color:var(--text-muted)">${ageStr}</span>
        </div>
        <div style="display:flex;align-items:center;gap:8px;margin-top:3px">
          <div style="flex:1;height:4px;background:rgba(255,255,255,0.06);border-radius:2px;overflow:hidden;max-width:120px">
            <div style="height:100%;width:${pct}%;background:#fbbf24;border-radius:2px"></div>
          </div>
          <span style="font-size:.62rem;color:var(--text-muted)">${job.done}/${job.total} (${pct}%)</span>
        </div>
      </div>
      <div style="display:flex;gap:4px;flex-shrink:0">
        <button onclick="resumeScraping('${job.code}')" class="btn btn-sm" style="font-size:.62rem;padding:4px 10px;background:rgba(99,102,241,0.15);color:#a5b4fc;border:1px solid rgba(99,102,241,0.3);border-radius:6px">▶ Riprendi</button>
        <button onclick="removeJobAndRefresh('${job.code}')" class="btn btn-sm" style="font-size:.62rem;padding:4px 8px;background:rgba(239,68,68,0.1);color:#fca5a5;border:1px solid rgba(239,68,68,0.2);border-radius:6px">✕</button>
      </div>
    </div>`;
  }

  // Job completati
  for(const job of completed.slice(0, 20)){
    const flag = countryFlag(job.code);
    const ageMin = Math.round((Date.now() - job.ts) / 60000);
    const ageStr = ageMin < 60 ? ageMin+"min fa" : ageMin < 1440 ? Math.round(ageMin/60)+"h fa" : Math.round(ageMin/1440)+"g fa";
    html += `<div style="display:flex;align-items:center;gap:10px;padding:6px 12px;border-radius:8px;background:rgba(16,185,129,0.04);border:1px solid rgba(16,185,129,0.1)">
      <span style="font-size:1.2rem">${flag}</span>
      <div style="flex:1;min-width:0">
        <span style="font-size:.75rem;font-weight:600;color:#6ee7b7">${job.name}</span>
        <span style="font-size:.6rem;color:var(--text-muted);margin-left:6px">${job.total} partner · ${ageStr}</span>
      </div>
      <span style="font-size:.58rem;padding:2px 6px;border-radius:4px;background:rgba(16,185,129,0.1);color:#6ee7b7;font-weight:600">✓</span>
    </div>`;
  }

  listEl.innerHTML = html;
  emptyEl.style.display = total === 0 ? "block" : "none";

  // Mostra/nascondi il tasto Resume
  const btnResume = document.getElementById("btnResume");
  if(suspended.length > 0 && btnResume) btnResume.style.display = "inline-flex";
}
function removeJobAndRefresh(code){
  removeSuspendedJob(code);
  renderDownloadManager();
  const jobs = getSuspendedJobs();
  const btnRes = document.getElementById("btnResume");
  if(jobs.length === 0 && btnRes) btnRes.style.display = "none";
}

// === BACKGROUND JOB ===
let bgJobId = null;
let bgPollInterval = null;

async function startBackgroundJob(){
  const countries = selectedCountries.length > 0 ? [...selectedCountries] : [];
  if(countries.length === 0){ log("Seleziona almeno un paese","err"); return; }
  const networks = getSelectedNetworks();
  const searchTerm = document.getElementById("txtSearch").value.trim();
  const searchBy = document.getElementById("selSearchBy").value;

  log("Avvio job in background...","ok");
  document.getElementById("btnStartBg").disabled = true;

  try {
    const resp = await fetch(API+"/api/job-start",{
      method:"POST", headers:{"Content-Type":"application/json"},
      body:JSON.stringify({ countries, networks, searchTerm, searchBy })
    });
    const data = await resp.json();
    if(data.success){
      bgJobId = data.jobId;
      log(`Job #${bgJobId} avviato in background! Puoi chiudere il browser.`,"ok");
      showBgPanel();
      startBgPolling();
    } else {
      log("Errore avvio job: "+(data.error||"sconosciuto"),"err");
    }
  } catch(e){
    log("Errore: "+e.message,"err");
  }
  document.getElementById("btnStartBg").disabled = false;
}

function showBgPanel(){
  document.getElementById("bgJobPanel").style.display = "block";
}
function hideBgPanel(){
  document.getElementById("bgJobPanel").style.display = "none";
  if(bgPollInterval){ clearInterval(bgPollInterval); bgPollInterval = null; }
}

function startBgPolling(){
  if(bgPollInterval) clearInterval(bgPollInterval);
  pollBgStatus(); // subito
  bgPollInterval = setInterval(pollBgStatus, 3000); // ogni 3s
}

async function pollBgStatus(){
  try {
    const url = bgJobId ? API+`/api/job-status?jobId=${bgJobId}` : API+"/api/job-status";
    const resp = await fetch(url);
    const data = await resp.json();
    if(!data.success || !data.job) return;
    const j = data.job;
    bgJobId = j.id;

    // Aggiorna UI
    const statusEl = document.getElementById("bgJobStatus");
    const statusMap = {
      pending:"🔄 Preparazione", discovering:"📋 Discover", downloading:"📥 Download",
      enriching:"🔗 Arricchimento", completed:"✅ Completato", paused:"⏸ In pausa",
      cancelled:"✗ Annullato", error:"❌ Errore"
    };
    statusEl.textContent = statusMap[j.status] || j.status;
    statusEl.style.background = j.status==="downloading"?"#059669":j.status==="completed"?"#065f46":j.status==="paused"?"#d97706":j.status==="error"?"#dc2626":"#4f46e5";

    document.getElementById("bgJobActivity").textContent = j.lastActivity || "—";
    document.getElementById("bgJobCountry").textContent = j.currentCountry || "—";
    document.getElementById("bgJobProgress").textContent = `${j.currentMemberIdx}/${j.totalMembers}`;
    document.getElementById("bgJobScraped").textContent = j.totalScraped;
    document.getElementById("bgJobSkipped").textContent = j.totalSkipped;
    const pct = j.totalMembers > 0 ? (j.currentMemberIdx / j.totalMembers * 100) : 0;
    document.getElementById("bgProgressFill").style.width = pct + "%";

    // Mostra/nascondi bottoni pausa/riprendi
    const isActive = ["pending","discovering","downloading","enriching"].includes(j.status);
    document.getElementById("bgPauseBtn").style.display = isActive ? "inline-block" : "none";
    document.getElementById("bgResumeBtn").style.display = j.status === "paused" ? "inline-block" : "none";

    // Se completato o annullato, ferma polling
    if(j.status === "completed" || j.status === "cancelled"){
      if(bgPollInterval){ clearInterval(bgPollInterval); bgPollInterval = null; }
      if(j.status === "completed") log(`Job #${j.id} completato! ${j.totalScraped} profili salvati.`,"ok");
    }
  } catch(e){ console.warn("pollBgJob error:", e.message); }
}

async function pauseBackgroundJob(){
  if(!bgJobId) return;
  await fetch(API+"/api/job-start",{
    method:"POST", headers:{"Content-Type":"application/json"},
    body:JSON.stringify({ action:"pause", jobId:bgJobId })
  });
  log("Job messo in pausa","warn");
}

async function resumeBackgroundJob(){
  if(!bgJobId) return;
  await fetch(API+"/api/job-start",{
    method:"POST", headers:{"Content-Type":"application/json"},
    body:JSON.stringify({ action:"resume", jobId:bgJobId })
  });
  log("Job ripreso","ok");
  startBgPolling();
}

async function cancelBackgroundJob(){
  if(!bgJobId) return;
  await fetch(API+"/api/job-start",{
    method:"POST", headers:{"Content-Type":"application/json"},
    body:JSON.stringify({ action:"cancel", jobId:bgJobId })
  });
  log("Job annullato","warn");
  hideBgPanel();
}

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
