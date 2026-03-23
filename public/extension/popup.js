const API = "https://wca-app.vercel.app";
let scraping = false;
let sessionCookies = null;
let currentCountry = "";
let totalScraped = 0;

const DELAY_PATTERN = [3,3,2,3,8,3,5,3,12,3,4,3,6,3,9,3,3,3,10];
let delayIndex = 0;
function getNextDelay(){
  const d = DELAY_PATTERN[delayIndex % DELAY_PATTERN.length];
  delayIndex++;
  return (delayIndex % DELAY_PATTERN.length === 0) ? 15000 : d * 1000;
}

// === STORAGE (usa chrome.storage.local) ===
async function getDir(code){ return (await chrome.storage.local.get("dir_"+code))["dir_"+code] || null; }
async function saveDir(code, dir){ await chrome.storage.local.set({["dir_"+code]: dir}); }
async function getJobs(){ return (await chrome.storage.local.get("jobs"))["jobs"] || []; }
async function saveJobs(jobs){ await chrome.storage.local.set({jobs}); }

async function createDir(code, ids){
  const entries = {};
  for(const id of ids) entries[String(id)] = "pending";
  const dir = {ids: entries, ts: Date.now(), total: ids.length};
  await saveDir(code, dir);
  return dir;
}
async function markDone(code, id){
  const dir = await getDir(code); if(!dir) return;
  dir.ids[String(id)] = "done"; await saveDir(code, dir);
}
async function markFailed(code, id){
  const dir = await getDir(code); if(!dir) return;
  dir.ids[String(id)] = "failed"; await saveDir(code, dir);
}
function getPending(dir){ return Object.keys(dir.ids).filter(id => dir.ids[id]==="pending"); }
function getDone(dir){ return Object.values(dir.ids).filter(s => s==="done").length; }

// === UI ===
function log(msg, type=""){
  const box = document.getElementById("logBox");
  const line = document.createElement("div");
  line.className = "log-line "+(type||"");
  line.textContent = msg;
  box.prepend(line);
  if(box.children.length > 200) box.lastChild.remove();
}
function setStatus(text, active){
  document.getElementById("statusText").textContent = text;
  document.getElementById("statusDot").className = "dot"+(active?" on":"");
}
function setProgress(cur, tot){
  const pct = tot > 0 ? Math.round(cur/tot*100) : 0;
  document.getElementById("progressFill").style.width = pct+"%";
}
function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }

// === API CALLS ===
async function apiCall(endpoint, body){
  const resp = await fetch(API+endpoint, {
    method: "POST", headers: {"Content-Type":"application/json"},
    body: body ? JSON.stringify(body) : undefined,
  });
  return await resp.json();
}

// === LOGIN ===
async function doLogin(){
  document.getElementById("btnLogin").disabled = true;
  setStatus("Login in corso...", true);
  log("Avvio login WCA...");
  try {
    const data = await apiCall("/api/login", {});
    if(data.success){
      sessionCookies = data.cookies;
      document.getElementById("loginBadge").textContent = "ONLINE";
      document.getElementById("loginBadge").style.background = "#059669";
      document.getElementById("btnStart").disabled = false;
      setStatus("Connesso a WCA", false);
      log("✓ Login riuscito","ok");
    } else {
      log("✗ Login fallito: "+(data.error||""),"err");
      setStatus("Login fallito");
    }
  } catch(e){ log("Errore: "+e.message,"err"); setStatus("Errore connessione"); }
  document.getElementById("btnLogin").disabled = false;
}

// === SCRAPING ===
async function startScraping(){
  const sel = document.getElementById("selCountry");
  const code = sel.value;
  const name = sel.options[sel.selectedIndex].text;
  if(!code){ log("Seleziona un paese","warn"); return; }
  if(!sessionCookies){ log("Fai prima il login","err"); return; }

  currentCountry = code;
  scraping = true;
  document.getElementById("btnStart").disabled = true;
  document.getElementById("btnStop").disabled = false;

  // Check directory locale
  let dir = await getDir(code);
  if(dir){
    const pending = getPending(dir);
    const done = getDone(dir);
    if(pending.length === 0){
      alert(name+": COMPLETO!\n\n"+dir.total+" partner già tutti scaricati.");
      scraping = false;
      document.getElementById("btnStart").disabled = false;
      document.getElementById("btnStop").disabled = true;
      return;
    }
    // Ripresa
    log("📂 "+name+": "+done+" fatti, "+pending.length+" da fare — ripresa","ok");
    setStatus(name+": ripresa "+pending.length+" profili...", true);
    await downloadIds(code, name, pending);
  } else {
    // Discover
    await discoverAndDownload(code, name);
  }

  scraping = false;
  document.getElementById("btnStart").disabled = false;
  document.getElementById("btnStop").disabled = true;
  if(totalScraped > 0) setStatus("Completato! "+totalScraped+" salvati", false);
  await loadJobs();
}

