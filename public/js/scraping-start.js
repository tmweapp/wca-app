// ═══════════════════════════════════════════════════════════════════════════════
// SCRAPING START/STOP CONTROLS — Launch scraping pipeline and manage execution
// ═══════════════════════════════════════════════════════════════════════════════

async function startScraping(){
  if(!sessionCookies){log("Devi prima fare il login","err");return;}

  // ═══ POPUP CONFERMA con selezione network ═══
  const shouldProceed = await showNetworkConfirmPopup("👤 DOWNLOAD PROFILI", "Scarica i profili dettagliati dei partner selezionati. Puoi filtrare per network oppure scaricare tutti.");
  if(!shouldProceed) return;

  const updateAddress = document.getElementById("chkUpdateAddress").checked;

  scraping = true;
  setDownloadMode("profiles");
  delayIndex = 0;
  resetScrapeStats();
  notificationCount = 0;
  updateBellBadge();
  document.getElementById("btnStart").disabled = true;
  document.getElementById("btnStop").disabled = false;
  document.getElementById("tabsSection").style.display = "block";
  document.body.classList.add("scraping-active");

  {
    // Filtro network opzionale — se nessuno selezionato, scarica tutti
    const selectedNetDomains = getSelectedNetworkObjects().map(n => n.domain);
    const filterByNetwork = selectedNetDomains.length > 0;
    if(filterByNetwork) log(`🔍 Filtro attivo: ${selectedNetDomains.length} network selezionati`,"ok");
    else log("🔍 Nessun filtro network — scarico tutti i partner","ok");

    const countries = selectedCountries.length > 0 ? [...selectedCountries] : [{code:"", name:"Tutti"}];
    let skippedAll = 0;

    for(let ci = 0; ci < countries.length && scraping; ci++){
      const c = countries[ci];

      // === CHECK RAPIDO: country già completata? Popup immediato ===
      if(c.code && isCountryCompleted(c.code)){
        const info = completedCountries[c.code];
        const ageH = Math.round((Date.now() - info.ts) / 3600000);
        const ageStr = ageH < 1 ? "meno di 1 ora fa" : ageH < 24 ? `${ageH} ore fa` : `${Math.round(ageH/24)} giorni fa`;

        if(updateAddress){
          if(!confirm(`${countryFlag(c.code)} ${c.name}: già completato (${info.count} partner, ${ageStr}).\n\nVuoi AGGIORNARE gli address di tutti i ${info.count} partner?`)){
            log(`⏭ ${c.name}: aggiornamento annullato dall'utente`,"warn");
            skippedAll++;
            continue;
          }
        } else {
          // Popup informativo: country completa, chiedi se vuole verificare o saltare
          const action = confirm(`${countryFlag(c.code)} ${c.name}: GIÀ COMPLETATO\n\n${info.count} partner scaricati (${ageStr}).\nTutti gli address sono già nel database.\n\nPremi OK per verificare comunque, Annulla per saltare.`);
          if(!action){
            log(`⏭ ${c.name} (${c.code}): completato (${info.count} partner) — saltato`,"ok");
            setStatus(`${c.name}: già completo — saltato`, true);
            skippedAll++;
            continue;
          }
          log(`🔄 ${c.name}: verifica richiesta dall'utente nonostante già completato`,"warn");
        }
      }

      if(countries.length > 1) log(`═══ PAESE ${ci+1}/${countries.length}: ${c.name} (${c.code}) ═══`,"ok");
      await scrapeDiscoverCountry(c.code, c.name, updateAddress, filterByNetwork ? selectedNetDomains : null);

      if(ci + 1 < countries.length && scraping){
        log(`⏸ Pausa ${COUNTRY_PAUSE}s prima del prossimo paese...`);
        await sleepWithActivity("⏳", `Pausa tra paesi — prossimo: ${countries[ci+1].name}`, COUNTRY_PAUSE * 1000);
      }
    }

    if(skippedAll === countries.length){
      log("✅ Tutti i paesi selezionati sono già completi! Nulla da fare.","ok");
      setStatus("✅ Tutti i paesi già completi!", true);
      showActivity("✅", "Tutti i paesi selezionati sono già completi nel database.");
      setTimeout(hideActivity, 5000);
    }
  }

  scraping = false;
  hideActiveNetwork();
  hideActiveCountry();
  hideDownloadRow();
  document.getElementById("btnStart").disabled = false;
  document.getElementById("btnStop").disabled = true;
  document.body.classList.remove("scraping-active");
  if(totalScraped > 0){
    setStatus(`Scraping completato! ${totalScraped} profili salvati.`, true);
    log(`Scraping terminato. Profili totali salvati: ${totalScraped}`, "ok");
    notifyEvent(`Scraping completato! ${totalScraped} profili salvati.`);
  }
}

