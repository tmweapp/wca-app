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
        } catch(e){}
      }
      skipped++;
      saveDirSyncState({ lastIndex: i, lastCountry: c.name, lastCode: c.code, synced, skipped, total, ts: Date.now() });
      updateDirHeaderCounts();
      // Pausa breve per non sovraccaricare
      if(i + 1 < orderedCountries.length && scraping) await sleep(500);
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

    // Pausa 3s tra paesi
    if(i + 1 < orderedCountries.length && scraping) await sleep(3000);
  }

  const wasInterrupted = !scraping && (synced + skipped) < (total - startIdx);

  if(wasInterrupted){
    dirSyncing = false;
    scraping = false;
    hideActiveCountry();
    hideDownloadRow();
    if(btn) btn.style.opacity = ".5";
    setStatus(`Directory interrotta — ${synced} sincronizzati. Riprendi quando vuoi.`, true);
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

      if(r + 1 < incomplete.length && scraping) await sleep(3000);
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
  hideActiveCountry();
  hideDownloadRow();
  if(btn) btn.style.opacity = ".5";

  setStatus(`Directory globale completata! ${synced} sincronizzati, ${skipped} in cache`, true);
  log(`✅ Directory globale completata: ${synced} paesi sincronizzati, ${skipped} già in cache`,"ok");
  updateDirHeaderCounts();
}

// ═══ RETRY SOLO PAESI INCOMPLETI (tasto 🔄 accanto alle bandiere) ═══
async function retryIncompleteDirectories(){
  if(dirSyncing){ log("Sync già in corso","warn"); return; }

  // Trova paesi incompleti (quelli con numeri negativi visibili)
  const allCountries = getAllCountryList();
  const nameMap = {};
  ALL_COUNTRIES.forEach(g => g.items.forEach(([code, name]) => { nameMap[code] = name; }));

  const incomplete = [];
  for(const c of allCountries){
    const dir = getDirectory(c.code);
    if(dir && Object.keys(dir.ids).length > 0){
      const pending = Object.values(dir.ids).filter(s => s === "pending").length;
      if(pending > 0) incomplete.push({ code: c.code, name: c.name, pending });
    }
  }

  if(incomplete.length === 0){
    log("✅ Nessun paese incompleto da recuperare","ok");
    return;
  }

  // Ordina per numero di pending decrescente
  incomplete.sort((a,b) => b.pending - a.pending);

  log(`🔄 Retry ${incomplete.length} paesi incompleti: ${incomplete.map(c => c.name+'(-'+c.pending+')').join(', ')}`,"warn");

  dirSyncing = true;
  scraping = true;
  const btn = document.getElementById("btnSyncDir");
  if(btn) btn.style.opacity = "1";
  const dlRow = document.getElementById("activeDownloadRow");
  if(dlRow) dlRow.style.display = "flex";

  let synced = 0;
  for(let i = 0; i < incomplete.length && scraping; i++){
    const c = incomplete[i];
    setActiveCountry(c.code, c.name);
    setStatus(`🔄 Retry ${i+1}/${incomplete.length}: ${c.name} (-${c.pending})`, true);
    setProgress(i+1, incomplete.length);

    // Forza re-download directory ignorando cache
    await discoverFastDirectory(c.code, c.name);
    synced++;

    updateDirHeaderCounts();
    if(i + 1 < incomplete.length && scraping) await sleep(3000);
  }

  dirSyncing = false;
  scraping = false;
  hideActiveCountry();
  hideDownloadRow();
  if(btn) btn.style.opacity = ".5";

  setStatus(`🔄 Retry completato: ${synced}/${incomplete.length} paesi riscaricati`, true);
  log(`✅ Retry completato: ${synced} paesi riscaricati`,"ok");
  updateDirHeaderCounts();
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
