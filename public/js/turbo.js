// ═══════════════════════════════════════════════════════════════════════════════
// TURBO SCRAPING — Fast profile download using Supabase data (skip discovery)
// • Skip Phase 1 Discovery (dati da Supabase)
// • Ogni profilo scaricato UNA sola volta dal miglior network
// • Se già scaricato in DB → skip
// • Nessun duplicato tra network
// ═══════════════════════════════════════════════════════════════════════════════

async function scrapeCountryTurbo(country, countryName, updateAddress = false){
  currentScrapingCountry = country;
  resetCompletedNetworks();
  hideCountryCompletion();
  setActiveCountry(country, countryName);
  const MAX_TABS = 50;
  const MAX_RETRIES = 2;
  let consecutiveFailures = 0;
  const doneIds = new Set();

  // Carica ID già scaricati dalla directory locale
  const existingDir = getDirectory(country);
  if(existingDir && !updateAddress){
    Object.entries(existingDir.ids).forEach(([id, status]) => { if(status === "done") doneIds.add(parseInt(id)); });
    if(doneIds.size > 0) log(`⚡ TURBO ${countryName}: ${doneIds.size} profili già nel DB — verranno saltati`,"ok");
  }

  // === HELPER: scarica un profilo da un network ===
  async function downloadProfileTurbo(member, networkDomain, networkLabel){
    let retries = 0;
    while(retries <= MAX_RETRIES && scraping){
      try {
        const resp = await fetch(API+"/api/scrape",{
          method:"POST",headers:{"Content-Type":"application/json"},
          body:JSON.stringify({wcaIds:[member.id], members: member.href ? [{id:member.id, href:member.href}] : [], networkDomain})
        });
        const data = await resp.json();
        if(!data.success){
          if(data.error && data.error.includes("SSO") && retries < MAX_RETRIES){
            retries++; await sleepWithActivity("🔄", `SSO retry ${retries}/${MAX_RETRIES}`, 15000); continue;
          }
          return { ok:false, error: data.error };
        }
        const profile = data.results?.[0];
        if(!profile) return { ok:false, error:"no_result" };
        if(profile.state === "ok"){
          scrapedProfiles.unshift(profile);
          if(scrapedProfiles.length > MAX_TABS) scrapedProfiles.pop();
          addScrapedTab(profile, 0);
          trimScrapedTabs(MAX_TABS);
          const limited = profile.access_limited ? " [LIMITATO]" : "";
          log(`⚡ ${profile.company_name} (${profile.wca_id}) contatti:${profile.contacts?.length||0}${limited} [${networkLabel}]`,"ok");
          saveToSupabase(profile);
          markIdDone(country, profile.wca_id);
          updateResultRow(profile.wca_id, "ok");
          totalScraped++;
          consecutiveFailures = 0;
          updateScrapeStats({ downloaded: scrapeStats.downloaded + 1 });
          return { ok:true, profile };
        } else if(profile.state === "login_redirect" && retries < MAX_RETRIES){
          retries++; await sleepWithActivity("🔑", `Sessione scaduta — retry ${retries}/${MAX_RETRIES}`, 15000); continue;
        }
        return { ok:false, state: profile.state };
      } catch(e){
        if(retries < MAX_RETRIES){ retries++; await sleepWithActivity("⚠️", `Errore rete — retry`, 10000); continue; }
        return { ok:false, error: e.message };
      }
    }
    return { ok:false, error:"stopped" };
  }

  // ═══════════════════════════════════════════════════════════════
  // TURBO: CARICA LISTA DA SUPABASE (skip Phase 1 Discovery)
  // ═══════════════════════════════════════════════════════════════
  log(`⚡ TURBO ${countryName}: leggo lista partner da Supabase...`,"ok");
  setStatus(`⚡ TURBO: Caricamento lista da Supabase...`, true);
  showActivity("⚡", `Carico lista ${countryName} da Supabase...`);

  const fromDb = await loadDirectoryFromSupabase(country);
  if(!fromDb || !fromDb.members || fromDb.members.length === 0){
    log(`⚠ TURBO ${countryName}: nessun dato in Supabase! Devi prima fare il sync directory.`,"err");
    hideActivity();
    return;
  }

  const allMembers = fromDb.members;
  log(`⚡ TURBO ${countryName}: ${allMembers.length} partner in Supabase — Phase 1 SALTATA`,"ok");

  // Popola tabella risultati
  for(const m of allMembers){
    if(!discoveredMembers.find(d => d.id === m.id)){
      discoveredMembers.push({id:m.id, name:m.name, networks:m.networks});
    }
  }
  document.getElementById("resultsCard").style.display = "block";
  updateResultsTable();

  // ═══════════════════════════════════════════════════════════════
  // TURBO: DOWNLOAD — solo profili mancanti, 1 volta, miglior network
  // ═══════════════════════════════════════════════════════════════
  const toDownload = updateAddress
    ? allMembers
    : allMembers.filter(m => !doneIds.has(m.id));

  const totalMembers = allMembers.length;
  const alreadyDone = totalMembers - toDownload.length;
  updateScrapeStats({ found: totalMembers, networkName: "TURBO", countryName, downloaded: 0, skipped: alreadyDone });
  notifyEvent(`⚡ TURBO ${countryName}: ${totalMembers} totali, ${toDownload.length} da scaricare`);
  refreshCountryCompletion();

  if(toDownload.length === 0){
    log(`⚡ TURBO ${countryName}: tutti i ${totalMembers} partner già nel DB!`,"ok");
    setStatus(`⚡ TURBO: ${countryName} completo — nulla da scaricare`, true);
    hideActivity();
    markCountryCompleted(country, doneIds.size);
    return;
  }

  log(`⚡ TURBO ${countryName}: ${toDownload.length} da scaricare (${alreadyDone} già nel DB)`,"ok");

  // Raggruppa per miglior network (evita duplicati)
  const byNetwork = {};
  for(const m of toDownload){
    let bestNet = "wcaworld.com";
    if(m.networks && m.networks.length > 0){
      const scannable = m.networks.find(n => {
        const net = ALL_NETWORKS.find(a => a.domain === n);
        return net && net.siteId > 0;
      });
      bestNet = scannable || m.networks[0] || "wcaworld.com";
    }
    if(!byNetwork[bestNet]) byNetwork[bestNet] = [];
    byNetwork[bestNet].push(m);
  }

  let globalIdx = 0;
  const networkDomains = Object.keys(byNetwork);
  for(let ni = 0; ni < networkDomains.length && scraping; ni++){
    const netDomain = networkDomains[ni];
    const netMembers = byNetwork[netDomain];
    const net = ALL_NETWORKS.find(n => n.domain === netDomain);
    const netName = net?.name || netDomain;

    setActiveNetwork(netDomain, netName);
    log(`⚡ TURBO [${netName}]: ${netMembers.length} profili`,"ok");

    for(let i = 0; i < netMembers.length && scraping; i++){
      const member = netMembers[i];
      if(doneIds.has(member.id) && !updateAddress){ globalIdx++; continue; }

      globalIdx++;
      setStatus(`⚡ TURBO [${netName}] ${globalIdx}/${toDownload.length} — ${member.name||member.id}`, true);
      setProgress(globalIdx, toDownload.length);
      showActivity("⚡", `TURBO ${netName} ${globalIdx}/${toDownload.length} — ${member.name||member.id}`);

      const result = await downloadProfileTurbo(member, netDomain, netName);
      if(result.ok){
        doneIds.add(member.id);
      } else {
        // Prova network alternativi del membro
        const altNets = (member.networks || []).filter(d => d !== netDomain);
        let rescued = false;
        for(const altDomain of altNets){
          if(!scraping) break;
          const altNet = ALL_NETWORKS.find(n => n.domain === altDomain);
          const altName = altNet?.name || altDomain;
          const altResult = await downloadProfileTurbo(member, altDomain, altName);
          if(altResult.ok){ doneIds.add(member.id); rescued = true; break; }
        }
        if(!rescued){
          consecutiveFailures++;
          updateScrapeStats({ skipped: scrapeStats.skipped + 1 });
        }
      }

      if(consecutiveFailures >= 5){
        log(`⛔ TURBO: troppi fallimenti su ${netName} — passo al prossimo`,"err");
        consecutiveFailures = 0;
        break;
      }

      if(i + 1 < netMembers.length && scraping){
        const nextDelay = getNextDelay();
        await sleepWithActivity("⏳", `Pausa ${Math.round(nextDelay/1000)}s — TURBO ${netName}`, nextDelay);
      }
    }

    log(`⚡ TURBO ${netName} completato`,"ok");
    addCompletedNetworkLogo(netDomain, netName);
  }

  hideActivity();
  log(`═══ ⚡ TURBO ${countryName} COMPLETATO: ${doneIds.size}/${totalMembers} profili ═══`,"ok");
  markCountryCompleted(country, doneIds.size);
  removeSuspendedJob(country);
  saveScrapingState();
}