function stopScraping(){
  scraping = false;
  setDownloadMode(null);
  hideActivity();
  hideActiveNetwork();
  hideActiveCountry();
  hideDownloadRow();
  document.getElementById("btnStop").disabled = true;
  document.getElementById("btnStart").disabled = false;
  document.body.classList.remove("scraping-active");
  setStatus("Scraping fermato.", true);
  log("Scraping fermato dall'utente.", "warn");
  saveScrapingState();
}

function resetCountryAndRestart(){
  const countries = selectedCountries.length > 0 ? [...selectedCountries] : [];
  if(countries.length === 0){
    alert("Seleziona almeno un paese da resettare.");
    return;
  }
  const names = countries.map(c => countryFlag(c.code) + " " + c.name).join(", ");
  if(!confirm(`Vuoi CANCELLARE tutti i dati locali e rieseguire da zero per:\n\n${names}\n\nQuesto cancellerà:\n- Directory locale (stato done/pending)\n- Cache discover\n- Job sospesi\n- Stato "completato"\n\nI dati già salvati su Supabase NON vengono toccati.\n\nConfermi?`)) return;

  for(const c of countries){
    // Cancella directory locale
    try { localStorage.removeItem("wca_dir_" + c.code); } catch(e){}
    // Cancella cache discover (tutti i formati possibili)
    Object.keys(discoverCache).forEach(k => { if(k.startsWith(c.code + "_")) delete discoverCache[k]; });
    // Cancella job sospeso
    removeSuspendedJob(c.code);
    // Cancella stato completato da localStorage (se esiste)
    try {
      const cc = JSON.parse(localStorage.getItem("wca_completed_countries") || "{}");
      if(cc[c.code]){ delete cc[c.code]; localStorage.setItem("wca_completed_countries", JSON.stringify(cc)); }
    } catch(e){}
    log(`🗑 ${c.name} (${c.code}): tutti i dati locali cancellati`,"warn");
  }

  alert(`Reset completato per ${countries.length} paes${countries.length > 1 ? "i" : "e"}.\n\nPremi "Avvia Scraping" per rieseguire da zero con il flusso multi-network.`);
  setStatus(`Reset completato — pronto per rieseguire ${names}`, true);
}

async function resetDatabase(){
  if(!confirm("⚠️ ATTENZIONE!\n\nQuesto cancellerà TUTTI i partner, job e sessioni dal database Supabase.\n\nSei sicuro di voler ricominciare da zero?")) return;
  if(!confirm("ULTIMA CONFERMA: tutti i dati saranno persi per sempre. Confermi?")) return;
  log("🗑 Reset database in corso...","warn");
  try {
    const resp = await fetch(API+"/api/reset", {
      method: "POST", headers: {"Content-Type":"application/json"},
      body: JSON.stringify({ confirm: "RESET_ALL" })
    });
    const data = await resp.json();
    if(data.success){
      log("✅ Database completamente svuotato!","ok");
      // Pulisci anche tutto il localStorage locale
      const keysToRemove = [];
      for(let i = 0; i < localStorage.length; i++){
        const k = localStorage.key(i);
        if(k && (k.startsWith("wca_") || k.startsWith("discover_"))) keysToRemove.push(k);
      }
      keysToRemove.forEach(k => localStorage.removeItem(k));
      // Reset contatori UI
      document.getElementById("headerTotalPartners").textContent = "0";
      document.getElementById("headerLimitedPartners").textContent = "0";
      scrapedProfiles = [];
      totalScraped = 0;
      discoveredMembers = [];
      selectedCountries = [];
      updateCountryDisplay();
      document.getElementById("tabsSection").style.display = "none";
      document.getElementById("resultsCard").style.display = "none";
      setStatus("Database azzerato — pronto per nuova scansione.", true);
      alert("Database svuotato! Puoi ricominciare da zero.");
    } else {
      log("⚠ Errore reset: " + (data.error||"sconosciuto"),"err");
      alert("Errore: " + (data.error||"sconosciuto"));
    }
  } catch(e){
    log("⚠ Errore reset: " + e.message,"err");
    alert("Errore di rete: " + e.message);
  }
}

