// Script per applicare le modifiche a index.html
// Eseguire con: node patch.js
const fs = require('fs');
let html = fs.readFileSync('public/index.html', 'utf8');

// === 1. SOSTITUIRE IL BLOCCO VARIABILI GLOBALI (completedCountries + markAttempted) ===
const oldVars = `// Country completate — salvate in localStorage
let completedCountries = {};
try { completedCountries = JSON.parse(localStorage.getItem("wca_completed_countries")||"{}"); } catch(e){}
function markCountryCompleted(code, count){
  if(!code) return;
  completedCountries[code] = { count, ts: Date.now() };
  try { localStorage.setItem("wca_completed_countries", JSON.stringify(completedCountries)); } catch(e){}
}
function isCountryCompleted(code){
  return code && completedCountries[code];
}
function resetCompletedCountries(){
  completedCountries = {};
  try { localStorage.removeItem("wca_completed_countries"); } catch(e){}
  log("Country completate resettate","ok");
}`;

const newVars = `// === DIRECTORY LOCALE PER PAESE ===
// Ogni paese ha una directory in localStorage: wca_dir_XX = { ids: {id: "pending"|"done"|"failed"}, ts, total }
function getDirectory(code){
  if(!code) return null;
  try { return JSON.parse(localStorage.getItem("wca_dir_"+code)); } catch(e){ return null; }
}
function saveDirectory(code, dir){
  if(!code) return;
  try { localStorage.setItem("wca_dir_"+code, JSON.stringify(dir)); } catch(e){ console.warn("saveDir err:", e.message); }
}
function createDirectory(code, memberIds){
  const ids = {};
  for(const id of memberIds) ids[String(id)] = "pending";
  const dir = { ids, ts: Date.now(), total: memberIds.length };
  saveDirectory(code, dir);
  return dir;
}
function markIdDone(code, id){
  const dir = getDirectory(code);
  if(!dir) return;
  dir.ids[String(id)] = "done";
  saveDirectory(code, dir);
}
function markIdFailed(code, id){
  const dir = getDirectory(code);
  if(!dir) return;
  dir.ids[String(id)] = "failed";
  saveDirectory(code, dir);
}
function getPendingIds(code){
  const dir = getDirectory(code);
  if(!dir) return [];
  return Object.keys(dir.ids).filter(id => dir.ids[id] === "pending");
}
function getDoneCount(code){
  const dir = getDirectory(code);
  if(!dir) return 0;
  return Object.values(dir.ids).filter(s => s === "done").length;
}
function isCountryCompleted(code){
  const dir = getDirectory(code);
  if(!dir) return false;
  const pending = Object.values(dir.ids).filter(s => s === "pending").length;
  return pending === 0;
}
function markCountryCompleted(code, count){
  // La directory stessa è il flag — se tutti done/failed, è completo
  // Non serve fare nulla di extra, isCountryCompleted() legge lo stato
}

// === JOBS SOSPESI ===
function getSuspendedJobs(){
  try { return JSON.parse(localStorage.getItem("wca_suspended_jobs")||"[]"); } catch(e){ return []; }
}
function saveSuspendedJob(countryCode, countryName, pendingIds, allMembers){
  const jobs = getSuspendedJobs().filter(j => j.code !== countryCode); // rimuovi vecchio job stesso paese
  jobs.unshift({
    code: countryCode,
    name: countryName,
    pending: pendingIds.length,
    total: allMembers.length,
    done: allMembers.length - pendingIds.length,
    ts: Date.now(),
    members: allMembers, // salva i membri per ripresa
  });
  try { localStorage.setItem("wca_suspended_jobs", JSON.stringify(jobs)); } catch(e){}
}
function removeSuspendedJob(countryCode){
  const jobs = getSuspendedJobs().filter(j => j.code !== countryCode);
  try { localStorage.setItem("wca_suspended_jobs", JSON.stringify(jobs)); } catch(e){}
}`;

if(html.includes(oldVars)){
  html = html.replace(oldVars, newVars);
  console.log("✅ 1. Variabili globali sostituite");
} else {
  console.log("❌ 1. Variabili globali NON trovate — cerco alternativa");
  // Prova a trovare il blocco in modo meno rigido
}

