// ═══════════════════════════════════════════════════════════════════════════════
// SCRAPING BY NETWORK — Discover and download by selected networks per country
// Modalità che permette di scegliere specifici network e scaricare paese per paese
// ═══════════════════════════════════════════════════════════════════════════════

async function scrapeByNetwork(){
  const allCountriesMode = document.getElementById("chkAllCountries")?.checked;
  const countries = allCountriesMode ? getAllCountriesList() : [...selectedCountries];
  if(countries.length === 0){
    alert("Seleziona almeno un paese oppure attiva 'Tutti i Paesi'!");
    scraping = false;
    document.getElementById("btnStart").disabled = false;
    document.getElementById("btnStop").disabled = true;
    document.body.classList.remove("scraping-active");
    return;
  }

  // Obbliga selezione di almeno un network
  const selectedNets = getSelectedNetworkObjects();
  if(selectedNets.length === 0){
    alert("Seleziona almeno un network!");
    openNetworkPopup();
    scraping = false;
    document.getElementById("btnStart").disabled = false;
    document.getElementById("btnStop").disabled = true;
    document.body.classList.remove("scraping-active");
    return;
  }
  const networksToScrape = selectedNets;
  const MAX_TABS = 50;
  const MAX_RETRIES = 2;

  log(`═══ MODALITÀ NETWORK+: ${networksToScrape.length} network × ${countries.length} paesi (con fallback + enrichment) ═══`);
  log(`Network: ${networksToScrape.map(n=>n.name).join(", ")}`);
  log(`Paesi: ${countries.map(c=>c.name).join(", ")}`);

  // === HELPER: scarica un profilo con SSO retry (come discovery) ===
  async function downloadProfileNet(member, networkDomain, networkLabel, countryCode){
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
            retries++;
            await sleepWithActivity("🔄", `SSO retry ${retries}/${MAX_RETRIES}`, 15000);
            continue;
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
          log(`✓ ${profile.company_name} (${profile.wca_id}) contatti:${profile.contacts?.length||0}${limited} [${networkLabel}]`,"ok");
          await saveToSupabase(profile);
          markIdDone(countryCode, profile.wca_id);
          updateResultRow(profile.wca_id, "ok");
          totalScraped++;
          updateScrapeStats({ downloaded: scrapeStats.downloaded + 1 });
          return { ok:true, profile };
        } else if(profile.state === "login_redirect" && retries < MAX_RETRIES){
          retries++;
          await sleepWithActivity("🔑", `Sessione scaduta — retry ${retries}/${MAX_RETRIES}`, 15000);
          continue;
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
  // LOOP PRINCIPALE: per ogni PAESE → tutti i network → fallback → enrichment
  // ═══════════════════════════════════════════════════════════════
  for(let ci = 0; ci < countries.length && scraping; ci++){
    const c = countries[ci];
    currentScrapingCountry = c.code;
    resetCompletedNetworks();
    hideCountryCompletion();
    setActiveCountry(c.code, c.name);
    log(`\n═══ PAESE ${ci+1}/${countries.length}: ${c.name} (${c.code}) ═══`,"ok");

    const doneIds = new Set(); // ID scaricati con successo per questo paese
    const memberNetworkMap = {}; // id → [domain1, domain2...]
    let consecutiveFailures = 0;

    // Carica ID già fatti dalla directory locale
    const existingDir = getDirectory(c.code);
    if(existingDir){
      Object.entries(existingDir.ids).forEach(([id, status]) => { if(status === "done") doneIds.add(parseInt(id)); });
      if(doneIds.size > 0) log(`📂 ${c.name}: ${doneIds.size} profili già completati in directory locale`,"ok");
    }

    // ═══ CHECK SUPABASE — carica wca_id già presenti in wca_profiles ═══
    try {
      const dbResp = await fetch(API+"/api/partners?action=existing_ids&country="+encodeURIComponent(c.code));
      const dbData = await dbResp.json();
      if(dbData.success && dbData.ids){
        let newFromDb = 0;
        for(const id of dbData.ids){
          if(!doneIds.has(id)){ doneIds.add(id); newFromDb++; }
        }
        if(newFromDb > 0) log(`🗄️ ${c.name}: +${newFromDb} profili già in Supabase (totale skip: ${doneIds.size})`,"ok");
      }
    } catch(e){ log(`⚠ Check Supabase: ${e.message}`,"warn"); }

    // Pausa tra paesi (tranne il primo)
    if(ci > 0 && scraping){
      const delay = getNextDelay();
      log(`⏱ Pausa ${(delay/1000).toFixed(0)}s prima di ${c.name}...`);
      await sleepWithActivity("⏳", `Pausa — prossimo paese: ${c.name}`, delay);
    }
    if(!scraping) break;

    // ─── FASE 1: DIRECTORY CACHE — nessun discover, usa dati già scaricati ───
    const selectedNetDomains = networksToScrape.map(n => n.domain);
    let cachedDir = getFullDirectory(c.code);
    let dirAge = getFullDirAge(c.code);
    // Se non in localStorage, prova Supabase
    if(!cachedDir || dirAge >= 24){
      const fromDb = await loadDirectoryFromSupabase(c.code);
      if(fromDb){ cachedDir = fromDb; dirAge = 0; }
    }
    const fullDir = (cachedDir && dirAge < 24) ? cachedDir : await discoverFastDirectory(c.code, c.name);

    if(!fullDir || fullDir.members.length === 0){
      log(`⚠ ${c.name}: nessun membro in directory — saltato`,"warn");
      continue;
    }

    // Filtra membri per network selezionati: prendi solo chi appartiene ad almeno uno dei network scelti
    const allDirMembers = fullDir.members;
    const filteredMembers = allDirMembers.filter(m => {
      if(!m.networks || m.networks.length === 0) return true; // se non ha network noti, includi (fallback wcaworld)
      return m.networks.some(n => selectedNetDomains.includes(n));
    });

    log(`📂 ${c.name}: ${allDirMembers.length} in directory, ${filteredMembers.length} nei network selezionati (da cache)`,"ok");

    // Popola memberNetworkMap
    for(const m of filteredMembers){
      memberNetworkMap[m.id] = m.networks || [];
    }

    // Aggiorna tabella risultati
    for(const m of filteredMembers){
      if(!discoveredMembers.find(d => d.id === m.id)){
        discoveredMembers.push({id:m.id, name:m.name, networks: m.networks});
      }
    }
    document.getElementById("resultsCard").style.display = "block";
    updateResultsTable();

    updateScrapeStats({ found: filteredMembers.length, networkName: networksToScrape.map(n=>n.name).join(", "), countryName: c.name, downloaded: 0, skipped: 0 });
    notifyEvent(`${c.name}: ${filteredMembers.length} partner da directory cache`);

    // Filtra: solo quelli non già scaricati
    const toDownload = filteredMembers.filter(m => !doneIds.has(m.id));
    if(toDownload.length === 0){
      log(`✅ ${c.name}: tutti i ${filteredMembers.length} membri già scaricati`,"ok");
    } else {
      log(`📥 ${c.name}: ${toDownload.length} da scaricare (${filteredMembers.length - toDownload.length} già fatti)`,"ok");

      // Raggruppa per network migliore
      const byNetwork = {};
      for(const m of toDownload){
        // Scegli il primo network tra quelli selezionati, fallback wcaworld
        const bestNet = (m.networks || []).find(n => selectedNetDomains.includes(n)) || m.networks?.[0] || "wcaworld.com";
        if(!byNetwork[bestNet]) byNetwork[bestNet] = [];
        byNetwork[bestNet].push(m);
      }

      let globalIdx = 0;
      consecutiveFailures = 0;
      const networkDomains = Object.keys(byNetwork);
      for(let ni = 0; ni < networkDomains.length && scraping; ni++){
        const netDomain = networkDomains[ni];
        const netMembers = byNetwork[netDomain];
        const net = ALL_NETWORKS.find(n => n.domain === netDomain);
        const netName = net?.name || netDomain;
        setActiveNetwork(netDomain, netName);
        log(`📥 ${netName}: ${netMembers.length} profili`,"ok");

        for(let i = 0; i < netMembers.length && scraping; i++){
          const member = netMembers[i];
          if(doneIds.has(member.id)){ globalIdx++; continue; }
          globalIdx++;

          setStatus(`[${netName}] ${c.name}: ${globalIdx}/${toDownload.length} — ${member.name||member.id}`, true);
          setProgress(globalIdx, toDownload.length);
          showActivity("📥", `${netName} ${globalIdx}/${toDownload.length} — ${member.name||member.id}`);

          const result = await downloadProfileNet(member, netDomain, netName, c.code);
          if(result.ok){
            doneIds.add(member.id);
            consecutiveFailures = 0;
          } else {
            // Prova network alternativo
            const altNets = (member.networks || []).filter(d => d !== netDomain);
            let rescued = false;
            for(const altDomain of altNets){
              if(!scraping) break;
              const altName = ALL_NETWORKS.find(n => n.domain === altDomain)?.name || altDomain;
              const altResult = await downloadProfileNet(member, altDomain, altName, c.code);
              if(altResult.ok){ doneIds.add(member.id); rescued = true; break; }
            }
            if(!rescued){
              log(`✗ ${member.id}: ${result.error||result.state}`,"warn");
              consecutiveFailures++;
              markIdFailed(c.code, member.id);
              updateScrapeStats({ skipped: scrapeStats.skipped + 1 });
            }
          }

          if(consecutiveFailures >= 5){
            log(`⛔ Troppi fallimenti su ${netName} — passo al prossimo`,"err");
            consecutiveFailures = 0;
            break;
          }

          if(i + 1 < netMembers.length && scraping){
            const nextDelay = getNextDelay();
            await sleepWithActivity("⏳", `Pausa ${Math.round(nextDelay/1000)}s — ${netName}`, nextDelay);
          }
        }

        log(`✅ ${netName} completato per ${c.name}`,"ok");
        addCompletedNetworkLogo(netDomain, netName);
      }
    }

    // ─── FASE 3: ARRICCHIMENTO — profili limitati ri-scaricati da network alternativi ───
    const limitedProfiles = scrapedProfiles.filter(p => p.access_limited);
    if(limitedProfiles.length > 0 && scraping){
      // Mappa nomi network → domini
      const NETWORK_DOMAIN_MAP = {};
      ALL_NETWORKS.forEach(n => { NETWORK_DOMAIN_MAP[n.name] = n.domain; });
      Object.entries(NETWORKS).forEach(([name, siteId]) => {
        const net = ALL_NETWORKS.find(n => n.siteId === siteId);
        if(net) NETWORK_DOMAIN_MAP[name] = net.domain;
      });

      const availableNetworks = networksToScrape.map(n => n.name);
      log(`═══ FASE 3: ARRICCHIMENTO — ${limitedProfiles.length} profili limitati, ${availableNetworks.length} network disponibili ═══`);
      setStatus(`FASE 3: Arricchimento ${limitedProfiles.length} profili limitati...`, true);

      let enriched = 0, enrichFailed = 0;
      for(let li = 0; li < limitedProfiles.length && scraping; li++){
        const lp = limitedProfiles[li];
        setStatus(`FASE 3: ${li+1}/${limitedProfiles.length} — ${lp.company_name}`, true);
        setProgress(li, limitedProfiles.length);

        const profileNetworks = lp.networks || [];
        let targetNetworks = [];
        for(const netName of availableNetworks){
          if(profileNetworks.length > 0){
            if(profileNetworks.some(pn => pn.toLowerCase().includes(netName.toLowerCase().split(" ")[0]))) targetNetworks.push(netName);
          } else {
            targetNetworks.push(netName);
          }
        }
        targetNetworks = targetNetworks.filter(n => NETWORK_DOMAIN_MAP[n] !== "wcaworld.com");

        if(targetNetworks.length === 0){ enrichFailed++; continue; }

        let success = false;
        for(const netName of targetNetworks){
          if(!scraping) break;
          const domain = NETWORK_DOMAIN_MAP[netName];
          if(!domain) continue;

          log(`Arricchimento ${lp.company_name} via ${netName} (${domain})...`);
          try {
            const resp = await fetch(API+"/api/scrape",{
              method:"POST",headers:{"Content-Type":"application/json"},
              body:JSON.stringify({ wcaIds: [lp.wca_id], networkDomain: domain })
            });
            const data = await resp.json();
            const profile = data.success ? data.results?.[0] : null;
            if(profile && profile.state === "ok" && !profile.access_limited){
              const idx = scrapedProfiles.findIndex(p => p.wca_id === lp.wca_id);
              if(idx >= 0){
                profile.enriched_from = netName;
                profile.enriched_domain = domain;
                if(!profile.logo_url && lp.logo_url) profile.logo_url = lp.logo_url;
                if(!profile.enrolled_offices?.length && lp.enrolled_offices?.length) profile.enrolled_offices = lp.enrolled_offices;
                if(!profile.networks?.length && lp.networks?.length) profile.networks = lp.networks;
                scrapedProfiles[idx] = profile;
                refreshScrapedTab(idx, profile);
                log(`✓ ARRICCHITO: ${profile.company_name} via ${netName} — ${profile.contacts?.length||0} contatti, email=${!!profile.email}`,"ok");
                await saveToSupabase(profile);
                enriched++;
                success = true;
              }
              break;
            } else if(profile){
              log(`${netName}: stato=${profile.state} limitato=${profile.access_limited}`,"warn");
            } else {
              log(`${netName}: ${data.error || "nessun risultato"}`,"warn");
            }
          } catch(e){
            log(`Errore scrape ${netName}: ${e.message}`,"err");
          }
          await sleepWithActivity("🔗", `Pausa 5s — prossimo network per ${lp.company_name}`, 5000);
        }
        if(!success) enrichFailed++;
        if(li + 1 < limitedProfiles.length && scraping) await sleepWithActivity("🔗", `Pausa 5s — prossimo profilo da arricchire`, 5000);
      }

      setProgress(limitedProfiles.length, limitedProfiles.length);
      log(`═══ FASE 3 COMPLETATA: ${enriched} arricchiti, ${enrichFailed} ancora limitati ═══`,"ok");
    }

    hideActivity();
    log(`═══ ${c.name} COMPLETATO: ${doneIds.size} profili scaricati ═══`,"ok");
    markCountryCompleted(c.code, doneIds.size);
    removeSuspendedJob(c.code);
    saveScrapingState();
  }
}
