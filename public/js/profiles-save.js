// WCA — Profiles Save

// ═════════════════════════════════════════════════════════════════
// === SAVE PROFILE TO SUPABASE ===
// ═════════════════════════════════════════════════════════════════
async function saveToSupabase(profile){
  try{
    if(currentScrapingCountry && !profile.country_code) profile.country_code = currentScrapingCountry;
    const resp = await fetch(API+"/api/save",{
      method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({profile})
    });
    const data = await resp.json();
    if(!data.success){
      log(`⚠️ Save fallito ${profile.wca_id}: ${data.error}`,"warn");
    } else {
      // Aggiorna conteggio bandiere in tempo reale
      incrementPartnerCount(profile.country_code);
    }
  } catch(e){log(`❌ Errore save ${profile.wca_id}: ${e.message}`,"err");}
}
