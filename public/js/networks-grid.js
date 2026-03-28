// WCA — Networks Grid

function initNetworksGrid(){
  const g = document.getElementById("networksGrid");
  if(!g){ console.warn("[init] networksGrid non trovato, ritento..."); setTimeout(initNetworksGrid, 200); return; }
  if(g.children.length > 0) return; // già popolato
  // Pulisci vecchi test
  try { localStorage.removeItem("wca_network_results"); localStorage.removeItem("wca_network_groups"); } catch(e){}
  for(const [name, siteId] of Object.entries(NETWORKS)){
    const net = ALL_NETWORKS.find(n => n.siteId === siteId);
    const logoHtml = net ? `<img src="${net.logo}" style="width:24px;height:24px;object-fit:contain;border-radius:3px;vertical-align:middle;margin-right:4px" onerror="this.style.display='none'">` : '';
    const lbl = document.createElement("label");
    lbl.innerHTML = `<input type="checkbox" value="${name}"> ${logoHtml}${name}`;
    g.appendChild(lbl);
  }
  attachNetworkCountListeners();
  updateNetworkSelCount();
  console.log("[init] networksGrid popolato con", Object.keys(NETWORKS).length, "network");
}

function getSelectedNetworks(){
  const checks = document.querySelectorAll("#networksGrid input:checked");
  return Array.from(checks).map(c=>c.value);
}

function getSelectedNetworkObjects(){
  // Legge i network selezionati dalla checkbox grid, ritorna [{domain, name}]
  // IMPORTANTE: cb.value contiene il nome da NETWORKS{} (es. "WCA eCommerce Solutions")
  // che può differire dal nome in ALL_NETWORKS (es. "WCA eCommerce").
  // Usiamo siteId come ponte sicuro tra le due strutture.
  const checked = document.querySelectorAll("#networksGrid input[type=checkbox]:checked");
  const selected = [];
  checked.forEach(cb => {
    const siteId = NETWORKS[cb.value]; // NETWORKS[name] → siteId
    if(siteId !== undefined){
      const net = ALL_NETWORKS.find(n => n.siteId === siteId);
      if(net){
        selected.push({ domain: net.domain, name: net.name, siteId: net.siteId });
      }
    }
  });
  return selected;
}

function updateNetworkSelCount(){
  const cnt = document.querySelectorAll("#networksGrid input[type=checkbox]:checked").length;
  // Popup count
  const el = document.getElementById("networkSelCount");
  if(el){
    el.textContent = cnt > 0 ? cnt + " selezionati" : "0 selezionati";
    el.style.color = cnt > 0 ? "#6ee7b7" : "var(--text-muted)";
    el.style.background = cnt > 0 ? "rgba(16,185,129,0.12)" : "rgba(255,255,255,0.04)";
  }
  // Inline count in networkModePanel
  const inl = document.getElementById("networkSelCountInline");
  if(inl){
    inl.textContent = cnt > 0 ? cnt + " selezionati" : "0 selezionati";
    inl.style.color = cnt > 0 ? "#6ee7b7" : "var(--text-muted)";
  }
  // Badge on trigger icon button
  const badge = document.getElementById("networkSelBadge");
  if(badge){
    if(cnt > 0){ badge.textContent = cnt; badge.style.display = "block"; }
    else { badge.style.display = "none"; }
  }
}

function attachNetworkCountListeners(){
  document.querySelectorAll("#networksGrid input[type=checkbox]").forEach(cb => {
    cb.addEventListener("change", updateNetworkSelCount);
  });
}

// Osserva quando networksGrid viene popolato
const _nGridObs = new MutationObserver(()=>{ attachNetworkCountListeners(); updateNetworkSelCount(); });
setTimeout(()=>{
  const ng = document.getElementById("networksGrid");
  if(ng) _nGridObs.observe(ng, {childList:true});
}, 500);