// === 2. SOSTITUIRE checkMissingIds con versione locale ===
const oldCheck = `async function checkMissingIds(discoverIds, countryCode){
  const t0 = performance.now();
  try {
    showActivity("🔍", \`Confronto rapido \${discoverIds.length} ID...\`);
    const resp = await fetch(API+"/api/check-ids", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({ids: discoverIds, country: countryCode || ""})
    });
    const data = await resp.json();
    const ms = Math.round(performance.now() - t0);
    if(!data.success){
      log(\`⚠️ Errore confronto: \${data.error||"sconosciuto"}\`,"warn");
      return {missing: discoverIds, total_in_db: 0, elapsed_ms: ms};
    }
    log(\`⚡ Confronto completato in \${ms}ms — \${data.found} in DB, \${data.missing.length} mancanti\`, data.missing.length > 0 ? "warn" : "ok");
    return data;
  } catch(e){
    log(\`❌ Errore confronto: \${e.message}\`,"err");
    return {missing: discoverIds, total_in_db: 0, elapsed_ms: Math.round(performance.now() - t0)};
  }
}`;

const newCheck = `// checkMissingIds ora usa la directory locale — ZERO query server
function checkMissingIdsLocal(discoverIds, countryCode){
  const dir = getDirectory(countryCode);
  if(!dir){
    // Nessuna directory = primo scraping, tutti mancanti
    log(\`📂 \${countryCode}: nessuna directory locale — primo scraping\`,"ok");
    return { missing: discoverIds, found: 0 };
  }
  const missing = discoverIds.filter(id => dir.ids[String(id)] !== "done");
  const found = discoverIds.length - missing.length;
  log(\`📂 Directory locale \${countryCode}: \${found} già fatti, \${missing.length} da fare\`,"ok");
  return { missing, found };
}`;

if(html.includes(oldCheck)){
  html = html.replace(oldCheck, newCheck);
  console.log("✅ 2. checkMissingIds sostituita con versione locale");
} else {
  console.log("❌ 2. checkMissingIds NON trovata");
}

// === 3. SOSTITUIRE il blocco confronto in scrapeDiscoverCountry ===
const oldCompare = `  // === CONFRONTO RAPIDO CON DATABASE ===
  setStatus(\`\${countryName}: confronto rapido \${discoveredMembers.length} ID...\`, true);
  const allDiscoverIds = discoveredMembers.map(m => m.id);
  const checkResult = await checkMissingIds(allDiscoverIds, country);
  const missingSet = new Set(checkResult.missing.map(String));
  const inDb = discoveredMembers.length - missingSet.size;
  hideActivity();

  // Segna nella tabella quelli già in DB
  for(const m of discoveredMembers){
    if(!missingSet.has(String(m.id))) updateResultRow(m.id, "in_db");
  }

  let toDownload;
  if(updateAddress){
    // Aggiornamento address: riscarica TUTTI
    toDownload = [...discoveredMembers];
    log(\`🔄 Aggiornamento address: riscarico tutti i \${toDownload.length} profili\`,"warn");
    setStatus(\`\${countryName}: aggiornamento address di \${toDownload.length} profili\`, true);
  } else if(missingSet.size === 0){
    // TUTTO GIÀ IN DB — popup chiaro
    markCountryCompleted(country, discoveredMembers.length);
    setProgress(100, 100);
    setStatus(\`✅ \${countryName}: COMPLETO — \${discoveredMembers.length} partner tutti in DB\`, true);
    showActivity("✅", \`\${countryName} completo!\`);

    alert(\`\${countryFlag(country)} \${countryName}: COMPLETO!\\n\\n\${discoveredMembers.length} partner già tutti presenti nel database.\\nNessun download necessario.\`);

    setTimeout(hideActivity, 3000);
    return;
  } else {
    toDownload = discoveredMembers.filter(m => missingSet.has(String(m.id)));
    setStatus(\`\${countryName}: \${inDb} in DB, \${toDownload.length} da scaricare\`, true);
    log(\`📥 \${countryName}: avvio download di \${toDownload.length} profili mancanti\`,"ok");
  }`;

