// WCA — Directory Sync

// ═══════════════════════════════════════════════════════
// === SYNC DIRECTORY GLOBALE — con stop, resume, persistenza ===
// ═══════════════════════════════════════════════════════
let dirSyncing = false;

function getAllCountryList(){
  const list = [];
  for(const group of ALL_COUNTRIES){
    for(const [code, name] of group.items) list.push({code, name});
  }
  return list;
}

// Stato sync persistente in localStorage
function getDirSyncState(){
  try { return JSON.parse(localStorage.getItem("wca_dir_sync_state")||"null"); } catch(e){ return null; }
}

function saveDirSyncState(state){
  try { localStorage.setItem("wca_dir_sync_state", JSON.stringify(state)); } catch(e){}
}

function clearDirSyncState(){
  try { localStorage.removeItem("wca_dir_sync_state"); } catch(e){}
}

async function syncAllDirectories(forceResume){
  if(dirSyncing){ log("Sync directory già in corso","warn"); return; }

  const allCountries = getAllCountryList();
  const selectedCodes = new Set(selectedCountries.map(c => c.code));

  // Ordine: selezionati prima, poi tutti gli altri
  const orderedCountries = [
    ...selectedCountries,
    ...allCountries.filter(c => !selectedCodes.has(c.code))
  ];
  const total = orderedCountries.length;

  // Controlla se c'è un sync interrotto da riprendere
  let startIdx = 0;
  const savedState = getDirSyncState();
  if(savedState && !forceResume){
    const remaining = total - savedState.lastIndex - 1;
    if(remaining > 0 && savedState.lastIndex > 0){
      if(confirm(`📂 Sync directory interrotta\n\nCompletati ${savedState.lastIndex+1}/${total} paesi.\nUltimo: ${savedState.lastCountry}\n\nVuoi RIPRENDERE da dove ti eri fermato?\n(OK = riprendi, Annulla = ricomincia da zero)`)){
        startIdx = savedState.lastIndex + 1;
        log(`📂 Ripresa sync da paese ${startIdx+1}/${total} (${orderedCountries[startIdx]?.name})...`,"ok");
      } else {
        clearDirSyncState();
      }
    }
  } else if(forceResume && savedState){
    startIdx = savedState.lastIndex + 1;
  }

  if(startIdx === 0 && !forceResume){
    if(!confirm(`📂 DIRECTORY GLOBALE\n\nScarica la directory di TUTTI i ${total} paesi.\nI paesi già in cache (<24h) vengono saltati.\nI ${selectedCountries.length} selezionati hanno priorità.\n\nPuoi INTERROMPERE in qualsiasi momento e riprendere dopo.\n\nProcedere?`)) return;
  }

  dirSyncing = true;
  scraping = true;
  setDownloadMode("directory");
  const btn = document.getElementById("btnSyncDir");
  if(btn) btn.style.opacity = "1";
  const dlRow = document.getElementById("activeDownloadRow");
  if(dlRow) dlRow.style.display = "flex";

  let synced = 0, skipped = 0;
  log(`📂 Sync directory GLOBALE: ${total} paesi (da ${startIdx+1})...`,"ok");

  for(let i = startIdx; i < orderedCountries.length && scraping; i++){
    const c = orderedCountries[i];

    // Se già in cache recente (< 24h), non ri-scarica ma pusha comunque in Supabase
    const age = getFullDirAge(c.code);
    if(age < 24){
      const cachedDir = getFullDirectory(c.code);
      if(cachedDir && cachedDir.members && cachedDir.members.length > 0){
        try {
          const sr = await fetch(API+"/api/save-directory",{
            method:"POST",headers:{"Content-Type":"application/json"},
            body:JSON.stringify({ countryCode: c.code, members: cachedDir.members })
          });
          const sd = await sr.json();
          if(sd.success){
            log(`💾 DB: ${c.name} — ${sd.saved} salvati (da cache)`,"ok");
            const stats = await refreshDbCounters();
            showDbFlash(c.code, sd.saved, stats || 0);
          }
        } catch(e){ console.warn("dirSync cache push error:", c.code, e.message); }
      }
      skipped++;
      saveDirSyncState({ lastIndex: i, lastCountry: c.name, lastCode: c.code, synced, skipped, total, ts: Date.now() });
      updateDirHeaderCounts();
      continue;
    }

    setActiveCountry(c.code, c.name);
    setStatus(`📂 Directory ${i+1}/${total}: ${c.name}${selectedCodes.has(c.code) ? ' ★' : ''}`, true);
    setProgress(i+1, total);

    await discoverFastDirectory(c.code, c.name);
    synced++;

    // Salva stato dopo ogni paese (per resume)
    saveDirSyncState({ lastIndex: i, lastCountry: c.name, lastCode: c.code, synced, skipped, total, ts: Date.now() });

    // Aggiorna contatori header
    updateDirHeaderCounts();

  }

  const wasInterrupted = !scraping && (synced + skipped) < (total - startIdx);

  if(wasInterrupted){
    dirSyncing = false;
    scraping = false;
    setDownloadMode(null);
    hideActiveCountry();
    hideDownloadRow();
    if(btn) btn.style.opacity = ".5";
    setStatus(`📂 Directory interrotta — ${synced} sincronizzati. Riprendi quando vuoi.`, true);
    log(`⏸ Sync interrotta: ${synced} sincronizzati, ${skipped} in cache. Usa il tasto Directory per riprendere.`,"warn");
    updateDirHeaderCounts();
    return;
  }

  // ═══ VERIFICA FINALE: controlla paesi incompleti e riscarica ═══
  const incomplete = [];
  for(const c of orderedCountries){
    const dir = getFullDirectory(c.code);
    if(!dir || !dir.members || dir.members.length === 0){
      incomplete.push(c);
    }
  }

  if(incomplete.length > 0 && scraping){
    log(`🔄 Verifica: ${incomplete.length} paesi incompleti. Retry automatico...`,"warn");
    for(let r = 0; r < incomplete.length && scraping; r++){
      const c = incomplete[r];
      setActiveCountry(c.code, c.name);
      setStatus(`🔄 Retry ${r+1}/${incomplete.length}: ${c.name}`, true);
      setProgress(r+1, incomplete.length);

      await discoverFastDirectory(c.code, c.name);
      synced++;

      saveDirSyncState({ lastIndex: total - 1, lastCountry: c.name, lastCode: c.code, synced, skipped, total, ts: Date.now() });
      updateDirHeaderCounts();

    }

    // Secondo controllo: quanti ancora incompleti?
    let stillMissing = 0;
    for(const c of incomplete){
      const dir = getFullDirectory(c.code);
      if(!dir || !dir.members || dir.members.length === 0) stillMissing++;
    }
    if(stillMissing > 0){
      log(`⚠ ${stillMissing} paesi ancora senza dati dopo retry`,"warn");
    } else {
      log(`✅ Tutti i paesi incompleti recuperati!`,"ok");
    }
  }

  clearDirSyncState();
  dirSyncing = false;
  scraping = false;
  setDownloadMode(null);
  hideActiveCountry();
  hideDownloadRow();
  if(btn) btn.style.opacity = ".5";

  setStatus(`📂 Directory completata! ${synced} sincronizzati, ${skipped} in cache`, true);
  log(`✅ Directory globale completata: ${synced} paesi sincronizzati, ${skipped} già in cache`,"ok");
  updateDirHeaderCounts();
}

