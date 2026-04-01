// WCA — Network Repair
// Trova record in wca_directory con networks vuoti, riesegue il discover full
// per paese, aggiorna la directory, poi ri-scarica i profili mancanti/da aggiornare

let networkRepairRunning = false;

async function repairNetworkOrphans(){
  if(networkRepairRunning){
    log("⚠ Repair già in corso","warn");
    return;
  }
  networkRepairRunning = true;
  const btn = document.getElementById("btnRepairNet");
  if(btn){ btn.disabled = true; btn.style.opacity = "0.5"; }

  try {
    // ═══ STEP 1: Trova orfani di network dalla directory DB ═══
    log("🔍 REPAIR: Cerco record directory senza network...","ok");
    setStatus("Repair: caricamento orfani network...", true);

    const resp = await fetch(API+"/api/partners?action=network_orphans");
    const data = await resp.json();
    if(!data.success || data.total === 0){
      log("✅ REPAIR: Nessun orfano di network trovato — directory OK","ok");
      setStatus("Nessun orfano di network", true);
      return;
    }

    const byCountry = data.byCountry;
    const countries = Object.keys(byCountry).filter(cc => cc.length === 2 && /^[A-Z]{2}$/.test(cc));
    const totalOrphans = data.total;
    // Mappa codice → nome paese
    const countryList = getAllCountryList();
    const ccNameMap = {};
    for(const c of countryList) ccNameMap[c.code] = c.name;

    log(`📊 REPAIR: ${totalOrphans} record senza network in ${countries.length} paesi`,"warn");

    // ═══ STEP 2: Per ogni paese, riesegui full directory per ottenere i network ═══
    let totalFixed = 0;
    let totalProfilesUpdated = 0;

    for(let ci = 0; ci < countries.length; ci++){
      const cc = countries[ci];
      const orphanIds = new Set(byCountry[cc].map(o => o.wca_id));
      const countryName = ccNameMap[cc] || cc;

      log(`═══ REPAIR ${ci+1}/${countries.length}: ${countryFlag(cc)} ${countryName} — ${orphanIds.size} orfani ═══`,"ok");
      setStatus(`Repair ${ci+1}/${countries.length}: ${countryName} (${orphanIds.size} orfani)`, true);
      showActivity("🔧", `${countryName} ${ci+1}/${countries.length}`);

      // 2a: Esegui full directory discovery (per-network) — forza refresh
      let fullDir;
      try {
        fullDir = await discoverFullDirectory(cc, countryName, true); // forceRefresh=true
      } catch(e){
        log(`❌ REPAIR ${countryName}: errore directory — ${e.message}`,"err");
        continue;
      }

      if(!fullDir || !fullDir.members || fullDir.members.length === 0){
        log(`⚠ REPAIR ${countryName}: nessun membro nella full directory`,"warn");
        continue;
      }

      // 2b: Conta quanti orfani ora hanno network dopo il refresh
      let fixedThisCountry = 0;
      const stillOrphan = [];
      for(const m of fullDir.members){
        if(orphanIds.has(m.id)){
          if(m.networks && m.networks.length > 0){
            fixedThisCountry++;
          } else {
            stillOrphan.push(m);
          }
        }
      }
      totalFixed += fixedThisCountry;
      log(`📊 ${countryName}: ${fixedThisCountry} orfani ora hanno network, ${stillOrphan.length} ancora senza`,"ok");

      // ═══ STEP 3: Ri-scarica profili degli orfani che ora hanno un network ═══
      // Filtra solo quelli che avevano network vuoti e ora li hanno
      const toRedownload = fullDir.members.filter(m => orphanIds.has(m.id) && m.networks && m.networks.length > 0);

      if(toRedownload.length === 0){
        log(`⏭ ${countryName}: nessun profilo da ri-scaricare`,"ok");
        // Pausa tra paesi
        if(ci + 1 < countries.length){
          await sleepWithActivity("⏳", `Pausa 3s — prossimo paese`, 3000);
        }
        continue;
      }

      // Carica ID già in wca_profiles per capire chi va aggiornato
      let existingIds = new Set();
      try {
        const idResp = await fetch(API+"/api/partners?action=existing_ids");
        const idData = await idResp.json();
        if(idData.success && idData.ids) existingIds = new Set(idData.ids);
      } catch(e){ log(`⚠ existing_ids error: ${e.message}`,"warn"); }

      // Separa: nuovi (non in profiles) vs esistenti (da aggiornare con network info)
      const newProfiles = toRedownload.filter(m => !existingIds.has(m.id));
      const updateProfiles = toRedownload.filter(m => existingIds.has(m.id));

      log(`📥 ${countryName}: ${newProfiles.length} nuovi da scaricare, ${updateProfiles.length} da aggiornare`,"ok");

      // Scarica i nuovi profili con pause standard
      const allToProcess = [...newProfiles, ...updateProfiles];
      let downloaded = 0;
      let failed = 0;
      let consecutiveFails = 0;

      for(let i = 0; i < allToProcess.length; i++){
        const member = allToProcess[i];
        const bestNet = (member.networks && member.networks.length > 0) ? member.networks[0] : "wcaworld.com";
        const netInfo = ALL_NETWORKS.find(n => n.domain === bestNet);
        const netName = netInfo?.name || bestNet;

        setStatus(`Repair ${countryName} ${i+1}/${allToProcess.length} — ${member.name||member.id}`, true);
        setProgress(i, allToProcess.length);
        showActivity("📥", `${netName} ${i+1}/${allToProcess.length}`);

        // Determina dominio login
        let loginDomain = bestNet;
        if(member.scrape_url){
          try { loginDomain = new URL(member.scrape_url).hostname.replace(/^www\./, ""); } catch(e){}
        }

        let ok = false;
        let retries = 0;
        while(retries <= 2){
          try {
            const controller = new AbortController();
            const timeout = setTimeout(() => controller.abort(), 12000);
            const profileHref = member.scrape_url || member.href;
            const scrapeResp = await fetch(API+"/api/scrape",{
              method:"POST",headers:{"Content-Type":"application/json"},
              body:JSON.stringify({
                wcaIds:[member.id],
                members: profileHref ? [{id:member.id, href:profileHref}] : [],
                networkDomain: loginDomain
              }),
              signal: controller.signal
            });
            clearTimeout(timeout);
            const scrapeData = await scrapeResp.json();
            if(scrapeData.success){
              const profile = scrapeData.results?.[0];
              if(profile && profile.state === "ok"){
                const limited = profile.access_limited ? " [LIMITATO]" : "";
                log(`✓ ${profile.company_name} (${profile.wca_id}) contatti:${profile.contacts?.length||0}${limited} [REPAIR/${netName}]`,"ok");
                await saveToSupabase(profile);
                downloaded++;
                consecutiveFails = 0;
                ok = true;
                break;
              } else if(profile && profile.state === "login_redirect" && retries < 2){
                retries++;
                await sleepWithActivity("🔑","SSO retry "+retries, 5000);
                continue;
              }
            }
            break;
          } catch(e){
            if(retries < 2){ retries++; await sleep(3000); continue; }
            break;
          }
        }

        if(!ok){
          failed++;
          consecutiveFails++;
          if(consecutiveFails >= 5){
            log(`⛔ REPAIR ${countryName}: ${consecutiveFails} fail consecutivi — passo al prossimo paese`,"err");
            break;
          }
        }

        // Pausa standard tra download
        if(i + 1 < allToProcess.length && consecutiveFails === 0){
          const nextDelay = getNextDelay();
          await sleepWithActivity("⏳", `Pausa ${Math.round(nextDelay/1000)}s`, nextDelay);
        } else if(i + 1 < allToProcess.length && consecutiveFails > 0){
          await sleep(1000);
        }
      }

      totalProfilesUpdated += downloaded;
      log(`✅ REPAIR ${countryName}: ${downloaded} scaricati, ${failed} falliti`,"ok");

      // Pausa tra paesi
      if(ci + 1 < countries.length){
        await sleepWithActivity("⏳", `Pausa 5s — prossimo paese`, 5000);
      }
    }

    // ═══ RIEPILOGO ═══
    hideActivity();
    setProgress(1,1);
    log(`═══ REPAIR COMPLETATO ═══`,"ok");
    log(`📊 Directory aggiornata: ${totalFixed} record ora hanno network`,"ok");
    log(`📥 Profili scaricati/aggiornati: ${totalProfilesUpdated}`,"ok");
    setStatus(`Repair completato: ${totalFixed} network trovati, ${totalProfilesUpdated} profili aggiornati`, true);

    // Refresh contatori
    loadHeaderCounts();

  } catch(e){
    log(`❌ REPAIR errore globale: ${e.message}`,"err");
  } finally {
    networkRepairRunning = false;
    const btn = document.getElementById("btnRepairNet");
    if(btn){ btn.disabled = false; btn.style.opacity = "1"; }
  }
}
