// WCA — Supabase Operations

// Carica directory di un paese da Supabase se non in localStorage
async function loadDirectoryFromSupabase(countryCode){
  try {
    const resp = await fetch(API+"/api/load-directory?country="+countryCode);
    const data = await resp.json();
    if(data.success && data.members && data.members.length > 0){
      const result = { members: data.members, networks: data.networks || {}, ts: Date.now() };
      saveFullDirectory(countryCode, result);
      // Aggiorna directory locale
      let dir = getDirectory(countryCode);
      if(!dir) dir = createDirectory(countryCode, data.members.map(m => m.id));
      else {
        let updated = false;
        for(const m of data.members){
          if(!(String(m.id) in dir.ids)){ dir.ids[String(m.id)] = "pending"; updated = true; }
        }
        if(updated){ dir.total = Object.keys(dir.ids).length; saveDirectory(countryCode, dir); }
      }
      return result;
    }
  } catch(e){ console.log("loadDirectory error:", e.message); }
  return null;
}

// ═══ BACKFILL: pusha directory localStorage → Supabase ═══
async function backfillDirectoryToSupabase(){
  const allCountries = getAllCountryList();
  let pushed = 0, skipped = 0;
  for(const c of allCountries){
    const dir = getFullDirectory(c.code);
    if(!dir || !dir.members || dir.members.length === 0){ skipped++; continue; }
    try {
      await fetch(API+"/api/save-directory",{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({ countryCode: c.code, members: dir.members })
      });
      pushed++;
      if(pushed % 10 === 0) log(`📤 Backfill Supabase: ${pushed} paesi...`,"ok");
    } catch(e){ console.log("backfill error:", c.code, e.message); }
  }
  if(pushed > 0){
    log(`✅ Backfill completato: ${pushed} paesi pushati in Supabase`,"ok");
    localStorage.setItem("wca_dir_backfill_done", "1");
  }
}

// Reset tutti i dati directory da Supabase
async function resetDirectorySupabase(){
  if(!confirm("Cancellare TUTTI i dati directory da Supabase?\n\nI profili scaricati restano intatti.")) return;
  if(!confirm("SEI SICURO? Resetta directory per TUTTI i paesi.")) return;
  closeResetPanel();
  try {
    log("🗑 Reset directory Supabase in corso...","warn");
    const resp = await fetch(API+"/api/reset-directory",{ method:"POST", headers:{"Content-Type":"application/json"} });
    const data = await resp.json();
    if(data.success){
      // Pulisci anche localStorage directory
      const allCountries = getAllCountryList();
      let cleared = 0;
      for(const c of allCountries){
        const key = "wca_fulldir_"+c.code;
        if(localStorage.getItem(key)){ localStorage.removeItem(key); cleared++; }
      }
      localStorage.removeItem("wca_dir_backfill_done");
      log(`🗑 Directory resettata: ${data.updated} in Supabase, ${cleared} in localStorage`,"ok");
      updateDirHeaderCounts();
    } else {
      log(`⚠ Errore reset directory: ${data.error}`,"warn");
    }
  } catch(e){ log(`⚠ Errore reset directory: ${e.message}`,"warn"); }
}

// Conta totale partner e paesi nelle directory locali
function updateDirHeaderCounts(){
  let totalMembers = 0;
  let totalCountries = 0;
  const allCountries = getAllCountryList();
  for(const c of allCountries){
    const dir = getFullDirectory(c.code);
    if(dir && dir.members){
      totalCountries++;
      totalMembers += dir.members.length;
    }
  }
  const el1 = document.getElementById("headerDirPartners");
  const el2 = document.getElementById("headerDirCountries");
  if(el1) el1.textContent = totalMembers.toLocaleString();
  if(el2) el2.textContent = totalCountries;
}

// Carica stats directory da Supabase e aggiorna header
async function loadDirStatsFromSupabase(){
  try {
    const resp = await fetch(API+"/api/load-directory?mode=stats");
    const data = await resp.json();
    if(data.success){
      const el1 = document.getElementById("headerDirPartners");
      const el2 = document.getElementById("headerDirCountries");
      if(el1) el1.textContent = data.totalPartners.toLocaleString();
      if(el2) el2.textContent = data.totalCountries;
      // Aggiorna anche contatori DB
      const dbP = document.getElementById("headerDbPartners");
      const dbC = document.getElementById("headerDbCountries");
      if(dbP) dbP.textContent = data.totalPartners.toLocaleString();
      if(dbC) dbC.textContent = data.totalCountries;
    }
  } catch(e){ console.log("loadDirStats error:", e.message); }
}

// Flash bandiera + conteggio dopo ogni save-directory
let dbFlashTimer = null;
let dbRunningTotal = 0;
function showDbFlash(countryCode, saved, totalDb){
  const el = document.getElementById("dbFlash");
  if(!el) return;
  const flag = countryFlag(countryCode);
  const countryName = (getAllCountryList().find(c => c.code === countryCode) || {}).name || countryCode;
  // Anima il totale che sale
  const prevTotal = dbRunningTotal || (totalDb - saved);
  dbRunningTotal = totalDb;
  el.innerHTML = `<span style="font-size:2rem;vertical-align:middle;margin-right:8px">${flag}</span> <span style="font-size:.85rem;opacity:.85">${countryName}</span> &nbsp; <span style="color:#fde68a;font-size:1.3rem">+${saved}</span> &nbsp; <span style="font-size:.8rem;opacity:.7">→</span> &nbsp; <span id="dbFlashTotal" style="font-size:1.5rem;color:#fff;text-shadow:0 0 12px rgba(255,255,255,0.5)">${totalDb.toLocaleString()}</span> <span style="font-size:.75rem;opacity:.6">partner totali in DB</span>`;
  el.style.display = "block";
  el.style.opacity = "1";
  // Anima il contatore DB nell'header con un pulse
  const dbP = document.getElementById("headerDbPartners");
  if(dbP){
    dbP.textContent = totalDb.toLocaleString();
    dbP.style.transition = "transform .2s, color .2s";
    dbP.style.transform = "scale(1.4)";
    dbP.style.color = "#4ade80";
    setTimeout(() => { dbP.style.transform = "scale(1)"; dbP.style.color = ""; }, 600);
  }
  if(dbFlashTimer) clearTimeout(dbFlashTimer);
  dbFlashTimer = setTimeout(() => { el.style.opacity = "0"; setTimeout(() => { el.style.display = "none"; }, 400); }, 5000);
}

// Aggiorna contatori DB real-time (chiamata leggera dopo ogni save)
async function refreshDbCounters(){
  try {
    const resp = await fetch(API+"/api/load-directory?mode=stats");
    const data = await resp.json();
    if(data.success){
      const dbP = document.getElementById("headerDbPartners");
      const dbC = document.getElementById("headerDbCountries");
      if(dbP) dbP.textContent = data.totalPartners.toLocaleString();
      if(dbC) dbC.textContent = data.totalCountries;
      return data.totalPartners;
    }
  } catch(e){}
  return 0;
}

// Salva profilo a Supabase
async function saveToSupabase(profile){
  try{
    if(currentScrapingCountry && !profile.country_code) profile.country_code = currentScrapingCountry;
    const resp = await fetch(API+"/api/save",{
      method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({profile})
    });
    const data = await resp.json();
    if(!data.success){
      log(`⚠️ Save fallito ${profile.wca_id}: ${data.error}`,"warn");
    } else {
      // Aggiorna conteggio bandiere in tempo reale
      incrementPartnerCount(profile.country_code);
    }
  } catch(e){log(`❌ Errore save ${profile.wca_id}: ${e.message}`,"err");}
}
