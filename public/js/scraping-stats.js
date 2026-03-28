// Scraping Stats Module — real-time scrape statistics display

// === SCRAPE STATS — mostra conteggi in tempo reale ===
let scrapeStats = { found: 0, downloaded: 0, skipped: 0, networkName: "", countryName: "" };

function updateScrapeStats(opts){
  if(opts.found !== undefined) scrapeStats.found = opts.found;
  if(opts.downloaded !== undefined) scrapeStats.downloaded = opts.downloaded;
  if(opts.skipped !== undefined) scrapeStats.skipped = opts.skipped;
  if(opts.networkName !== undefined) scrapeStats.networkName = opts.networkName;
  if(opts.countryName !== undefined) scrapeStats.countryName = opts.countryName;
  renderScrapeStats();
}

function resetScrapeStats(){
  scrapeStats = { found: 0, downloaded: 0, skipped: 0, networkName: "", countryName: "" };
  const row = document.getElementById("scrapeStatsRow");
  if(row) row.style.display = "none";
}

function renderScrapeStats(){
  const row = document.getElementById("scrapeStatsRow");
  if(!row) return;
  row.style.display = "flex";
  const netLabel = scrapeStats.networkName ? ` su ${scrapeStats.networkName}` : "";
  const countryLabel = scrapeStats.countryName ? ` (${scrapeStats.countryName})` : "";
  const foundEl = document.getElementById("statFoundInNetwork");
  if(scrapeStats.found > 0){
    foundEl.textContent = `${scrapeStats.found} trovati${netLabel}${countryLabel}`;
    foundEl.style.display = "inline-block";
  } else { foundEl.style.display = "none"; }
  const dlEl = document.getElementById("statDownloaded");
  if(scrapeStats.downloaded > 0){
    dlEl.textContent = `${scrapeStats.downloaded} salvati`;
    dlEl.style.display = "inline-block";
  } else { dlEl.style.display = "none"; }
  const skEl = document.getElementById("statSkipped");
  if(scrapeStats.skipped > 0){
    skEl.textContent = `${scrapeStats.skipped} saltati`;
    skEl.style.display = "inline-block";
  } else { skEl.style.display = "none"; }
}