// ═══ RETRY PROFILI — confronta wca_directory vs wca_profiles, scarica solo i mancanti ═══
async function retryIncompleteDirectories(){
  if(dirSyncing){ setStatus("⚠ Operazione già in corso", true); return; }
  if(!sessionCookies){ log("⚠ Devi prima fare il login","err"); return; }

  setStatus("🔍 Confronto directory vs profili su Supabase...", true);
  log("🔍 Carico conteggi directory e profili da Supabase...","ok");

  // 1. Carica conteggi directory (wca_directory) per paese
  let dirByCountry = {};
  try {
    const resp = await fetch(API + "/api/load-directory?mode=stats");
    const data = await resp.json();
    if(!data.success){ setStatus("⚠ Errore caricamento directory", true); return; }
    dirByCountry = data.byCountry || {};
  } catch(e){ setStatus("⚠ Errore: " + e.message, true); return; }

  // 2. Carica conteggi profili (wca_profiles) per paese
  let profByCountry = {};
  try {
    const resp = await fetch(API + "/api/partners?action=country_counts");
    const data = await resp.json();
    if(data.success) profByCountry = data.counts || {};
  } catch(e){ log("⚠ Errore conteggi profili: " + e.message,"warn"); }

  // 3. Confronta: paesi dove directory > profili = profili mancanti
  const toRetry = [];
  for(const [code, dirCount] of Object.entries(dirByCountry)){
    const profCount = profByCountry[code] || 0;
    const missing = dirCount - profCount;
    if(missing > 0){
      toRetry.push({ code, dirCount, profCount, missing });
    }
  }

  if(toRetry.length === 0){
    const totalDir = Object.values(dirByCountry).reduce((s,v) => s+v, 0);
    const totalProf = Object.values(profByCountry).reduce((s,v) => s+v, 0);
    setStatus(`✅ Tutti i profili scaricati! Directory: ${totalDir.toLocaleString()}, Profili: ${totalProf.toLocaleString()}`, true);
    log("✅ Nessun paese con profili mancanti — tutto completo!","ok");
    return;
  }

  toRetry.sort((a,b) => b.missing - a.missing);
  const totalMissing = toRetry.reduce((s, c) => s + c.missing, 0);

  // 4. Mostra popup conferma con lista paesi incompleti
  const listHtml = toRetry.map(c =>
    `${countryFlag(c.code)} <b>${c.code}</b>: ${c.profCount}/${c.dirCount} profili (mancano <b>${c.missing}</b>)`
  ).join("<br>");

  const popupOk = await showNetworkConfirmPopup(
    `👤 RETRY PROFILI MANCANTI`,
    `<b>${toRetry.length} paesi</b> con <b>${totalMissing.toLocaleString()}</b> profili da scaricare:<br><br>${listHtml}<br><br>Vuoi avviare il download dei profili mancanti?`
  );
  if(!popupOk) return;

  log(`👤 RETRY: ${toRetry.length} paesi, ${totalMissing.toLocaleString()} profili mancanti`,"warn");

  // 5. Per ogni paese incompleto, lancia scrapeDiscoverCountry()
  //    (che ora fa il check Supabase e salta automaticamente gli ID già presenti)
  scraping = true;
  setDownloadMode("profiles");
  const dlRow = document.getElementById("activeDownloadRow");
  if(dlRow) dlRow.style.display = "flex";

  // Imposta selectedCountries per il pipeline
  selectedCountries = toRetry.map(c => ({ code: c.code, name: c.code }));

  const selectedNetDomains = getSelectedNetworkObjects().map(n => n.domain);
  const networkFilter = selectedNetDomains.length > 0 ? selectedNetDomains : null;

  for(let i = 0; i < toRetry.length && scraping; i++){
    const c = toRetry[i];
    log(`═══ RETRY ${i+1}/${toRetry.length}: ${countryFlag(c.code)} ${c.code} — ${c.missing} mancanti ═══`,"warn");
    setStatus(`RETRY ${i+1}/${toRetry.length}: ${c.code} (${c.missing} mancanti)`, true);

    await scrapeDiscoverCountry(c.code, c.code, false, networkFilter);

    // Pausa tra paesi
    if(i + 1 < toRetry.length && scraping){
      const pause = typeof COUNTRY_PAUSE !== 'undefined' ? COUNTRY_PAUSE : 10000;
      await sleepWithActivity("🌍", `Pausa tra paesi — prossimo: ${toRetry[i+1].code}`, pause);
    }
  }

  scraping = false;
  setDownloadMode(null);
  hideActiveCountry();
  hideDownloadRow();
  hideActivity();

  setStatus(`✅ Retry completato: ${toRetry.length} paesi elaborati`, true);
  log(`✅ RETRY COMPLETATO: ${toRetry.length} paesi, ${totalMissing} profili mancanti elaborati`,"ok");
  loadHeaderCounts();
}

