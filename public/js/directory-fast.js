// WCA — Directory Fast

// ═══ FAST DIRECTORY: UNA sola chiamata per paese (per syncAllDirectories) ═══
// Legge wcaworld.com con pageSize=500 — prende tutti i membri in un colpo
// NON mappa i network — è solo per avere la lista ID velocemente

async function discoverFastDirectory(countryCode, countryName){
  const allMembers = [];
  let page = 1;
  let hasMore = true;
  let retries = 0;
  const MAX_RETRIES = 3;

  while(hasMore && scraping){
    try {
      const resp = await fetch(API+"/api/discover-global",{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({ country: countryCode, page })
      });
      const data = await resp.json();
      if(data.success && data.members && data.members.length > 0){
        retries = 0; // reset retries on success
        for(const m of data.members){
          const existing = allMembers.find(x => x.id === m.id);
          if(!existing){
            allMembers.push({ id: m.id, name: m.name, href: m.href, networks: m.networks || [] });
          } else if(m.networks && m.networks.length > 0){
            for(const n of m.networks){ if(!existing.networks.includes(n)) existing.networks.push(n); }
          }
        }
        hasMore = data.hasNext;
        page++;
        if(hasMore){
          setStatus(`📂 ${countryName}: ${allMembers.length} membri (p.${page})...`, true);
          const nextDelay = getNextDirDelay();
          await sleepWithActivity("📂", `Pausa ${Math.round(nextDelay/1000)}s — prossima pagina`, nextDelay);
        }
      } else {
        hasMore = false;
      }
    } catch(e){
      retries++;
      if(retries < MAX_RETRIES){
        log(`   ⚠ ${countryName} p.${page}: errore (tentativo ${retries}/${MAX_RETRIES}) — ${e.message}`,"warn");
        await sleep(5000 * retries); // attesa crescente: 5s, 10s, 15s
      } else {
        log(`   ❌ ${countryName} p.${page}: fallito dopo ${MAX_RETRIES} tentativi — ${e.message}`,"warn");
        hasMore = false;
      }
    }
  }

  // Calcola conteggi network dai dati estratti
  const networkCounts = {};
  for(const m of allMembers){
    if(m.networks) for(const n of m.networks){ networkCounts[n] = (networkCounts[n]||0) + 1; }
  }
  const result = { members: allMembers, networks: networkCounts, ts: Date.now() };
  saveFullDirectory(countryCode, result);

  // Aggiorna directory locale
  let dir = getDirectory(countryCode);
  if(!dir) dir = createDirectory(countryCode, allMembers.map(m => m.id));
  else {
    let updated = false;
    for(const m of allMembers){
      if(!(String(m.id) in dir.ids)){ dir.ids[String(m.id)] = "pending"; updated = true; }
    }
    if(updated){ dir.total = Object.keys(dir.ids).length; saveDirectory(countryCode, dir); }
  }

  // ═══ SALVA IN SUPABASE ═══
  if(allMembers.length > 0){
    try {
      const saveResp = await fetch(API+"/api/save-directory",{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({ countryCode, members: allMembers })
      });
      const saveData = await saveResp.json();
      if(saveData.success){
        log(`💾 DB: ${countryName} — ${saveData.saved} salvati in Supabase`,"ok");
        // Aggiorna contatori DB in tempo reale
        const stats = await refreshDbCounters();
        showDbFlash(countryCode, saveData.saved, stats || 0);
      } else {
        log(`⚠ DB: ${countryName} — errore salvataggio: ${saveData.error||"unknown"}`,"warn");
      }
    } catch(e){ log(`⚠ DB save error ${countryName}: ${e.message}`,"warn"); }
  }

  return result;
}
