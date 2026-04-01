// WCA — Network Repair v3
// Trova record directory con networks vuoti → li elimina da wca_directory
// Al prossimo download, il sistema vedrà che mancano e li riscaricherà col full discover

let networkRepairRunning = false;

async function repairNetworkOrphans(){
  if(networkRepairRunning){ log("⚠ Repair già in corso","warn"); return; }
  networkRepairRunning = true;
  const btn = document.getElementById("btnRepairNet");
  if(btn){ btn.disabled = true; btn.style.opacity = "0.5"; }

  try {
    // ═══ STEP 1: Trova orfani ═══
    log("🔍 REPAIR: Cerco record directory senza network...","ok");
    setStatus("Repair: analisi directory...", true);

    const resp = await fetch(API+"/api/partners?action=network_orphans");
    const data = await resp.json();
    if(!data.success){
      log("❌ REPAIR: errore API — " + (data.error||"unknown"),"err");
      return;
    }

    if(data.total === 0){
      log("✅ REPAIR: Nessun record senza network — directory pulita","ok");
      setStatus("Directory OK — nessun orfano", true);
      return;
    }

    // Raggruppa per paese per il log
    const byCountry = {};
    for(const o of data.orphans){
      const cc = o.country_code || "??";
      if(!byCountry[cc]) byCountry[cc] = 0;
      byCountry[cc]++;
    }

    log(`📊 REPAIR: ${data.total} record senza network in ${Object.keys(byCountry).length} paesi`,"warn");
    for(const [cc, cnt] of Object.entries(byCountry).sort((a,b) => b[1] - a[1])){
      log(`   ${countryFlag(cc)} ${cc}: ${cnt} record`);
    }

    // ═══ STEP 2: Elimina dalla directory ═══
    log(`🗑 REPAIR: Elimino ${data.total} record orfani dalla directory...`,"warn");
    setStatus(`Repair: elimino ${data.total} orfani...`, true);

    const ids = data.orphans.map(o => o.wca_id);
    // Batch da 100 (URL length limit)
    let totalDeleted = 0;
    for(let i = 0; i < ids.length; i += 100){
      const batch = ids.slice(i, i + 100);
      const delResp = await fetch(API+"/api/partners?action=delete_directory_ids&ids=" + batch.join(","));
      const delData = await delResp.json();
      if(delData.success) totalDeleted += delData.deleted;
    }

    log(`✅ REPAIR COMPLETATO: ${totalDeleted} record eliminati dalla directory`,"ok");
    log(`ℹ️ Al prossimo download, il sistema riscaricherà questi record col full discover (con network)`,"ok");
    setStatus(`Repair: ${totalDeleted} orfani rimossi — pronto per download`, true);

    loadHeaderCounts();

  } catch(e){
    log(`❌ REPAIR errore: ${e.message}`,"err");
  } finally {
    networkRepairRunning = false;
    if(btn){ btn.disabled = false; btn.style.opacity = "1"; }
  }
}