// ═══ START TURBO — avviato dal bottone ⚡ in home ═══
async function startTurbo(){
  if(!sessionCookies){log("Devi prima fare il login","err");return;}

  const countries = selectedCountries.length > 0 ? [...selectedCountries] : [];
  if(countries.length === 0){
    log("⚠ Seleziona almeno un paese prima di usare Turbo","warn");
    return;
  }

  const updateAddress = document.getElementById("chkUpdateAddress").checked;

  scraping = true;
  delayIndex = 0;
  resetScrapeStats();
  notificationCount = 0;
  updateBellBadge();
  document.getElementById("btnStart").disabled = true;
  document.getElementById("btnStop").disabled = false;
  document.getElementById("tabsSection").style.display = "block";
  document.body.classList.add("scraping-active");

  log("⚡ ═══ TURBO ATTIVATO ═══","ok");
  log("⚡ Dati da Supabase → skip discovery → ogni profilo 1 volta → no duplicati","ok");

  for(let ci = 0; ci < countries.length && scraping; ci++){
    const c = countries[ci];

    if(c.code && isCountryCompleted(c.code) && !updateAddress){
      const info = completedCountries[c.code];
      const ageH = Math.round((Date.now() - info.ts) / 3600000);
      const ageStr = ageH < 1 ? "meno di 1 ora fa" : ageH < 24 ? `${ageH} ore fa` : `${Math.round(ageH/24)} giorni fa`;
      const action = confirm(`⚡ TURBO — ${countryFlag(c.code)} ${c.name}: GIÀ COMPLETATO\n\n${info.count} partner (${ageStr}).\nPremi OK per verificare, Annulla per saltare.`);
      if(!action){
        log(`⏭ TURBO ${c.name}: saltato`,"ok");
        continue;
      }
    }

    if(countries.length > 1) log(`⚡ ═══ TURBO ${ci+1}/${countries.length}: ${c.name} ═══`,"ok");
    await scrapeCountryTurbo(c.code, c.name, updateAddress);

    if(ci + 1 < countries.length && scraping){
      await sleepWithActivity("⏳", `Pausa tra paesi — prossimo: ${countries[ci+1].name}`, COUNTRY_PAUSE * 1000);
    }
  }

  scraping = false;
  hideActiveNetwork();
  hideActiveCountry();
  hideDownloadRow();
  document.getElementById("btnStart").disabled = false;
  document.getElementById("btnStop").disabled = true;
  document.body.classList.remove("scraping-active");
  log("⚡ ═══ TURBO COMPLETATO ═══","ok");
}