async function discoverAndDownload(code, name){
  log("📋 Discover "+name+"...");
  setStatus(name+": ricerca partner...", true);
  let allMembers = [];
  let page = 1;
  while(scraping){
    setStatus(name+": pagina "+page+"... ("+allMembers.length+" trovati)", true);
    try {
      const data = await apiCall("/api/discover", {
        cookies: sessionCookies, page,
        filters: {country: code, searchTerm:"", searchBy:"", networks:[]}
      });
      if(!data.success){ log("Errore discover: "+(data.error||""),"err"); break; }
      const members = data.members || [];
      allMembers.push(...members);
      log("Pag."+page+": +"+members.length+" (tot: "+allMembers.length+")");
      if(members.length === 0 || !data.hasNext) break;
      page++;
      await sleep(getNextDelay());
    } catch(e){ log("Errore: "+e.message,"err"); break; }
  }

  if(allMembers.length === 0){ log("Nessun partner trovato","warn"); return; }

  log("📂 Creata directory: "+allMembers.length+" ID per "+name,"ok");
  const dir = await createDir(code, allMembers.map(m => m.id));

  // Salva membri per ripresa
  const jobs = await getJobs();
  const existing = jobs.filter(j => j.code !== code);
  existing.unshift({code, name, members: allMembers, ts: Date.now()});
  await saveJobs(existing);

  await downloadIds(code, name, allMembers.map(m => String(m.id)));
}

async function downloadIds(code, name, pendingIds){
  const total = pendingIds.length;
  log("📥 Download "+total+" profili per "+name);

  // Carica membri dal job per avere href
  const jobs = await getJobs();
  const job = jobs.find(j => j.code === code);
  const memberMap = {};
  if(job?.members){
    for(const m of job.members) memberMap[String(m.id)] = m;
  }

  let failures = 0;
  for(let i = 0; i < total && scraping; i++){
    const id = pendingIds[i];
    const member = memberMap[id] || {};
    setStatus(name+": "+(i+1)+"/"+total+" — ID "+id, true);
    setProgress(i+1, total);

    let retries = 0, ok = false;
    while(retries <= 2 && scraping && !ok){
      try {
        const data = await apiCall("/api/scrape", {
          wcaIds: [id],
          members: member.href ? [{id, href: member.href}] : []
        });
        if(!data.success){
          if(retries < 2){ retries++; log("Retry "+retries+" per "+id,"warn"); await sleep(15000); continue; }
          await markFailed(code, id); failures++; ok = true; break;
        }
        const p = data.results?.[0];
        if(p?.state === "ok"){
          log("✓ "+p.company_name,"ok");
          await apiCall("/api/save", {profile: {...p, country_code: code}});
          await markDone(code, id);
          totalScraped++; failures = 0; ok = true;
        } else if(p?.state === "not_found"){
          log("✗ "+id+" non trovato","warn");
          await markFailed(code, id);
          await apiCall("/api/save", {profile: {wca_id: id, company_name:"[NOT FOUND]", state:"not_found", country_code: code}});
          ok = true;
        } else if(p?.state === "login_redirect"){
          if(retries < 2){ retries++; log("Sessione scaduta, retry...","warn"); await sleep(15000); continue; }
          await markFailed(code, id); ok = true;
        } else { ok = true; }
      } catch(e){
        if(retries < 2){ retries++; await sleep(10000); continue; }
        failures++; ok = true;
      }
    }
    if(failures >= 5){ log("⛔ Troppi errori — stop","err"); break; }
    if(i+1 < total && scraping) await sleep(getNextDelay());
  }

  // Aggiorna job
  const dir = await getDir(code);
  if(dir && getPending(dir).length === 0){
    log("✅ "+name+" COMPLETO!","ok");
    // Rimuovi da jobs
    const js = await getJobs();
    await saveJobs(js.filter(j => j.code !== code));
  } else {
    // Salva stato sospeso
    const js = await getJobs();
    const j = js.find(x => x.code === code);
    if(j){ j.ts = Date.now(); await saveJobs(js); }
    log("💾 Job sospeso: "+name,"warn");
  }
  await loadJobs();
}

function stopScraping(){
  scraping = false;
  setStatus("Fermato", false);
  document.getElementById("btnStop").disabled = true;
  document.getElementById("btnStart").disabled = false;
  log("⏸ Scraping fermato","warn");
}

// === JOBS SOSPESI UI ===
async function loadJobs(){
  const jobs = await getJobs();
  const card = document.getElementById("jobsCard");
  const list = document.getElementById("jobsList");
  if(jobs.length === 0){ card.style.display = "none"; return; }
  card.style.display = "block";
  let html = "";
  for(const j of jobs){
    const dir = await getDir(j.code);
    const pending = dir ? getPending(dir).length : "?";
    const done = dir ? getDone(dir) : 0;
    const ago = Math.round((Date.now()-j.ts)/60000);
    const ageStr = ago < 60 ? ago+"min" : Math.round(ago/60)+"h";
    html += `<div class="job-item">
      <div class="info"><strong>${j.name}</strong> <span class="counts">${done}/${dir?.total||"?"} fatti, ${pending} rimanenti (${ageStr} fa)</span></div>
      <button class="btn btn-sm btn-success" onclick="resumeJob('${j.code}')">▶</button>
      <button class="btn btn-sm btn-danger" onclick="deleteJob('${j.code}')">✗</button>
    </div>`;
  }
  list.innerHTML = html;
}

async function resumeJob(code){
  const sel = document.getElementById("selCountry");
  sel.value = code;
  await startScraping();
}

async function deleteJob(code){
  if(!confirm("Eliminare questo job?")) return;
  const jobs = await getJobs();
  await saveJobs(jobs.filter(j => j.code !== code));
  await chrome.storage.local.remove("dir_"+code);
  await loadJobs();
  log("Job eliminato","warn");
}

// Init
loadJobs();
