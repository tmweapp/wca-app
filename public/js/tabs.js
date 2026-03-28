// WCA — Tabs (Scraped Tabs, Profile Preview)

function addScrapedTab(profile, idx){
  const bar = document.getElementById("scrapedTabsBar");
  const tab = document.createElement("div");
  const hasContactEmail = profile.contacts && profile.contacts.some(c => c.email);
  tab.className = "scraped-tab" + (idx===0?" active":"") + (profile.access_limited?" limited":"") + (!hasContactEmail?" no-email":"");
  tab.dataset.idx = idx;
  const logoHtml = profile.logo_url ? `<img src="${profile.logo_url}" onerror="this.style.display='none'">` : "";
  const limitBadge = profile.access_limited ? `<span class="access-badge limited" title="Dati contatto protetti">🔒</span>` : "";
  tab.innerHTML = `${logoHtml}<span class="tab-name">${profile.company_name||"ID "+profile.wca_id}</span>${limitBadge}`;
  tab.onclick = () => selectScrapedTab(parseInt(tab.dataset.idx));
  // Shift existing tabs indices
  bar.querySelectorAll(".scraped-tab").forEach(t=>{
    t.dataset.idx = parseInt(t.dataset.idx)+1;
    t.classList.remove("active");
  });
  bar.prepend(tab);
  document.getElementById("scrapedCount").textContent = scrapedProfiles.length;
  if(idx===0) selectScrapedTab(0);
}

function trimScrapedTabs(maxTabs){
  const bar = document.getElementById("scrapedTabsBar");
  const tabs = bar.querySelectorAll(".scraped-tab");
  if(tabs.length > maxTabs){
    for(let t = tabs.length - 1; t >= maxTabs; t--) tabs[t].remove();
  }
}

function refreshScrapedTab(idx, profile){
  const bar = document.getElementById("scrapedTabsBar");
  const tab = bar.querySelector(`.scraped-tab[data-idx="${idx}"]`);
  if(!tab) return;
  tab.classList.remove("limited");
  const logoHtml = profile.logo_url ? `<img src="${profile.logo_url}" onerror="this.style.display='none'">` : "";
  const enrichBadge = profile.enriched_from ? `<span class="access-badge full" title="Arricchito da ${profile.enriched_from}">✓</span>` : "";
  tab.innerHTML = `${logoHtml}<span class="tab-name">${profile.company_name||"ID "+profile.wca_id}</span>${enrichBadge}`;
  tab.onclick = () => selectScrapedTab(idx);
  if(activeTabIdx === idx) showScrapedProfile(profile);
}

function selectScrapedTab(idx){
  activeTabIdx = idx;
  document.querySelectorAll(".scraped-tab").forEach(t=>{
    t.classList.toggle("active", parseInt(t.dataset.idx)===idx);
  });
  showScrapedProfile(scrapedProfiles[idx]);
}