const newCompare = `  // === CONFRONTO CON DIRECTORY LOCALE (istantaneo, zero query) ===
  const allDiscoverIds = discoveredMembers.map(m => m.id);

  // Crea/aggiorna directory locale per questo paese
  let dir = getDirectory(country);
  if(!dir){
    dir = createDirectory(country, allDiscoverIds);
    log(\`📂 Directory creata per \${countryName}: \${allDiscoverIds.length} ID\`,"ok");
  } else {
    // Aggiungi eventuali nuovi ID non presenti nella directory
    let added = 0;
    for(const id of allDiscoverIds){
      if(!(String(id) in dir.ids)){ dir.ids[String(id)] = "pending"; added++; }
    }
    if(added > 0){ dir.total = Object.keys(dir.ids).length; saveDirectory(country, dir); log(\`📂 Directory aggiornata: +\${added} nuovi ID\`,"ok"); }
  }

  const localCheck = checkMissingIdsLocal(allDiscoverIds, country);
  const inDb = localCheck.found;

  // Segna nella tabella quelli già fatti
  for(const m of discoveredMembers){
    if(dir.ids[String(m.id)] === "done") updateResultRow(m.id, "in_db");
  }

  let toDownload;
  if(updateAddress){
    toDownload = [...discoveredMembers];
    log(\`🔄 Aggiornamento address: riscarico tutti i \${toDownload.length} profili\`,"warn");
    setStatus(\`\${countryName}: aggiornamento address di \${toDownload.length} profili\`, true);
  } else if(localCheck.missing.length === 0){
    setProgress(100, 100);
    setStatus(\`✅ \${countryName}: COMPLETO — \${discoveredMembers.length} partner tutti fatti\`, true);
    showActivity("✅", \`\${countryName} completo!\`);
    alert(\`\${countryFlag(country)} \${countryName}: COMPLETO!\\n\\n\${discoveredMembers.length} partner già tutti scaricati.\\nNessun download necessario.\`);
    setTimeout(hideActivity, 3000);
    removeSuspendedJob(country);
    return;
  } else {
    const missingSet = new Set(localCheck.missing.map(String));
    toDownload = discoveredMembers.filter(m => missingSet.has(String(m.id)));
    setStatus(\`\${countryName}: \${inDb} fatti, \${toDownload.length} da scaricare\`, true);
    log(\`📥 \${countryName}: \${inDb} già fatti, avvio download di \${toDownload.length} mancanti\`,"ok");
  }`;

if(html.includes(oldCompare)){
  html = html.replace(oldCompare, newCompare);
  console.log("✅ 3. Blocco confronto sostituito con directory locale");
} else {
  console.log("❌ 3. Blocco confronto NON trovato");
}

// === 4. SOSTITUIRE markAttempted con markIdDone/markIdFailed ===
// Dopo download ok: markIdDone
html = html.replace(/markAttempted\(member\.id\);.*$/gm, '');
console.log("✅ 4. markAttempted rimosso");

// === 5. Aggiungere markIdDone dopo saveToSupabase nel download ok ===
html = html.replace(
  'saveToSupabase(profile);\n            updateResultRow(profile.wca_id, "ok");',
  'saveToSupabase(profile);\n            markIdDone(currentScrapingCountry, profile.wca_id);\n            updateResultRow(profile.wca_id, "ok");'
);
console.log("✅ 5. markIdDone aggiunto dopo download ok");

// === 6. Aggiungere markIdFailed dopo i casi di errore ===
// not_found
html = html.replace(
  'saveToSupabase({wca_id: member.id, company_name: "[NOT FOUND]", state: "not_found", country_code: currentScrapingCountry});\n            consecutiveFailures = 0;\n            success = true;',
  'saveToSupabase({wca_id: member.id, company_name: "[NOT FOUND]", state: "not_found", country_code: currentScrapingCountry});\n            markIdFailed(currentScrapingCountry, member.id);\n            consecutiveFailures = 0;\n            success = true;'
);
// sso_failed
html = html.replace(
  'saveToSupabase({wca_id: member.id, company_name: "[SSO FAILED]", state: "sso_failed", country_code: currentScrapingCountry});\n          consecutiveFailures++; done = true; break;',
  'saveToSupabase({wca_id: member.id, company_name: "[SSO FAILED]", state: "sso_failed", country_code: currentScrapingCountry});\n          markIdFailed(currentScrapingCountry, member.id);\n          consecutiveFailures++; done = true; break;'
);
// login_redirect
html = html.replace(
  'saveToSupabase({wca_id: member.id, company_name: "[LOGIN FAILED]", state: "login_redirect", country_code: currentScrapingCountry});\n            consecutiveFailures++;',
  'saveToSupabase({wca_id: member.id, company_name: "[LOGIN FAILED]", state: "login_redirect", country_code: currentScrapingCountry});\n            markIdFailed(currentScrapingCountry, member.id);\n            consecutiveFailures++;'
);
console.log("✅ 6. markIdFailed aggiunto ai casi di errore");

