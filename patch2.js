const fs = require('fs');
let html = fs.readFileSync('public/index.html', 'utf8');

// Trova resumeScraping con regex e sostituisci tutto fino al loop di download
const resumeStart = html.indexOf('async function resumeScraping(){');
if(resumeStart === -1){ console.log("❌ resumeScraping non trovato"); process.exit(1); }

// Trova la fine del blocco pre-download (dove inizia "// Riprendi la Fase 2")
const resumeLoop = html.indexOf('// Riprendi la Fase 2', resumeStart);
if(resumeLoop === -1){ console.log("❌ '// Riprendi la Fase 2' non trovato"); process.exit(1); }

const oldBlock = html.substring(resumeStart, resumeLoop);

const newBlock = `async function resumeScraping(jobCode){
  let members, countryCode, countryName;

  if(jobCode){
    const jobs = getSuspendedJobs();
    const job = jobs.find(j => j.code === jobCode);
    if(!job){ log("Job non trovato","err"); return; }
    members = job.members;
    countryCode = job.code;
    countryName = job.name;
  } else {
    // Fallback: primo job sospeso o stato vecchio
    const jobs = getSuspendedJobs();
    if(jobs.length > 0){
      members = jobs[0].members;
      countryCode = jobs[0].code;
      countryName = jobs[0].name;
    } else {
      let state;
      try { state = JSON.parse(localStorage.getItem("wca_scraping_state")); } catch(e){}
      if(!state || !state.discoveredMembers?.length){
        log("Nessun download interrotto da riprendere.","warn");
        return;
      }
      members = state.discoveredMembers;
      countryCode = state.countries?.[0]?.code || "";
      countryName = state.countries?.[0]?.name || "Sconosciuto";
    }
  }

  // === USA DIRECTORY LOCALE — ZERO QUERY SERVER ===
  const pendingIds = getPendingIds(countryCode);
  const pendingSet = new Set(pendingIds);
  const toDownload = members.filter(m => pendingSet.has(String(m.id)));
  const done = members.length - toDownload.length;

  currentScrapingCountry = countryCode;
  discoveredMembers = members;
  updateResultsTable();
  document.getElementById("resultsCard").style.display = "block";
  document.getElementById("tabsSection").style.display = "block";

  for(const m of members){
    if(!pendingSet.has(String(m.id))) updateResultRow(m.id, "in_db");
  }

  log(\`📂 \${countryName}: \${done} già fatti, \${toDownload.length} da scaricare — RIPRESA IMMEDIATA\`,"ok");

  if(toDownload.length === 0){
    setProgress(100, 100);
    setStatus(\`✅ \${countryName}: COMPLETO — tutti i \${members.length} partner fatti\`, true);
    alert(\`\${countryName}: COMPLETO!\\n\\n\${members.length} partner già tutti scaricati.\`);
    removeSuspendedJob(countryCode);
    return;
  }

  scraping = true;
  delayIndex = 0;
  document.getElementById("btnStart").disabled = true;
  document.getElementById("btnResume").style.display = "none";
  document.getElementById("btnStop").disabled = false;
  setStatus(\`\${countryName}: ripresa \${toDownload.length} profili...\`, true);

  `;

html = html.substring(0, resumeStart) + newBlock + html.substring(resumeLoop);

fs.writeFileSync('public/index.html', html);
console.log("✅ resumeScraping riscritto con directory locale");