// Salva lo stato del download interrotto in localStorage
function saveScrapingState(){
  if(discoveredMembers.length === 0) return;
  // Salva job sospeso per ripresa veloce
  if(currentScrapingCountry){
    const pending = getPendingIds(currentScrapingCountry);
    const cName = selectedCountries.find(c => c.code === currentScrapingCountry)?.name || currentScrapingCountry;
    if(pending.length > 0){
      saveSuspendedJob(currentScrapingCountry, cName, pending, discoveredMembers, currentNetworkMap);
      log(`💾 Job sospeso: ${cName} — ${pending.length} profili rimanenti`,"ok");
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
}

// Ripristina e continua il download interrotto
async function resumeScraping(jobCode){
  let members, countryCode, countryName, networkMap = {};

  if(jobCode){
    const jobs = getSuspendedJobs();
    const job = jobs.find(j => j.code === jobCode);
    if(!job){ log("Job non trovato","err"); return; }
    members = job.members;
    countryCode = job.code;
    countryName = job.name;
    networkMap = job.networkMap || {};
  } else {
    // Fallback: primo job sospeso o stato vecchio
    const jobs = getSuspendedJobs();
    if(jobs.length > 0){
      members = jobs[0].members;
      countryCode = jobs[0].code;
      countryName = jobs[0].name;
      networkMap = jobs[0].networkMap || {};
    } else {
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
  }
  currentNetworkMap = networkMap;

  // === USA DIRECTORY LOCALE — ZERO QUERY SERVER ===
  const pendingIds = getPendingIds(countryCode);
  const pendingSet = new Set(pendingIds);
  const toDownload = members.filter(m => pendingSet.has(String(m.id)));
  const done = members.length - toDownload.length;

  currentScrapingCountry = countryCode;
  setActiveCountry(countryCode, countryName);
  discoveredMembers = members;
  updateResultsTable();
  document.getElementById("resultsCard").style.display = "block";
  document.getElementById("tabsSection").style.display = "block";

  for(const m of members){
    if(!pendingSet.has(String(m.id))) updateResultRow(m.id, "in_db");
  }

  log(`📂 ${countryName}: ${done} già fatti, ${toDownload.length} da scaricare — RIPRESA IMMEDIATA`,"ok");

  if(toDownload.length === 0){
    setProgress(100, 100);
    setStatus(`✅ ${countryName}: COMPLETO — tutti i ${members.length} partner fatti`, true);
    alert(`${countryName}: COMPLETO!\n\n${members.length} partner già tutti scaricati.`);
    removeSuspendedJob(countryCode);
    return;
  }

  scraping = true;
  delayIndex = 0;
  document.getElementById("btnStart").disabled = true;
  document.getElementById("btnResume").style.display = "none";
  document.getElementById("btnStop").disabled = false;
  setStatus(`${countryName}: ripresa ${toDownload.length} profili...`, true);

  // Riprendi la Fase 2
  log(`═══ RIPRESA DOWNLOAD — ${toDownload.length} profili restanti ═══`);
  const total = toDownload.length;
  const MAX_TABS = 50;
  let consecutiveFailures = 0;
  const MAX_RETRIES = 2;

  for(let i=0; i<total && scraping; i++){
    const member = toDownload[i];

    const memberNets = networkMap[member.id]?.networks || [];
    const bestNetwork = memberNets.find(d => d !== "wcaworld.com") || memberNets[0] || null;
    const netLabel = bestNetwork ? bestNetwork.replace("www.","") : "wcaworld.com";
    setActiveNetwork(bestNetwork || "wcaworld.com", netLabel);

    setStatus(`Download ${i+1}/${total} — ID ${member.id} [${netLabel}]`, true);
    setProgress(i+1, total);
    showActivity("📥", `Download ${i+1}/${total} — ${member.name||member.id} da ${netLabel}`);
    let retries = 0;
    let done = false;
    while(retries <= MAX_RETRIES && scraping && !done){
      try {
        const resp = await fetch(API+"/api/scrape",{
          method:"POST",headers:{"Content-Type":"application/json"},
          body:JSON.stringify({wcaIds:[member.id], members: member.href ? [{id:member.id, href:member.href}] : [], networkDomain: bestNetwork})
        });
        const data = await resp.json();
        if(!data.success){
          if(data.error?.includes("SSO") && retries < MAX_RETRIES){ retries++; log(`SSO fallito, retry ${retries}...`,"warn"); await sleepWithActivity("🔄", `SSO fallito — retry ${retries}`, 15000); continue; }
          addFailedProfile(member.id); updateResultRow(member.id, "sso_failed");
          saveToSupabase({wca_id: member.id, company_name: "[SSO FAILED]", state: "sso_failed", country_code: currentScrapingCountry});
          markIdFailed(currentScrapingCountry, member.id);
          consecutiveFailures++; done = true; break;
        }
        const profile = data.results?.[0];
        if(profile?.state==="ok"){
          scrapedProfiles.unshift(profile);
          if(scrapedProfiles.length > MAX_TABS) scrapedProfiles.pop();
          addScrapedTab(profile, 0); trimScrapedTabs(MAX_TABS);
          showActivity("✅", `Salvato: ${profile.company_name} — ${profile.contacts?.length||0} contatti`);
          log(`✓ ${profile.company_name} (${profile.wca_id}) contatti:${profile.contacts?.length||0}`,"ok");
          saveToSupabase(profile); updateResultRow(profile.wca_id, "ok"); totalScraped++; consecutiveFailures = 0; done = true;
        } else if(profile?.state==="login_redirect"){
          if(retries < MAX_RETRIES){ retries++; log(`Sessione scaduta, retry ${retries}...`,"warn"); await sleepWithActivity("🔑", `Sessione scaduta — retry ${retries}`, 15000); continue; }
          addFailedProfile(member.id); updateResultRow(member.id, "login_redirect");
          saveToSupabase({wca_id: member.id, company_name: "[LOGIN FAILED]", state: "login_redirect", country_code: currentScrapingCountry});
          consecutiveFailures++; done = true;
        } else {
          if(profile?.state==="not_found") addFailedProfile(member.id);
          saveToSupabase({wca_id: member.id, company_name: "["+((profile?.state)||"ERROR")+"]", state: profile?.state||"error", country_code: currentScrapingCountry});
          updateResultRow(member.id, profile?.state||"error"); consecutiveFailures = 0; done = true;
        }
      } catch(e){ if(retries < MAX_RETRIES){ retries++; await sleepWithActivity("⚠️", "Errore rete — retry tra 10s", 10000); continue; } consecutiveFailures++; done = true; }
    }
    if(consecutiveFailures >= 5){ log("⛔ Troppi fallimenti — stop automatico","err"); scraping = false; break; }
    if(i + 1 < total && scraping){ const d = getNextDelay(); const nm = toDownload[i+1]; log(`⏱ Pausa ${(d/1000).toFixed(0)}s...`); await sleepWithActivity("⏳", `Pausa ${Math.round(d/1000)}s — prossimo: ${nm?.name||"ID "+nm?.id}`, d); }
  }
  hideActivity();

  scraping = false;
  hideActiveNetwork();
  hideActiveCountry();
  hideDownloadRow();
  document.getElementById("btnStart").disabled = false;
  document.getElementById("btnStop").disabled = true;
  // Aggiorna stato salvato
  saveScrapingState();
  log(`═══ DOWNLOAD COMPLETATO: ${totalScraped} salvati ═══`,"ok");
  setStatus("Download completato!", true);
}

function checkMissingIdsLocal(discoverIds, countryCode){
  const dir = getDirectory(countryCode);
  if(!dir){
    // Nessuna directory = primo scraping, tutti mancanti
    log(`📂 ${countryCode}: nessuna directory locale — primo scraping`,"ok");
    return { missing: discoverIds, found: 0 };
  }
  const missing = discoverIds.filter(id => dir.ids[String(id)] !== "done");
  const found = discoverIds.length - missing.length;
  log(`📂 Directory locale ${countryCode}: ${found} già fatti, ${missing.length} da fare`,"ok");
  return { missing, found };
}