function stopDirSync(){
  if(dirSyncing){
    scraping = false;
    log("⏹ Sync directory fermata dall'utente","warn");
  }
}

function toggleDirSync(){
  if(dirSyncing){
    stopDirSync();
    // Cambia icona in download
    const icon = document.getElementById("syncDirIcon");
    if(icon) icon.innerHTML = '<path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>';
    const btn = document.getElementById("btnSyncDir");
    if(btn){ btn.style.borderColor = "rgba(255,255,255,0.12)"; btn.style.background = "rgba(255,255,255,0.02)"; }
  } else {
    // Controlla se c'è sync interrotto
    const saved = getDirSyncState();
    if(saved && saved.lastIndex > 0){
      syncAllDirectories(false); // chiederà se riprendere
    } else {
      syncAllDirectories(false);
    }
    // Cambia icona in stop
    setTimeout(() => {
      if(dirSyncing){
        const icon = document.getElementById("syncDirIcon");
        if(icon) icon.innerHTML = '<rect x="6" y="6" width="12" height="12" rx="2" fill="#0ea5e9" opacity=".15"/><rect x="6" y="6" width="12" height="12" rx="2"/>';
        const btn = document.getElementById("btnSyncDir");
        if(btn){ btn.style.borderColor = "rgba(14,165,233,0.3)"; btn.style.background = "rgba(14,165,233,0.06)"; }
      }
    }, 500);
  }
}


