// WCA — Test Download Functions

async function testAllNetworks(){
  const btn = document.getElementById("btnTestNets");
  const status = document.getElementById("netTestStatus");
  btn.disabled = true;
  status.textContent = "Testing...";
  const labels = document.querySelectorAll("#networksGrid label");

  for(const net of ALL_NETWORKS){
    status.textContent = `Testing ${net.name}...`;
    try {
      const resp = await fetch(API+"/api/discover-network",{
        method:"POST",headers:{"Content-Type":"application/json"},
        body:JSON.stringify({ networkDomain: net.domain, country: "US" })
      });
      const data = await resp.json();
      // Trova la label corrispondente
      labels.forEach(lbl => {
        const cb = lbl.querySelector("input");
        if(!cb) return;
        // Match per nome o dominio
        const netName = cb.value;
        const matchNet = ALL_NETWORKS.find(n => n.name === netName || Object.entries(NETWORKS).find(([k,v]) => k === netName)?.[0] === netName);
        if(matchNet && matchNet.domain === net.domain){
          const oldBadge = lbl.querySelector(".net-badge");
          if(oldBadge) oldBadge.remove();
          const badge = document.createElement("span");
          badge.className = "net-badge";
          badge.style.cssText = `font-size:.6rem;color:#fff;padding:1px 5px;border-radius:4px;margin-left:4px;background:${data.success ? "#059669" : "#dc2626"}`;
          badge.textContent = data.success ? `OK (${data.members?.length||0})` : data.error||"ERRORE";
          lbl.appendChild(badge);
        }
      });
    } catch(e){
      console.warn(`Test ${net.name} error:`, e.message);
    }
    // Piccola pausa tra test
    await new Promise(r => setTimeout(r, 2000));
  }
  btn.disabled = false;
  status.textContent = "Test completato!";
}

async function testDownloadProfile(){
  const wcaId = prompt("WCA ID da testare (es. 12345):");
  if(!wcaId) return;
  const networkDomain = prompt("Dominio network (es. wcaecommercesolutions.com)\nLascia vuoto per wcaworld.com:") || "";

  const status = document.getElementById("netTestStatus");
  const btn = document.getElementById("btnTestDL");
  btn.disabled = true;
  status.textContent = "Test in corso...";
  log(`🧪 TEST DOWNLOAD: wcaId=${wcaId} network=${networkDomain||"wcaworld.com"}`);

  try {
    const resp = await fetch(API+"/api/test-download",{
      method:"POST",headers:{"Content-Type":"application/json"},
      body:JSON.stringify({ wcaId: parseInt(wcaId), networkDomain: networkDomain || undefined })
    });
    const data = await resp.json();

    if(data.success){
      const p = data.profile;
      log(`✅ TEST OK: ${p.company_name} (${p.wca_id})`,"ok");
      log(`   📞 Telefono: ${p.phone||"(vuoto)"}`);
      log(`   📧 Email: ${p.email||"(vuoto)"}`);
      log(`   🌐 Networks: ${p.networks?.join(", ")||"(nessuno)"}`);
      log(`   👤 Contatti: ${p.contacts?.length||0}`);
      if(p.contacts?.length > 0){
        for(const c of p.contacts){
          log(`      → ${c.name||"?"} | ${c.email||""} | ${c.title||""} | ${c.direct_line||""}`);
        }
      }
      log(`   🔑 Auth: ${data.authMethod} | ⏱ ${data.elapsed}ms`);
      log(`   Access limited: ${p.access_limited}`);
      status.textContent = `✅ ${p.company_name}: ${p.contacts?.length||0} contatti, ${data.elapsed}ms`;

      // Log diagnostica
      if(data.diagnostics){
        const d = data.diagnostics;
        log(`   📊 Diagnostica: labels=${d.profileLabels} vals=${d.profileVals} rows=${d.profileRows} contactRows=${d.contactPersonRows} mailto=${d.mailtoLinks}`);
        log(`   📊 hasLogout=${d.hasLogout} hasMembersOnly=${d.hasMembersOnly} hasOfficeContacts=${d.hasOfficeContacts}`);
        if(d.contactClasses?.length > 0) log(`   📊 Classi contatto: ${d.contactClasses.join(", ")}`);
      }
    } else {
      log(`❌ TEST FALLITO: ${data.error} — ${data.detail||""}`,"err");
      status.textContent = `❌ ${data.error}`;
      if(data.log){
        for(const l of data.log) log(`   📋 ${l}`);
      }
    }
  } catch(e){
    log(`❌ Errore test: ${e.message}`,"err");
    status.textContent = `❌ ${e.message}`;
  }
  btn.disabled = false;
}

async function testNoNetworkDownload(wcaId, memberHref){
  try {
    log(`🧪 TEST NO NETWORK: ${wcaId} da wcaworld.com...`,"info");

    const body = {
      wcaIds: [wcaId],
      members: memberHref ? [{id: wcaId, href: memberHref}] : [],
      networkDomain: "wcaworld.com"  // Sempre wcaworld.com per test NO NETWORK
    };

    const resp = await fetch(API+"/api/scrape", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify(body)
    });

    const data = await resp.json();
    if(!data.success){
      log(`❌ TEST FAILED: ${data.error}`,"err");
      return { ok: false, error: data.error };
    }

    const profile = data.results?.[0];
    if(!profile){
      log(`❌ TEST: nessun profilo ritornato`,"err");
      return { ok: false, error: "no_result" };
    }

    const hasContacts = profile.contacts && profile.contacts.length > 0;
    const hasEmail = !!profile.email;
    const isLimited = profile.access_limited;

    log(`🧪 TEST RISULTATO ${wcaId}:`, "info");
    log(`   State: ${profile.state}`, "info");
    log(`   Access Limited: ${isLimited}`, "info");
    log(`   Contatti: ${profile.contacts?.length || 0}`, "info");
    log(`   Email aziendale: ${hasEmail ? profile.email : "NO"}`, "info");
    log(`   Company: ${profile.company_name}`, "info");
    log(`   Networks nel profilo: ${profile.networks?.join(", ") || "NONE"}`, "info");

    return {
      ok: profile.state === "ok",
      wcaId,
      company: profile.company_name,
      state: profile.state,
      access_limited: isLimited,
      contacts_count: profile.contacts?.length || 0,
      has_email: hasEmail,
      networks: profile.networks || []
    };
  } catch(e){
    log(`❌ TEST ERROR: ${e.message}`,"err");
    return { ok: false, error: e.message };
  }
}
