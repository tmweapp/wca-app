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
  const doneIds = new Set(); // ID già scaricati — unica fonte: Supabase wca_profiles
  const memberNetworkMap = {}; // id → [domain1, domain2...] — network dove il membro è stato trovato

  // ═══ UNICA FONTE: Supabase wca_profiles — carica wca_id già presenti ═══
  if(!updateAddress){
    try {
      const dbResp = await fetch(API+"/api/partners?action=existing_ids&country="+encodeURIComponent(country));
      const dbData = await dbResp.json();
      if(dbData.success && dbData.ids){
        for(const id of dbData.ids) doneIds.add(id);
        if(doneIds.size > 0) log(`🗄️ ${countryName}: ${doneIds.size} profili già in Supabase — saranno saltati`,"ok");
      }
    } catch(e){ log(`⚠ Check Supabase fallito: ${e.message}`,"warn"); }
  }

  // === HELPER: estrai dominio reale da scrape_url ===
  function getDomainFromScrapeUrl(scrapeUrl){
    if(!scrapeUrl) return null;
    try { const u = new URL(scrapeUrl); return u.hostname.replace(/^www\./, ""); } catch(e){ return null; }
  }

  // === HELPER: scarica un profilo da un network specifico ===
  async function downloadProfile(member, networkDomain, networkLabel){
    const profileHref = member.scrape_url || member.href;
    const loginDomain = getDomainFromScrapeUrl(member.scrape_url) || networkDomain;
    let retries = 0;
    while(retries <= MAX_RETRIES && scraping){
      try {
        // Timeout 12s per evitare fetch appesi
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 50000);
        const resp = await fetch(API+"/api/scrape",{
          method:"POST",headers:{"Content-Type":"application/json"},
          body:JSON.stringify({wcaIds:[member.id], members: profileHref ? [{id:member.id, href:profileHref}] : [], networkDomain: loginDomain}),
          signal: controller.signal
        });
        clearTimeout(timeout);
        const data = await resp.json();
        if(!data.success){
          if(data.error && data.error.includes("SSO") && retries < MAX_RETRIES){
            retries++;
            await sleepWithActivity("🔄", `SSO retry ${retries}/${MAX_RETRIES}`, 5000);
            continue;
          }
          return { ok:false, error: data.error };
        }
        const profile = data.results?.[0];
        if(!profile) return { ok:false, error:"no_result" };
        if(profile.state === "ok"){
          // Guardia anti-sessione-scaduta: se 0 contatti e non limited, non salvare e riprova
          const hasNoContacts = !profile.contacts || profile.contacts.length === 0;
          if(hasNoContacts && !profile.access_limited && retries < MAX_RETRIES){
            retries++;
            log(`⚠ ${profile.company_name} (${profile.wca_id}): 0 contatti senza access_limited — probabile sessione scaduta, retry ${retries}/${MAX_RETRIES}`,"warn");
            await sleepWithActivity("🔄", `Retry per sessione scaduta`, 3000);
            continue;
          }
          scrapedProfiles.unshift(profile);
          if(scrapedProfiles.length > MAX_TABS) scrapedProfiles.pop();
          addScrapedTab(profile, 0);
          trimScrapedTabs(MAX_TABS);
          const limited = profile.access_limited ? " [LIMITATO]" : "";
          const noContact = hasNoContacts && !profile.access_limited ? " [⚠NO CONTATTI]" : "";
          log(`✓ ${profile.company_name} (${profile.wca_id}) contatti:${profile.contacts?.length||0}${limited}${noContact} [${networkLabel}]`,"ok");
          await saveToSupabase(profile);
          markIdDone(country, profile.wca_id);
          updateResultRow(profile.wca_id, "ok");
          totalScraped++;
          consecutiveFailures = 0;
          updateScrapeStats({ downloaded: scrapeStats.downloaded + 1 });
          return { ok:true, profile };
        } else if(profile.state === "login_redirect" && retries < MAX_RETRIES){
          retries++;
          await sleepWithActivity("🔑", `Sessione scaduta — retry ${retries}/${MAX_RETRIES}`, 5000);
          continue;
        }
        return { ok:false, state: profile.state };
      } catch(e){
        if(retries < MAX_RETRIES){ retries++; await sleepWithActivity("⚠️", `Errore rete — retry`, 3000); continue; }
        return { ok:false, error: e.message };
      }
    }
    return { ok:false, error:"stopped" };
  }

  // ═══════════════════════════════════════════════════════════════
  // FASE 1: DIRECTORY — carica da Supabase (fonte unica)
  // Se non presente, esegui discovery live
  // ═══════════════════════════════════════════════════════════════
  let fullDir = await loadDirectoryFromSupabase(country);
  if(!fullDir || !fullDir.members || fullDir.members.length === 0){
    log(`📂 ${countryName}: directory non in Supabase, lancio discovery...`,"warn");
    fullDir = await discoverFullDirectory(country, countryName);
  } else {
    log(`📂 ${countryName}: ${fullDir.members.length} membri caricati da Supabase`,"ok");
  }
  if(!fullDir || fullDir.members.length === 0){
    log(`⚠ ${countryName}: nessun membro trovato nella directory`,"warn");
    return { ok:false, error:"no_members" };
  }

  // Filtra per network se richiesto
  // Network virtuali WCA (wca-first ecc.) sono su wcaworld.com — includerli sempre
  const VIRTUAL_WCA_NETS = new Set(["wca-first","wca-advanced","wca-chinaglobal","wca-interglobal","wca-vendors"]);
  let targetMembers = fullDir.members;
  if(networkFilter && networkFilter.length > 0){
    targetMembers = fullDir.members.filter(m => {
      if(!m.networks || m.networks.length === 0) return false;
      return m.networks.some(n => networkFilter.includes(n) || VIRTUAL_WCA_NETS.has(n));
    });
    log(`📂 ${countryName}: ${fullDir.members.length} totali → ${targetMembers.length} nei network selezionati (incl. WCA virtuali)`,"ok");
  }

  // Popola memberNetworkMap dalla directory e sincronizza con globale
  for(const m of targetMembers){
    memberNetworkMap[m.id] = m.networks || [];
  }
  currentNetworkMap = memberNetworkMap;

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
    log(`✅ ${countryName}: tutti i ${totalMembers} membri già scaricati — skip completo`,"ok");
    markCountryCompleted(country, doneIds.size);
    return { ok:true, skipped:true };
  } else {
    log(`📥 ${countryName}: ${toDownload.length} da scaricare (${totalMembers - toDownload.length} già fatti)`,"ok");

    // Raggruppa per DOMINIO REALE (da scrape_url) per login ottimizzato
    // Network virtuali WCA (wca-first, wca-advanced, etc.) → wcaworld.com
    const VIRTUAL_WCA = new Set(["wca-first","wca-advanced","wca-chinaglobal","wca-interglobal","wca-vendors"]);
    const BADGE_ONLY = new Set(["allworldshipping","cass","qs","iata"]); // non-scaricabili
    function resolveNetDomain(networks){
      if(!networks || !networks.length) return "wcaworld.com";
      // Cerca il primo network con dominio REALE (non virtuale, non badge)
      for(const n of networks){
        if(!VIRTUAL_WCA.has(n) && !BADGE_ONLY.has(n) && n.includes(".")) return n;
      }
      // Se solo network virtuali WCA o badge, usa wcaworld.com
      return "wcaworld.com";
    }
    const byNetwork = {};
    for(const m of toDownload){
      let bestNet = "wcaworld.com";
      if(m.scrape_url){
        try { bestNet = new URL(m.scrape_url).hostname.replace(/^www\./, ""); } catch(e){}
      } else {
        bestNet = resolveNetDomain(m.networks);
      }
      if(!byNetwork[bestNet]) byNetwork[bestNet] = [];
      byNetwork[bestNet].push(m);
    }

    let globalIdx = 0;
    let totalSkippedCountry = 0; // track total skips for the whole country
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
          consecutiveFailures = 0;
        } else {
          // Prova un network alternativo (max 2 per non perdere tempo)
          const altNets = (member.networks || []).filter(d => d !== netDomain).slice(0, 2);
          let rescued = false;
          for(const altDomain of altNets){
            if(!scraping) break;
            const altName = ALL_NETWORKS.find(n => n.domain === altDomain)?.name || altDomain;
            const altResult = await downloadProfile(member, altDomain, altName);
            if(altResult.ok){ doneIds.add(member.id); rescued = true; consecutiveFailures = 0; break; }
          }
          if(!rescued){
            consecutiveFailures++;
            totalSkippedCountry++;
            updateScrapeStats({ skipped: scrapeStats.skipped + 1 });
            // Skip delay on failures — no need to wait if download failed
          }
        }

        if(consecutiveFailures >= 5){
          log(`⛔ ${consecutiveFailures} fallimenti consecutivi su ${netName} — passo al prossimo network`,"err");
          consecutiveFailures = 0;
          break;
        }

        // Only pause between SUCCESSFUL downloads or if we haven't had too many skips
        if(i + 1 < netMembers.length && scraping && consecutiveFailures === 0){
          const nextDelay = getNextDelay();
          await sleepWithActivity("⏳", `Pausa ${Math.round(nextDelay/1000)}s — ${netName}`, nextDelay);
        } else if(i + 1 < netMembers.length && scraping && consecutiveFailures > 0){
          // Short 1s pause on failures — just enough to not hammer the server
          await sleep(1000);
        }
      }

      log(`✅ ${netName} completato per ${countryName} (skipped: ${totalSkippedCountry})`,"ok");
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

  log(`═══ FASE 3: ARRICCHIMENTO — ${limitedProfiles.length} profili limitati, ${availableNetworks.length} network disponibili ═══`,"ok");
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

      log(`Arricchimento ${lp.company_name} via ${netName} (${domain})...`,"info");
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
  // FASE 4: IDENTIFICA NO NETWORK — usa fullDir già caricata in Fase 1
  // ═══════════════════════════════════════════════════════════════════════════════
  if(!scraping) return;

  log(`═══ FASE 4: IDENTIFICA NO NETWORK (da directory già caricata) ═══`,"ok");

  // "No network" = membri che NON hanno NESSUN network (array vuoto o assente)
  // NON include membri con network diversi da quelli selezionati — quelli vanno saltati
  const noNetworkMembers = fullDir.members.filter(m => !m.networks || m.networks.length === 0);

  const withNetwork = fullDir.members.filter(m => m.networks && m.networks.length > 0).length;
  log(`📊 ${countryName}: ${fullDir.members.length} totali, ${withNetwork} con network, ${noNetworkMembers.length} senza network`,"ok");

  if(noNetworkMembers.length === 0){
    log(`✅ Nessun partner senza network — procedura completata!`,"ok");
    return;
  }

  // ═══════════════════════════════════════════════════════════════════════════════
  // FASE 5: DOWNLOAD NO NETWORK — scarica i partner da wcaworld.com
  // ═══════════════════════════════════════════════════════════════════════════════

  // Filtra: solo quelli con href valido e non già scaricati
  const noNetWithHref = noNetworkMembers.filter(m => m.href && m.href.includes("/directory/members/"));
  const noNetToDownload = noNetWithHref.filter(m => !doneIds.has(m.id));
  const noNetNoHref = noNetworkMembers.length - noNetWithHref.length;

  if(noNetNoHref > 0) log(`📂 NO NETWORK: ${noNetNoHref} senza href valido — saltati`,"warn");
  if(noNetWithHref.length > noNetToDownload.length){
    log(`📂 NO NETWORK: ${noNetWithHref.length - noNetToDownload.length} già scaricati`,"ok");
  }

  if(noNetToDownload.length === 0){
    log(`✅ NO NETWORK: nessun profilo da scaricare`,"ok");
  } else {
    log(`═══ FASE 5: DOWNLOAD NO NETWORK — ${noNetToDownload.length} partner ═══`,"info");
    setStatus(`FASE 5: Download ${noNetToDownload.length} partner da wcaworld.com...`, true);

    let noNetDownloaded = 0;
    let noNetSkipped = 0;
    let noNetConsecFails = 0;
    const MAX_CONSEC_FAILS_NONET = 3; // Aggressivo: 3 fail consecutivi → skip tutto

    for(let i = 0; i < noNetToDownload.length && scraping; i++){
      const member = noNetToDownload[i];
      setStatus(`${countryName} [NO NET] ${i+1}/${noNetToDownload.length} — ${member.name||member.id}`, true);
      setProgress(i, noNetToDownload.length);

      try {
        // Timeout aggressivo: 8s max per NO NETWORK
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 50000);
        const resp = await fetch(API+"/api/scrape",{
          method:"POST",headers:{"Content-Type":"application/json"},
          body:JSON.stringify({
            wcaIds:[member.id],
            members: [{id:member.id, href:member.href}],
            networkDomain: "wcaworld.com"
          }),
          signal: controller.signal
        });
        clearTimeout(timeout);

        const data = await resp.json();
        if(!data.success){
          noNetSkipped++; noNetConsecFails++;
          if(noNetConsecFails >= MAX_CONSEC_FAILS_NONET){
            log(`⛔ ${noNetConsecFails} fail consecutivi NO NETWORK — skip fase 5`,"err");
            break;
          }
          await sleep(200);
          continue;
        }

        const profile = data.results?.[0];
        if(!profile || profile.state !== "ok"){
          noNetSkipped++; noNetConsecFails++;
          if(noNetConsecFails >= MAX_CONSEC_FAILS_NONET){
            log(`⛔ ${noNetConsecFails} fail consecutivi NO NETWORK — skip fase 5`,"err");
            break;
          }
          await sleep(200);
          continue;
        }

        // Success!
        noNetConsecFails = 0;
        scrapedProfiles.unshift(profile);
        if(scrapedProfiles.length > 50) scrapedProfiles.pop();
        addScrapedTab(profile, 0);
        trimScrapedTabs(50);

        const limited = profile.access_limited ? " [LIMITED]" : "";
        log(`✓ ${profile.company_name} (${profile.wca_id}) contatti:${profile.contacts?.length||0}${limited} [NO NET]`,"ok");
        await saveToSupabase(profile);
        markIdDone(country, profile.wca_id);
        updateResultRow(profile.wca_id, "ok");
        totalScraped++;
        noNetDownloaded++;
        updateScrapeStats({ downloaded: scrapeStats.downloaded + 1 });

        // Pausa solo dopo successo
        if(i + 1 < noNetToDownload.length && scraping){
          const nextDelay = getNextDelay();
          await sleepWithActivity("⏳", `Pausa ${Math.round(nextDelay/1000)}s`, nextDelay);
        }

      } catch(e){
        noNetSkipped++; noNetConsecFails++;
        log(`⚠ NO NET ${member.name||member.id} (${member.id}): ${e.message}`,"warn");
        if(noNetConsecFails >= MAX_CONSEC_FAILS_NONET){
          log(`⛔ ${noNetConsecFails} errori consecutivi NO NETWORK — skip fase 5`,"err");
          break;
        }
        await sleep(200);
      }
    }

    hideActivity();
    log(`═══ FASE 5 COMPLETATA: ${noNetDownloaded} scaricati, ${noNetSkipped} saltati ═══`,"ok");
  }
}
