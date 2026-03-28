// WCA — Export Functions

async function refreshSingleProfile(wcaId){
  log(`Aggiornamento profilo ${wcaId}...`);
  const btn = event?.target;
  if(btn){ btn.disabled = true; btn.textContent = "⏳..."; }
  try {
    const resp = await fetch(API+"/api/scrape",{
      method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({wcaIds:[wcaId]})
    });
    const data = await resp.json();
    if(!data.success){
      log(`Errore aggiornamento ${wcaId}: ${data.error}`,"err");
      if(btn){ btn.disabled = false; btn.textContent = "↻ Aggiorna"; }
      return;
    }
    const profile = data.results?.[0];
    if(profile && profile.state === "ok"){
      // Aggiorna nell'array locale
      const idx = scrapedProfiles.findIndex(p => p.wca_id === wcaId);
      if(idx >= 0){
        scrapedProfiles[idx] = profile;
        refreshScrapedTab(idx, profile);
      } else {
        scrapedProfiles.unshift(profile);
        addScrapedTab(profile, 0);
      }
      // Salva in Supabase
      await saveToSupabase(profile);
      log(`✓ Profilo ${profile.company_name} (${wcaId}) aggiornato — contatti:${profile.contacts?.length||0}`,"ok");
      showScrapedProfile(profile);
    } else {
      log(`Profilo ${wcaId}: stato ${profile?.state || "errore"}`,"warn");
    }
  } catch(e){
    log(`Errore aggiornamento: ${e.message}`,"err");
  }
  if(btn){ btn.disabled = false; btn.textContent = "↻ Aggiorna"; }
}

function exportJSON(){
  if(!scrapedProfiles.length){log("Nessun profilo da esportare","warn");return;}
  const blob = new Blob([JSON.stringify(scrapedProfiles,null,2)],{type:"application/json"});
  downloadBlob(blob, "wca_partners_"+dateStr()+".json");
  log("Esportati "+scrapedProfiles.length+" profili in JSON","ok");
}

function exportCSV(){
  if(!scrapedProfiles.length){log("Nessun profilo da esportare","warn");return;}
  const headers = ["wca_id","company_name","branch","address","mailing","phone","fax","emergency_call","email","website",
    "enrolled_since","expires","gm_coverage","gm_status_text","networks","services","certifications","branch_cities",
    "contacts_names","contacts_emails","contacts_phones","profile_text","logo_url"];
  let csv = headers.join(",")+"\n";
  for(const p of scrapedProfiles){
    const row = [
      p.wca_id, q(p.company_name), q(p.branch), q(p.address), q(p.mailing), q(p.phone), q(p.fax), q(p.emergency_call),
      q(p.email), q(p.website), q(p.enrolled_since), q(p.expires), p.gm_coverage, q(p.gm_status_text),
      q((p.networks||[]).join("; ")), q((p.services||[]).join("; ")), q((p.certifications||[]).join("; ")),
      q((p.branch_cities||[]).join("; ")),
      q((p.contacts||[]).map(c=>c.name||"").join("; ")),
      q((p.contacts||[]).map(c=>c.email||"").join("; ")),
      q((p.contacts||[]).map(c=>c.direct_line||c.mobile||"").join("; ")),
      q(p.profile_text), q(p.logo_url)
    ];
    csv += row.join(",")+"\n";
  }
  const blob = new Blob(["\ufeff"+csv],{type:"text/csv;charset=utf-8"});
  downloadBlob(blob, "wca_partners_"+dateStr()+".csv");
  log("Esportati "+scrapedProfiles.length+" profili in CSV","ok");
}

function q(s){if(!s)return '""';s=String(s);return '"'+s.replace(/"/g,'""')+'"';}
function dateStr(){return new Date().toISOString().slice(0,10).replace(/-/g,"");}
function downloadBlob(blob,name){const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=name;a.click();}
