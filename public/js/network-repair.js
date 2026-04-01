// WCA — Network Repair v4
// Un solo DELETE: elimina record directory senza network
// Il download normale li riscaricherà col full discover

async function repairNetworkOrphans(){
  const btn = document.getElementById("btnRepairNet");
  if(btn){ btn.disabled = true; btn.style.opacity = "0.5"; }

  try {
    log("🔧 REPAIR: Elimino record directory senza network...","warn");
    const resp = await fetch(API+"/api/partners?action=repair_network");
    const data = await resp.json();

    if(!data.success){
      log("❌ REPAIR: " + (data.error||"errore"),"err");
      return;
    }

    if(data.deleted === 0){
      log("✅ Nessun orfano — directory pulita","ok");
    } else {
      log(`✅ ${data.deleted} record senza network eliminati dalla directory`,"ok");
      log("ℹ️ Lancia Directory per riscaricali col full discover","ok");
    }
    loadHeaderCounts();

  } catch(e){
    log("❌ REPAIR: " + e.message,"err");
  } finally {
    if(btn){ btn.disabled = false; btn.style.opacity = "1"; }
  }
}
