// UI Network Module — active network badge display

// === NETWORK BADGE — logo + nome network attivo ===
function setActiveNetwork(networkDomain, networkName){
  const badge = document.getElementById("activeNetworkBadge");
  const logo = document.getElementById("activeNetworkLogo");
  const nameEl = document.getElementById("activeNetworkName");
  if(!networkDomain && !networkName){ badge.style.display = "none"; return; }
  const net = ALL_NETWORKS.find(n => n.domain === networkDomain || n.name === networkName);
  const domain = networkDomain || "wcaworld.com";
  if(net && net.logo){ logo.src = net.logo; }
  else { logo.src = `https://www.google.com/s2/favicons?domain=${domain}&sz=64`; }
  logo.alt = networkName || domain;
  logo.style.display = "block";
  nameEl.textContent = networkName || domain;
  badge.style.display = "flex";
}

function hideActiveNetwork(){
  document.getElementById("activeNetworkBadge").style.display = "none";
}
