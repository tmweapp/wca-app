// WCA — Network Repair v2
// Trova profili mancanti (in directory ma non in profiles) e record senza network
// Per i senza network: riesegue full discover
// Per i mancanti: scarica i profili con pause standard

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
    // ═══ STEP 1: Chiedi al server la lista profili mancanti ═══
    log("🔍 REPAIR: Cerco profili mancanti (directory vs profiles)...","ok");
    setStatus("Repair: analisi gap directory ↔ profiles...", true);

    const resp = await fetch(API+"/api/partners?action=network_orphans");
    const data = await resp.json();
    if(!data.success){
      log("❌ REPAIR: errore API — " + (data.error||"unknown"),"err");
      return;
    }

    const byCountry = data.byCountry;
    const countries = Object.keys(byCountry).filter(cc => cc.length === 2 && /^[A-Z]{2}$/.test(cc));

    if(data.totalMissing === 0 && data.totalNoNetwork === 0){
      log("✅ REPAIR: Nessun profilo mancante e nessun orfano di network — tutto OK","ok");
      setStatus("Nessun profilo da riparare", true);
      return;
    }

    // Mappa codice → nome paese
    const countryList = getAllCountryList();
    const ccNameMap = {};
    for(const c of countryList) ccNameMap[c.code] = c.name;

    log(`📊 REPAIR: ${data.totalMissing} profili mancanti, ${data.totalNoNetwork} senza network, ${data.totalProfiles} già scaricati`,"warn");

    let totalDownloaded = 0;
    let totalFailed = 0;
    let totalNetworkFixed = 0;

    for(let ci = 0; ci < countries.length; ci++){
      const cc = countries[ci];
      const info = byCountry[cc];
      const missingList = info.missing || [];
      const noNetCount = info.noNetwork || 0;
      const countryName = ccNameMap[cc] || cc;

      if(missingList.length === 0 && noNetCount === 0) continue;

      log(`═══ REPAIR ${ci+1}/${countries.length}: ${countryFlag(cc)} ${countryName} — ${missingList.length} mancanti, ${noNetCount} senza network ═══`,"ok");
      setStatus(`Repair ${ci+1}/${countries.length}: ${countryName}`, true);
      showActivity("🔧", `${countryName} ${ci+1}/${countries.length}`);

      // ═══ STEP 2a: Se ci sono record senza network, riesegui full discover ═══
      if(noNetCount > 0){
        log(`🔍 ${countryName}: ${noNetCount} record senza network — lancio full discover...`,"warn");
        try {
          const fullDir = await discoverFullDirectory(cc, countryName, true);
          if(fullDir && fullDir.members){
            const withNet = fullDir.members.filter(m => m.networks && m.networks.length > 0).length;
            log(`📂 ${countryName}: full discover completato — ${withNet}/${fullDir.members.length} con network`,"ok");
            totalNetworkFixed += Math.min(noNetCount, withNet);
          }
        } catch(e){
          log(`⚠ ${countryName}: errore full discover — ${e.message}`,"warn");
        }
      }

      // ═══ STEP 2b: Scarica profili mancanti ═══
      if(missingList.length === 0){
        if(ci + 1 < countries.length) await sleepWithActivity("⏳", "Pausa 3s", 3000);
        continue;
      }

      // Carica directory aggiornata da Supabase per avere scrape_url e network
      let dirMembers = [];
      try {
        const dirData = await loadDirectoryFromSupabase(cc);
        if(dirData && dirData.members) dirMembers = dirData.members;
      } catch(e){}

      // Mappa id → membro directory per avere href/scrape_url/networks
      const dirMap = {};
      for(const m of dirMembers) dirMap[m.id] = m;

      let downloaded = 0;
      let failed = 0;
      let consecutiveFails = 0;

      log(`📥 ${countryName}: scarico ${missingList.length} profili mancanti...`,"ok");

      for(let i = 0; i < missingList.length; i++){
        const item = missingList[i];
        const member = dirMap[item.wca_id] || { id: item.wca_id, name: item.company_name, networks: [], href: `/directory/members/${item.wca_id}` };

        const bestNet = (member.networks && member.networks.length > 0) ? member.networks[0] : "wcaworld.com";
        const netInfo = ALL_NETWORKS.find(n => n.domain === bestNet);
        const netName = netInfo?.name || bestNet;

        setStatus(`Repair ${countryName} ${i+1}/${missingList.length} — ${member.name||item.company_name||item.wca_id}`, true);
        setProgress(i, missingList.length);
        showActivity("📥", `${netName} ${i+1}/${missingList.length}`);

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
                wcaIds:[member.id || item.wca_id],
                members: profileHref ? [{id: member.id || item.wca_id, href: profileHref}] : [],
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
        if(i + 1 < missingList.length && consecutiveFails === 0){
          const nextDelay = getNextDelay();
          await sleepWithActivity("⏳", `Pausa ${Math.round(nextDelay/1000)}s`, nextDelay);
        } else if(i + 1 < missingList.length && consecutiveFails > 0){
          await sleep(1000);
        }
      }

      totalDownloaded += downloaded;
      totalFailed += failed;
      log(`✅ REPAIR ${countryName}: ${downloaded} scaricati, ${failed} falliti`,"ok");

      // Pausa tra paesi
      if(ci + 1 < countries.length){
        await sleepWithActivity("⏳", "Pausa 5s — prossimo paese", 5000);
      }
    }

    // ═══ RIEPILOGO ═══
    hideActivity();
    setProgress(1,1);
    log(`═══ REPAIR COMPLETATO ═══`,"ok");
    log(`📊 Network fixati: ${totalNetworkFixed} | Profili scaricati: ${totalDownloaded} | Falliti: ${totalFailed}`,"ok");
    setStatus(`Repair: ${totalDownloaded} scaricati, ${totalNetworkFixed} network fixati`, true);

    loadHeaderCounts();

  } catch(e){
    log(`❌ REPAIR errore globale: ${e.message}`,"err");
  } finally {
    networkRepairRunning = false;
    const btn = document.getElementById("btnRepairNet");
    if(btn){ btn.disabled = false; btn.style.opacity = "1"; }
  }
}