// === AGGIORNA NETWORK per paesi selezionati ===
async function updateNetworksForCountries(){
  const countries = selectedCountries.length > 0 ? [...selectedCountries] : [];
  if(countries.length === 0){ alert("Seleziona almeno un paese!"); return; }
  const shouldProceed = await showNetworkConfirmPopup("🔄 AGGIORNA NETWORK", "Scansiona i network WCA per " + countries.map(c=>c.name).join(", ") + ". Puoi filtrare per network specifici.");
  if(!shouldProceed) return;

  dirSyncing = true; scraping = true;
  setDownloadMode("network");
  const dlRow = document.getElementById("activeDownloadRow");
  if(dlRow) dlRow.style.display = "flex";
  log("=== AGGIORNAMENTO NETWORK: " + countries.length + " paesi ===","ok");

  for(let ci = 0; ci < countries.length && scraping; ci++){
    const c = countries[ci];
    setActiveCountry(c.code, c.name);
    setStatus("Aggiornamento network " + (ci+1) + "/" + countries.length + ": " + c.name, true);
    setProgress(ci+1, countries.length);
    log("" + c.name + ": discovery per-network...","ok");
    const result = await discoverFullDirectory(c.code, c.name, true);
    if(result && result.members){
      const withNets = result.members.filter(m => m.networks && m.networks.length > 0).length;
      log(c.name + ": " + result.members.length + " partner, " + withNets + " con network, " + result.members.filter(m=>m.scrape_url).length + " con scrape_url","ok");
    }
  }

  dirSyncing = false; scraping = false;
  setDownloadMode(null);
  hideActiveCountry(); hideDownloadRow();
  setStatus("🔄 Network aggiornati per " + countries.length + " paesi!", true);
  log("=== AGGIORNAMENTO NETWORK COMPLETATO ===","ok");
  updateDirHeaderCounts();
}