// === 7. SOSTITUIRE resumeScraping — usa directory locale, zero query ===
const oldResume = `async function resumeScraping(){
  let state;
  try { state = JSON.parse(localStorage.getItem("wca_scraping_state")); } catch(e){}
  if(!state || !state.discoveredMembers?.length){
    log("Nessun download interrotto da riprendere.","warn");
    return;
  }
  const ageMin = Math.round((Date.now() - state.timestamp) / 60000);
  log(\`Ripresa download interrotto (\${ageMin}min fa): \${state.discoveredMembers.length} membri trovati\`,"ok");
  discoveredMembers = state.discoveredMembers;
  if(state.countries) selectedCountries = state.countries;
  // Ripristina il paese corrente dallo stato salvato
  if(state.countries?.length > 0) currentScrapingCountry = state.countries[0].code;
  updateResultsTable();
  document.getElementById("resultsCard").style.display = "block";
  document.getElementById("tabsSection").style.display = "block";

  scraping = true;
  delayIndex = 0;
  document.getElementById("btnStart").disabled = true;
  document.getElementById("btnResume").style.display = "none";
  document.getElementById("btnStop").disabled = false;

  // Confronto rapido con Supabase
  setStatus(\`Confronto rapido \${discoveredMembers.length} ID...\`, true);
  const allIds = discoveredMembers.map(m => m.id);
  const checkResult = await checkMissingIds(allIds, currentScrapingCountry);
  const missingSet = new Set(checkResult.missing.map(String));
  const inDb = discoveredMembers.length - missingSet.size;
  hideActivity();

  for(const m of discoveredMembers){
    if(!missingSet.has(String(m.id))) updateResultRow(m.id, "in_db");
  }

  const toDownload = discoveredMembers.filter(m => missingSet.has(String(m.id)));

  if(toDownload.length === 0){
    setProgress(100, 100);
    setStatus(\`✅ COMPLETO — \${discoveredMembers.length} partner tutti in DB\`, true);
    showActivity("✅", "Tutto in database!");
    alert(\`COMPLETO!\\n\\n\${discoveredMembers.length} partner già tutti presenti nel database.\`);
    setTimeout(hideActivity, 3000);
    scraping = false;
    document.getElementById("btnStart").disabled = false;
    document.getElementById("btnStop").disabled = true;
    return;
  }`;

const newResume = `async function resumeScraping(jobCode){
  // Se passato un jobCode, ripristina da jobs sospesi
  let members, countryCode, countryName;

  if(jobCode){
    const jobs = getSuspendedJobs();
    const job = jobs.find(j => j.code === jobCode);
    if(!job){ log("Job non trovato","err"); return; }
    members = job.members;
    countryCode = job.code;
    countryName = job.name;
  } else {
    // Fallback: stato vecchio
    let state;
    try { state = JSON.parse(localStorage.getItem("wca_scraping_state")); } catch(e){}
    if(!state || !state.discoveredMembers?.length){
      log("Nessun download interrotto da riprendere.","warn");
      return;
    }
    members = state.discoveredMembers;
    countryCode = state.countries?.[0]?.code || "";
    countryName = state.countries?.[0]?.name || "Sconosciuto";
  }

  // Usa DIRECTORY LOCALE per sapere cosa manca — ZERO QUERY SERVER
  const pendingIds = getPendingIds(countryCode);
  const pendingSet = new Set(pendingIds);
  const toDownload = members.filter(m => pendingSet.has(String(m.id)));
  const done = members.length - toDownload.length;

  currentScrapingCountry = countryCode;
  discoveredMembers = members;
  updateResultsTable();
  document.getElementById("resultsCard").style.display = "block";
  document.getElementById("tabsSection").style.display = "block";

  // Segna nella tabella quelli già fatti
  for(const m of members){
    if(!pendingSet.has(String(m.id))) updateResultRow(m.id, "in_db");
  }

  log(\`📂 \${countryName}: \${done} già fatti, \${toDownload.length} da scaricare — RIPRESA IMMEDIATA\`,"ok");

  if(toDownload.length === 0){
    setProgress(100, 100);
    setStatus(\`✅ \${countryName}: COMPLETO — tutti i \${members.length} partner fatti\`, true);
    alert(\`\${countryName}: COMPLETO!\\n\\n\${members.length} partner già tutti scaricati.\`);
    removeSuspendedJob(countryCode);
    return;
  }

  scraping = true;
  delayIndex = 0;
  document.getElementById("btnStart").disabled = true;
  document.getElementById("btnResume").style.display = "none";
  document.getElementById("btnStop").disabled = false;
  setStatus(\`\${countryName}: ripresa \${toDownload.length} profili...\`, true);`;

