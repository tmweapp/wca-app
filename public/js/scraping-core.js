// ═══════════════════════════════════════════════════════════════════════════════
// SCRAPING CORE — Main discovery + download procedure for a country
// Phases 1-5: Full directory discovery, network-based download, enrichment, global no-network
// ═══════════════════════════════════════════════════════════════════════════════

async function scrapeDiscoverCountry(country, countryName, updateAddress = false, networkFilter = null){
  currentScrapingCountry = country;
  resetCompletedNetworks();
  hideCountryCompletion();
  setActiveCountry(country, countryName);
  const MAX_TABS = 50;
  const MAX_RETRIES = 2;
  let consecutiveFailures = 0;
  const doneIds = new Set(); // ID già scaricati con successo in questa sessione
  const memberNetworkMap = {}; // id → [domain1, domain2...] — network dove il membro è stato trovato

  // Carica ID già fatti dalla directory locale
  const existingDir = getDirectory(country);
  if(existingDir && !updateAddress){
    Object.entries(existingDir.ids).forEach(([id, status]) => { if(status === "done") doneIds.add(parseInt(id)); });
    if(doneIds.size > 0) log(`📂 ${countryName}: ${doneIds.size} profili già completati in directory locale`,"ok");
  }

  // === HELPER: scarica un profilo da un network specifico ===
  async function downloadProfile(member, networkDomain, networkLabel){
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
          saveToSupabase(profile);
          markIdDone(country, profile.wca_id);
          updateResultRow(profile.wca_id, "ok");
          totalScraped++;
          consecutiveFailures = 0;
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
  // FASE 1: DIRECTORY — usa full directory per-network
  // Loop su tutti i network per trovare dove è presente ogni membro
  // ═══════════════════════════════════════════════════════════════
  let cached = getFullDirectory(country);
  let cacheAge = getFullDirAge(country);
  // Se non in localStorage, prova Supabase
  if(!cached || cacheAge >= 24){
    const fromDb = await loadDirectoryFromSupabase(country);
    if(fromDb){ cached = fromDb; cacheAge = 0; }
  }
  const cacheHasNetworks = cached && cached.members && cached.members.some(m => m.networks && m.networks.length > 0);
  const cacheHasScrapeUrl = cached && cached.members && cached.members.some(m => m.scrape_url);
  const fullDir = (cached && cacheAge < 24 && (cacheHasNetworks || cacheHasScrapeUrl)) ? cached : await discoverFullDirectory(country, countryName);
  if(!fullDir || fullDir.members.length === 0){
    log(`⚠ ${countryName}: nessun membro trovato nella directory`,"warn");
    return { ok:false, error:"no_members" };
  }

  // Filtra per network se richiesto
  let targetMembers = fullDir.members;
  if(networkFilter && networkFilter.length > 0){
    targetMembers = fullDir.members.filter(m => {
      if(!m.networks || m.networks.length === 0) return false;
      return m.networks.some(n => networkFilter.includes(n));
    });
    log(`📂 ${countryName}: ${fullDir.members.length} totali → ${targetMembers.length} nei network selezionati`,"ok");
  }

  // Popola memberNetworkMap dalla directory
  for(const m of targetMembers){
    memberNetworkMap[m.id] = m.networks || [];
  }

  // Aggiorna tabella risultati
  for(const m of targetMembers){
    if(!discoveredMembers.find(d => d.id === m.id)){
      discoveredMembers.push({id:m.id, name:m.name, networks:m.networks});
    }
  }
  document.getElementById("resultsCard").style.display = "block";
  updateResultsTable();

  const totalMembers = targetMembers.length;
  const networkLabel = networkFilter ? networkFilter.length + " network" : "Tutti";
  updateScrapeStats({ found: totalMembers, networkName: networkLabel, countryName, downloaded: 0, skipped: 0 });
  notifyEvent(`Directory ${countryName}: ${totalMembers} partner trovati`);
  refreshCountryCompletion();

  // ═══════════════════════════════════════════════════════════════
  // FASE 2: DOWNLOAD — per ogni membro, usa il miglior network
  // ═══════════════════════════════════════════════════════════════
  const toDownload = updateAddress
    ? targetMembers
    : targetMembers.filter(m => !doneIds.has(m.id));

  if(toDownload.length === 0){
    log(`✅ ${countryName}: tutti i ${totalMembers} membri già scaricati`,"ok");
  } else {
    log(`📥 ${countryName}: ${toDownload.length} da scaricare (${totalMembers - toDownload.length} già fatti)`,"ok");

    // Raggruppa per network preferito per download ordinato
    const byNetwork = {};
    for(const m of toDownload){
      const bestNet = m.scrape_domain || m.networks?.[0] || "wcaworld.com";
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
      log(`📥 ${netName}: ${netMembers.length} profili da scaricare`,"ok");

      for(let i = 0; i < netMembers.length && scraping; i++){
        const member = netMembers[i];
        if(doneIds.has(member.id) && !updateAddress){ globalIdx++; continue; }

        globalIdx++;
        setStatus(`${countryName} [${netName}] ${globalIdx}/${toDownload.length} — ${member.name||member.id}`, true);
        setProgress(globalIdx, toDownload.length);
        showActivity("📥", `${netName} ${globalIdx}/${toDownload.length} — ${member.name||member.id}`);

        const result = await downloadProfile(member, netDomain, netName);
        if(result.ok){
          doneIds.add(member.id);
        } else {
          // Prova un network alternativo
          const altNets = (member.networks || []).filter(d => d !== netDomain);
          let rescued = false;
          for(const altDomain of altNets){
            if(!scraping) break;
            const altName = ALL_NETWORKS.find(n => n.domain === altDomain)?.name || altDomain;
            const altResult = await downloadProfile(member, altDomain, altName);
            if(altResult.ok){ doneIds.add(member.id); rescued = true; break; }
          }
          if(!rescued){
            if(result.state === "not_found" || result.state === "not_in_network"){
              updateScrapeStats({ skipped: scrapeStats.skipped + 1 });
            } else {
              consecutiveFailures++;
              updateScrapeStats({ skipped: scrapeStats.skipped + 1 });
            }
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

      log(`✅ ${netName} completato per ${countryName}`,"ok");
      addCompletedNetworkLogo(netDomain, netName);
    }
  }

  hideActivity();
  log(`═══ ${countryName} COMPLETATO: ${doneIds.size} profili scaricati ═══`,"ok");
  markCountryCompleted(country, doneIds.size);
  removeSuspendedJob(country);
  saveScrapingState();

  // === FASE 3: ARRICCHIMENTO — profili limitati vengono ri-scaricati dai network disponibili ===
  const limitedProfiles = scrapedProfiles.filter(p => p.access_limited);
  if(limitedProfiles.length === 0 || !scraping){
    if(limitedProfiles.length === 0) log("Nessun profilo con accesso limitato — arricchimento non necessario","ok");
    // NON fare return — Phase 4-5 NO NETWORK devono partire dopo
  } else {

  // Usa solo i network selezionati dall'utente (siteId come ponte)
  const selNetNames = getSelectedNetworks();
  const selSiteIds = new Set(selNetNames.map(name => NETWORKS[name]).filter(id => id !== undefined));
  const activeNets = ALL_NETWORKS.filter(n => selSiteIds.has(n.siteId));
  const availableNetworks = activeNets.length > 0 ? activeNets.map(n => n.name) : ALL_NETWORKS.map(n => n.name);

  log(`═══ FASE 3: ARRICCHIMENTO — ${limitedProfiles.length} profili limitati, ${availableNetworks.length} network disponibili ═══`);
  setStatus(`FASE 3: Arricchimento ${limitedProfiles.length} profili limitati...`, true);

  // Mappa nomi network → domini — generata dinamicamente da ALL_NETWORKS + NETWORKS
  // Copre sia i nomi ALL_NETWORKS (es. "WCA eCommerce") che i nomi NETWORKS (es. "WCA eCommerce Solutions")
  const NETWORK_DOMAIN_MAP = {};
  ALL_NETWORKS.forEach(n => { NETWORK_DOMAIN_MAP[n.name] = n.domain; });
  // Aggiungi mapping anche per i nomi NETWORKS{} (che possono differire)
  Object.entries(NETWORKS).forEach(([name, siteId]) => {
    const net = ALL_NETWORKS.find(n => n.siteId === siteId);
    if(net) NETWORK_DOMAIN_MAP[name] = net.domain;
  });

  let enriched = 0;
  let enrichFailed = 0;
  for(let li = 0; li < limitedProfiles.length && scraping; li++){
    const lp = limitedProfiles[li];
    setStatus(`FASE 3: Arricchimento ${li+1}/${limitedProfiles.length} — ${lp.company_name}`, true);
    setProgress(li, limitedProfiles.length);

    // Trova i network del profilo che sono disponibili
    const profileNetworks = lp.networks || [];
    let targetNetworks = [];
    for(const netName of availableNetworks){
      // Se il profilo elenca i suoi network, prova quelli; altrimenti prova tutti
      if(profileNetworks.length > 0){
        if(profileNetworks.some(pn => pn.toLowerCase().includes(netName.toLowerCase().split(" ")[0]))) {
          targetNetworks.push(netName);
        }
      } else {
        targetNetworks.push(netName);
      }
    }
    // Escludi wcaworld.com (già provato nella Fase 2)
    targetNetworks = targetNetworks.filter(n => NETWORK_DOMAIN_MAP[n] !== "wcaworld.com");

    if(targetNetworks.length === 0){
      log(`${lp.company_name}: nessun network alternativo disponibile`,"warn");
      enrichFailed++;
      continue;
    }

    let success = false;
    for(const netName of targetNetworks){
      if(!scraping) break;
      const domain = NETWORK_DOMAIN_MAP[netName];
      if(!domain) continue;

      log(`Arricchimento ${lp.company_name} via ${netName} (${domain})...`);
      try {
        // Usa /api/scrape con networkDomain — fa SSO sul dominio specifico
        const resp = await fetch(API+"/api/scrape",{
          method:"POST",headers:{"Content-Type":"application/json"},
          body:JSON.stringify({
            wcaIds: [lp.wca_id],
            networkDomain: domain,
          })
        });
        const data = await resp.json();
        const profile = data.success ? data.results?.[0] : null;
        if(profile && profile.state === "ok" && !profile.access_limited){
          // Merge: aggiorna il profilo nell'array con i dati completi dal network
          const idx = scrapedProfiles.findIndex(p => p.wca_id === lp.wca_id);
          if(idx >= 0){
            profile.enriched_from = netName;
            profile.enriched_domain = domain;
            // Mantieni dati originali che il nuovo profilo potrebbe non avere
            if(!profile.logo_url && lp.logo_url) profile.logo_url = lp.logo_url;
            if(!profile.enrolled_offices?.length && lp.enrolled_offices?.length) profile.enrolled_offices = lp.enrolled_offices;
            if(!profile.networks?.length && lp.networks?.length) profile.networks = lp.networks;
            scrapedProfiles[idx] = profile;
            refreshScrapedTab(idx, profile);
            log(`✓ ARRICCHITO: ${profile.company_name} via ${netName} — ${profile.contacts?.length||0} contatti, email=${!!profile.email}`,"ok");
            saveToSupabase(profile);
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

      // Delay tra tentativi su network diversi — 5s perché ogni enrich fa SSO+search+fetch
      await sleepWithActivity("🔗", `Pausa 5s — prossimo network per ${lp.company_name}`, 5000);
    }
    if(!success) enrichFailed++;

    // Delay tra profili — 5s minimo per non stressare WCA
    if(li + 1 < limitedProfiles.length && scraping) await sleepWithActivity("🔗", `Pausa 5s — prossimo profilo da arricchire`, 5000);
  }

  setProgress(limitedProfiles.length, limitedProfiles.length);
  log(`═══ FASE 3 COMPLETATA: ${enriched} arricchiti, ${enrichFailed} ancora limitati ═══`,"ok");
  } // fine else Phase 3

  // ═══════════════════════════════════════════════════════════════════════════════
  // FASE 4: DISCOVER NO NETWORK — scopri i partner che NON sono in nessun network
  // ═══════════════════════════════════════════════════════════════════════════════
  if(!scraping) return;

  log(`═══ FASE 4: DISCOVER NO NETWORK ═══`,"info");
  setStatus(`FASE 4: Scopri partner senza network...`, true);

  // Scarica directory globale con paginazione (WCA limita a 50 per pagina)
  const globalDir = [];
  let globalPage = 1;
  let globalHasMore = true;
  while(globalHasMore && scraping){
    try {
      const globalResp = await fetch(API+"/api/discover-global",{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({ country: country, page: globalPage })
      });
      const globalData = await globalResp.json();
      if(globalData.success && globalData.members && globalData.members.length > 0){
        for(const m of globalData.members){
          if(!globalDir.find(x => x.id === m.id)) globalDir.push(m);
        }
        globalHasMore = globalData.hasNext;
        globalPage++;
        setStatus(`FASE 4: Directory globale p.${globalPage} — ${globalDir.length} partner...`, true);
        if(globalHasMore && scraping){
          const nextDelay = getNextDirDelay();
          await sleepWithActivity("🔍", `Pausa ${Math.round(nextDelay/1000)}s — prossima pagina globale`, nextDelay);
        }
      } else {
        globalHasMore = false;
      }
    } catch(e){
      log(`⚠ Errore download directory globale p.${globalPage}: ${e.message}`,"warn");
      globalHasMore = false;
    }
  }
  if(globalDir.length === 0){
    log(`⚠ Directory globale vuota — skip NO NETWORK`,"warn");
    return;
  }
  log(`📂 Directory globale: ${globalDir.length} partner totali`,"ok");

  // Identifica i 142 NO NETWORK
  const networkMemberIds = new Set(targetMembers.map(m => m.id));
  const noNetworkMembers = globalDir.filter(g => !networkMemberIds.has(g.id));

  log(`📊 Statistiche:`, "ok");
  log(`   Totali globali: ${globalDir.length}`, "ok");
  log(`   Con network: ${networkMemberIds.size}`, "ok");
  log(`   Senza network (NO NETWORK): ${noNetworkMembers.length}`, "ok");

  if(noNetworkMembers.length === 0){
    log(`✅ Nessun partner senza network — procedura completata!`,"ok");
    return;
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // FASE 5: DOWNLOAD NO NETWORK — scarica i partner da wcaworld.com
  // ═══════════════════════════════════════════════════════════════════════════════
  log(`═══ FASE 5: DOWNLOAD NO NETWORK — ${noNetworkMembers.length} partner ═══`,"info");
  setStatus(`FASE 5: Download ${noNetworkMembers.length} partner da wcaworld.com...`, true);

  let noNetDownloaded = 0;
  let noNetSkipped = 0;

  for(let i = 0; i < noNetworkMembers.length && scraping; i++){
    const member = noNetworkMembers[i];
    setStatus(`${countryName} [NO NETWORK] ${i+1}/${noNetworkMembers.length} — ${member.name||member.id}`, true);
    setProgress(i, noNetworkMembers.length);
    showActivity("📥", `NO NETWORK ${i+1}/${noNetworkMembers.length} — ${member.name||member.id}`);

    try {
      const resp = await fetch(API+"/api/scrape",{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({
          wcaIds:[member.id],
          members: member.href ? [{id:member.id, href:member.href}] : [],
          networkDomain: "wcaworld.com"
        })
      });

      const data = await resp.json();
      if(!data.success){
        log(`⚠ ${member.id}: ${data.error}`,"warn");
        noNetSkipped++;
        continue;
      }

      const profile = data.results?.[0];
      if(!profile || profile.state !== "ok"){
        log(`⚠ ${member.id}: ${profile?.state || "no_result"}`,"warn");
        noNetSkipped++;
        continue;
      }

      scrapedProfiles.unshift(profile);
      if(scrapedProfiles.length > 50) scrapedProfiles.pop();
      addScrapedTab(profile, 0);
      trimScrapedTabs(50);

      const limited = profile.access_limited ? " [LIMITED]" : "";
      log(`✓ ${profile.company_name} (${profile.wca_id}) contatti:${profile.contacts?.length||0}${limited} [NO NETWORK]`,"ok");
      saveToSupabase(profile);
      markIdDone(country, profile.wca_id);
      updateResultRow(profile.wca_id, "ok");
      totalScraped++;
      noNetDownloaded++;
      updateScrapeStats({ downloaded: scrapeStats.downloaded + 1 });

    } catch(e){
      log(`⚠ Errore ${member.id}: ${e.message}`,"warn");
      noNetSkipped++;
    }

    if(i + 1 < noNetworkMembers.length && scraping){
      const nextDelay = getNextDelay();
      await sleepWithActivity("⏳", `Pausa ${Math.round(nextDelay/1000)}s`, nextDelay);
    }
  }

  hideActivity();
  log(`═══ FASE 5 COMPLETATA: ${noNetDownloaded} scaricati, ${noNetSkipped} saltati ═══`,"ok");
}