function showScrapedProfile(p){
  if(!p) return;
  const el = document.getElementById("profilePreview");
  el.classList.add("visible");
  const logoImg = p.logo_url ? `<img class="logo" src="${p.logo_url}" onerror="this.style.display='none'">` : "";
  const gmBadge = p.gm_coverage === true ? '<span class="gm-badge covered">GM Covered</span>' :
                  p.gm_coverage === false ? '<span class="gm-badge not-covered">GM Not Covered</span>' : "";

  const accessBadge = p.access_limited ? `<span class="access-badge limited">🔒 ACCESSO LIMITATO</span>` :
                      (p.email || (p.contacts && p.contacts.some(c=>c.email))) ? `<span class="access-badge full">✓ DATI COMPLETI</span>` : "";
  const enrichedBadge = p.enriched_from ? `<span class="access-badge full" style="font-size:.6rem">arricchito da ${esc(p.enriched_from)}</span>` : "";
  let html = `<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">`;
  html += `<h3 style="flex:1">${logoImg} ${esc(p.company_name)} ${gmBadge} ${accessBadge} ${enrichedBadge}</h3>`;
  html += `<button class="btn btn-sm btn-secondary" onclick="refreshSingleProfile(${p.wca_id})" data-tip="Riscarica questo profilo da WCA per aggiornare i dati">Aggiorna</button>`;
  html += `</div>`;
  if(p.access_limited) html += `<div style="background:rgba(245,158,11,0.1);color:#fcd34d;padding:8px 12px;border-radius:8px;font-size:.78rem;margin-bottom:10px;border:1px solid rgba(245,158,11,0.2)">Accesso limitato — i contatti richiedono credenziali dedicate per questo network.</div>`;
  html += `<div class="info-grid">`;
  html += infoRow("WCA ID", p.wca_id);
  html += infoRow("Branch", p.branch);
  html += infoRow("Indirizzo", p.address);
  html += infoRow("Mailing", p.mailing);
  html += infoRow("Telefono", p.phone);
  html += infoRow("Fax", p.fax);
  html += infoRow("Emergenza", p.emergency_call);
  html += infoRow("Email", p.email ? `<a href="mailto:${esc(p.email)}" style="color:#38bdf8">${esc(p.email)}</a>` : "");
  html += infoRow("Sito Web", p.website ? `<a href="${esc(p.website)}" target="_blank" style="color:#38bdf8">${esc(p.website)}</a>` : "");
  html += infoRow("Membro dal", p.enrolled_since);
  html += infoRow("Scadenza", p.expires);
  html += `</div>`;

  if(p.gm_status_text) html += `<div style="font-size:.78rem;color:var(--text-muted);margin:6px 0;padding:6px;background:rgba(255,255,255,0.03);border-radius:6px;border:1px solid rgba(255,255,255,0.05)">${esc(p.gm_status_text)}</div>`;
  if(p.profile_text) html += `<div style="font-size:.82rem;color:#cbd5e1;margin:8px 0;white-space:pre-line">${esc(p.profile_text)}</div>`;

  if(p.networks && p.networks.length){
    html += `<div class="section-title">Network</div><div class="tags">`;
    for(const n of p.networks) html += `<span class="tag">${esc(n)}</span>`;
    html += `</div>`;
  }

  if(p.enrolled_offices && p.enrolled_offices.length){
    html += `<div class="section-title">Uffici (${p.enrolled_offices.length})</div><div class="tags">`;
    for(const o of p.enrolled_offices){
      const cls = o.covered ? "covered" : "not-covered";
      html += `<span class="tag"><span class="gm-badge ${cls}" style="font-size:.65rem">${o.covered?"✓":"✗"}</span> ${esc(o.location)}</span>`;
    }
    html += `</div>`;
  }

  if(p.contacts && p.contacts.length){
    html += `<div class="section-title">Contatti (${p.contacts.length})</div>`;
    for(const c of p.contacts){
      html += `<div class="contact-card">`;
      if(c.name) html += `<strong>${esc(c.name)}</strong>`;
      if(c.title && c.title !== c.name) html += ` - ${esc(c.title)}`;
      html += `<br>`;
      if(c.email) html += `Email: <a href="mailto:${esc(c.email)}" style="color:#38bdf8">${esc(c.email)}</a><br>`;
      if(c.direct_line) html += `Tel: ${esc(c.direct_line)}<br>`;
      if(c.mobile) html += `Mobile: ${esc(c.mobile)}<br>`;
      if(c.fax) html += `Fax: ${esc(c.fax)}<br>`;
      html += `</div>`;
    }
  }

  if(p.services && p.services.length){
    html += `<div class="section-title">Servizi</div><div class="tags">`;
    for(const s of p.services) html += `<span class="tag">${esc(s)}</span>`;
    html += `</div>`;
  }

  if(p.certifications && p.certifications.length){
    html += `<div class="section-title">Certificazioni</div><div class="tags">`;
    for(const c of p.certifications) html += `<span class="tag">${esc(c)}</span>`;
    html += `</div>`;
  }

  if(p.branch_cities && p.branch_cities.length){
    html += `<div class="section-title">Città Filiali</div><div class="tags">`;
    for(const c of p.branch_cities) html += `<span class="tag">${esc(c)}</span>`;
    html += `</div>`;
  }

  el.innerHTML = html;
}

function infoRow(label, val){
  if(!val && val!==0) return "";
  return `<span class="lbl">${label}</span><span class="val">${typeof val==="string" && val.includes("<")? val : esc(String(val))}</span>`;
}

// esc() is defined in utils.js
// refreshSingleProfile() is defined in export.js