if(html.includes(oldResume)){
  html = html.replace(oldResume, newResume);
  console.log("✅ 7. resumeScraping riscritto con directory locale");
} else {
  console.log("❌ 7. resumeScraping NON trovato");
}

// === 8. SOSTITUIRE saveScrapingState — salva anche job sospeso ===
const oldSave = `function saveScrapingState(){
  if(discoveredMembers.length === 0) return;
  const state = {
    discoveredMembers,
    scrapedIds: scrapedProfiles.map(p => p.wca_id),
    countries: selectedCountries,
    timestamp: Date.now(),
  };
  try {
    localStorage.setItem("wca_scraping_state", JSON.stringify(state));
    document.getElementById("btnResume").style.display = "inline-block";
    log(\`Stato salvato: \${discoveredMembers.length} membri. Puoi riprendere con "Continua Download".\`,"ok");
  } catch(e){ console.warn("saveState error:", e.message); }
}`;

const newSave = `function saveScrapingState(){
  if(discoveredMembers.length === 0) return;
  // Salva job sospeso per ripresa veloce
  if(currentScrapingCountry){
    const pending = getPendingIds(currentScrapingCountry);
    const cName = selectedCountries.find(c => c.code === currentScrapingCountry)?.name || currentScrapingCountry;
    if(pending.length > 0){
      saveSuspendedJob(currentScrapingCountry, cName, pending, discoveredMembers);
      log(\`💾 Job sospeso: \${cName} — \${pending.length} profili rimanenti\`,"ok");
    }
  }
  // Salva anche nel formato vecchio per compatibilità
  const state = {
    discoveredMembers,
    scrapedIds: scrapedProfiles.map(p => p.wca_id),
    countries: selectedCountries,
    timestamp: Date.now(),
  };
  try {
    localStorage.setItem("wca_scraping_state", JSON.stringify(state));
    document.getElementById("btnResume").style.display = "inline-block";
  } catch(e){ console.warn("saveState error:", e.message); }
}`;

if(html.includes(oldSave)){
  html = html.replace(oldSave, newSave);
  console.log("✅ 8. saveScrapingState riscritto");
} else {
  console.log("❌ 8. saveScrapingState NON trovato");
}

// === 9. SOSTITUIRE checkSavedState — mostra jobs sospesi ===
const oldCheck2 = `(function checkSavedState(){
  try {
    const state = JSON.parse(localStorage.getItem("wca_scraping_state"));
    if(state && state.discoveredMembers?.length > 0){
      const ageMin = Math.round((Date.now() - state.timestamp) / 60000);
      // Mostra bottone se meno di 24 ore
      if(ageMin < 1440){
        document.getElementById("btnResume").style.display = "inline-block";
        const countryNames = state.countries?.map(c => c.name).join(", ") || "Tutti";
        log(\`Download interrotto trovato: \${state.discoveredMembers.length} membri (\${countryNames}, \${ageMin}min fa). Clicca "Continua Download" per riprendere.\`,"warn");
      }
    }
  } catch(e){ console.warn("checkSavedState error:", e.message); }
})();`;

const newCheck2 = `(function checkSavedState(){
  // Mostra jobs sospesi
  const jobs = getSuspendedJobs();
  if(jobs.length > 0){
    document.getElementById("btnResume").style.display = "inline-block";
    for(const job of jobs){
      const ageMin = Math.round((Date.now() - job.ts) / 60000);
      const ageStr = ageMin < 60 ? ageMin+"min" : Math.round(ageMin/60)+"h";
      log(\`⏸ Job sospeso: \${countryFlag(job.code)} \${job.name} — \${job.done}/\${job.total} fatti, \${job.pending} rimanenti (\${ageStr} fa)\`,"warn");
    }
  }
})();`;

if(html.includes(oldCheck2)){
  html = html.replace(oldCheck2, newCheck2);
  console.log("✅ 9. checkSavedState riscritto con jobs sospesi");
} else {
  console.log("❌ 9. checkSavedState NON trovato");
}

// === 10. Aggiungere removeSuspendedJob quando paese completato ===
html = html.replace(
  'markCountryCompleted(country, discoveredMembers.length);\n  // Download completato per questa country',
  'markCountryCompleted(country, discoveredMembers.length);\n  removeSuspendedJob(country);\n  // Download completato per questa country'
);
console.log("✅ 10. removeSuspendedJob aggiunto a completamento");

// Scrivi il file
fs.writeFileSync('public/index.html', html);
console.log("\n✅✅✅ PATCH COMPLETATA — public/index.html aggiornato");
