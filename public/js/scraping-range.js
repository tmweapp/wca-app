// ═══════════════════════════════════════════════════════════════════════════════
// SCRAPING RANGE — Download profiles by ID range
// Scrapes individual IDs within specified range with delay between requests
// ═══════════════════════════════════════════════════════════════════════════════

async function scrapeRange(){
  const from = parseInt(document.getElementById("txtRangeFrom").value)||1;
  const to = parseInt(document.getElementById("txtRangeTo").value)||500;
  const total = to - from + 1;
  log(`Scraping range ${from}-${to} (${total} IDs)`);

  for(let id=from; id<=to && scraping; id++){
    setStatus(`Scraping ID ${id} (${id-from+1}/${total})`, true);
    setProgress(id-from+1, total);
    await scrapeOne(id);
    if(id < to && scraping){
      const d = getNextDelay();
      log(`⏱ Pausa ${(d/1000).toFixed(0)}s...`);
      await sleep(d);
    }
  }
}

async function scrapeOne(wcaId, memberInfo){
  try{
    const body = {cookies:sessionCookies, wcaIds:[wcaId]};
    if(memberInfo && memberInfo.href) body.members = [{id:wcaId, href:memberInfo.href}];
    const resp = await fetch(API+"/api/scrape",{
      method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify(body)
    });
    const data = await resp.json();
    if(!data.success){log(`Errore scrape ${wcaId}: ${data.error}`,"err");return;}
    for(const profile of (data.results||[])){
      if(profile.state==="ok"){
        scrapedProfiles.unshift(profile);
        addScrapedTab(profile, 0);
        const dbg = profile._debug ? ` [loginLinks=${profile._debug.loginLinks} membersOnly=${profile._debug.membersOnly} contacts=${profile._debug.contactSection} cookieLen=${profile._debug.cookieLen} keys=${profile._debug.cookieKeys}]` : "";
        log(`OK: ${profile.company_name} (${wcaId}) contatti:${profile.contacts?.length||0}${dbg}`,"ok");
        await saveToSupabase(profile);
        updateResultRow(wcaId, "ok");
      } else if(profile.state==="not_found"){
        log(`Non trovato: ${wcaId} → aggiunto alla lista verifica`,"warn");
        addFailedProfile(wcaId);
        updateResultRow(wcaId, "not_found");
      } else if(profile.state==="login_redirect"){
        log(`Sessione scaduta per ${wcaId}, rifai login`,"err");
        scraping = false;
        updateResultRow(wcaId, "login_redirect");
      } else {
        log(`Stato ${profile.state} per ${wcaId}: ${profile.error||""}`,"warn");
        updateResultRow(wcaId, profile.state);
      }
    }
  } catch(e){
    log(`Eccezione scrape ${wcaId}: ${e.message}`,"err");
  }
}
