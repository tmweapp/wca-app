// WCA — Directory Full

// ═══ FULL DIRECTORY con mappatura network (per scraping — fase 1) ═══
// Loop su tutti i network per sapere dove è presente ogni membro
async function discoverFullDirectory(countryCode, countryName, forceRefresh = false){
  const MAX_DIR_AGE = 24;
  const cached = getFullDirectory(countryCode);
  if(cached && !forceRefresh && getFullDirAge(countryCode) < MAX_DIR_AGE){
    log(`📂 Directory ${countryName} da cache (${cached.members.length} membri) — ${Math.round(getFullDirAge(countryCode))}h fa`,"ok");
    return cached;
  }

  log(`🔍 Directory completa ${countryName} (per-network)...`,"ok");
  showActivity("🔍", `Directory ${countryName}...`);

  const memberMap = {};
  const networkCounts = {};
  const selectedNetNames = getSelectedNetworks();
  const selectedSiteIds = new Set(selectedNetNames.map(name => NETWORKS[name]).filter(id => id !== undefined));
  // Solo network scansionabili (escludi badge con siteId=0)
  const SCANNABLE = ALL_NETWORKS.filter(n => n.siteId > 0);
  const networksToScan = selectedSiteIds.size > 0
    ? SCANNABLE.filter(n => selectedSiteIds.has(n.siteId))
    : SCANNABLE;

  for(let ni = 0; ni < networksToScan.length && scraping; ni++){
    const network = networksToScan[ni];
    setStatus(`Directory ${countryName}: ${network.name} (${ni+1}/${networksToScan.length})...`, true);
    showActivity("🔍", `${network.name} ${ni+1}/${networksToScan.length}`);

    try {
      const resp = await fetch(API+"/api/discover-network",{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({ networkDomain: network.domain, country: countryCode })
      });
      const data = await resp.json();
      if(data.success && data.members){
        networkCounts[network.domain] = data.members.length;
        for(const m of data.members){
          if(!memberMap[m.id]){
            memberMap[m.id] = { id: m.id, name: m.name, href: m.href, networks: [network.domain] };
          } else {
            if(!memberMap[m.id].networks.includes(network.domain)) memberMap[m.id].networks.push(network.domain);
            if(m.href && !memberMap[m.id].href) memberMap[m.id].href = m.href;
          }
        }
        log(`   ${network.name}: ${data.members.length} membri`);
      }
    } catch(e){
      log(`   ⚠ ${network.name}: errore — ${e.message}`,"warn");
    }

    if(ni + 1 < networksToScan.length && scraping){
      const nextDelay = getNextDelay();
      await sleepWithActivity("🔍", `Pausa ${Math.round(nextDelay/1000)}s — prossimo network`, nextDelay);
    }
  }

  const members = Object.values(memberMap);
  const result = { members, networks: networkCounts, ts: Date.now() };
  saveFullDirectory(countryCode, result);
  log(`📂 Directory ${countryName}: ${members.length} membri unici su ${Object.keys(networkCounts).length} network`,"ok");

  let dir = getDirectory(countryCode);
  if(!dir) dir = createDirectory(countryCode, members.map(m => m.id));
  else {
    let updated = false;
    for(const m of members){
      if(!(String(m.id) in dir.ids)){ dir.ids[String(m.id)] = "pending"; updated = true; }
    }
    if(updated){ dir.total = Object.keys(dir.ids).length; saveDirectory(countryCode, dir); }
  }

  // ═══ SALVA IN SUPABASE (con network reali) ═══
  if(members.length > 0){
    try {
      const saveResp = await fetch(API+"/api/save-directory",{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({ countryCode, members })
      });
      const saveData = await saveResp.json();
      if(saveData.success){
        log(`💾 DB: ${countryName} — ${saveData.saved} salvati in Supabase (con network)`,"ok");
        const stats = await refreshDbCounters();
        showDbFlash(countryCode, saveData.saved, stats || 0);
      }
    } catch(e){ log(`⚠ DB save: ${e.message}`,"warn"); }
  }

  return result;
}
