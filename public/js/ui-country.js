// UI Country Module — completed networks display and country completion tracking

// === COMPLETED NETWORKS ROW — loghi che si accumulano ===
let completedNetworkLogos = []; // [{domain, name, logo}]

function resetCompletedNetworks(){
  completedNetworkLogos = [];
  const row = document.getElementById("completedNetworksRow");
  if(row) row.innerHTML = "";
}

function addCompletedNetworkLogo(networkDomain, networkName){
  if(completedNetworkLogos.find(n => n.domain === networkDomain && n.name === networkName)) return;
  const net = ALL_NETWORKS.find(n => n.domain === networkDomain || n.name === networkName);
  const logo = net?.logo ? net.logo : `https://www.google.com/s2/favicons?domain=${networkDomain||"wcaworld.com"}&sz=64`;
  completedNetworkLogos.push({domain: networkDomain, name: networkName, logo});
  const row = document.getElementById("completedNetworksRow");
  if(!row) return;
  const img = document.createElement("img");
  img.src = logo;
  img.alt = networkName;
  img.title = `✓ ${networkName}`;
  img.style.cssText = "width:32px;height:32px;object-fit:contain;border-radius:6px;border:1px solid rgba(16,185,129,0.25);padding:2px;background:rgba(16,185,129,0.05);opacity:.7;filter:none;transition:all .2s;box-shadow:0 1px 4px rgba(0,0,0,0.2)";
  img.onmouseover = function(){ this.style.opacity="1"; this.style.transform="scale(1.15)"; this.style.borderColor="rgba(16,185,129,0.5)"; };
  img.onmouseout = function(){ this.style.opacity=".7"; this.style.transform="scale(1)"; this.style.borderColor="rgba(16,185,129,0.25)"; };
  row.appendChild(img);
}

// === COUNTRY COMPLETION BAR — progresso totale del paese ===
function updateCountryCompletion(done, total){
  const bar = document.getElementById("countryCompletionBar");
  const fill = document.getElementById("countryCompletionFill");
  const text = document.getElementById("countryCompletionText");
  if(!bar || !fill || !text) return;
  if(total <= 0){ bar.style.display = "none"; return; }
  bar.style.display = "flex";
  const pct = Math.round(done / total * 100);
  fill.style.width = pct + "%";
  text.textContent = `${done}/${total} (${pct}%)`;
}

function hideCountryCompletion(){
  const bar = document.getElementById("countryCompletionBar");
  if(bar) bar.style.display = "none";
}

function refreshCountryCompletion(){
  if(!currentScrapingCountry) return;
  const dir = getDirectory(currentScrapingCountry);
  if(!dir) return;
  const total = Object.keys(dir.ids).length;
  const done = Object.values(dir.ids).filter(s => s === "done").length;
  updateCountryCompletion(done, total);
}
