// WCA — Results

function updateResultsTable(){
  const body = document.getElementById("resultsBody");
  body.innerHTML = "";
  document.getElementById("discoverCount").textContent = discoveredMembers.length;
  for(const m of discoveredMembers){
    const tr = document.createElement("tr");
    tr.id = "result-"+m.id;
    tr.innerHTML = `<td>${m.id}</td><td>${esc(m.name)}</td><td style="color:#64748b">in attesa</td>`;
    body.appendChild(tr);
  }
}

function updateResultRow(id, state){
  const tr = document.getElementById("result-"+id);
  if(!tr) return;
  const td = tr.querySelector("td:last-child");
  if(state==="ok"){td.style.color="#22c55e";td.textContent="✓ scrappato";}
  else if(state==="in_db"){td.style.color="#38bdf8";td.textContent="⏭ già in DB";}
  else if(state==="not_found"){td.style.color="#eab308";td.textContent="non trovato";}
  else if(state==="login_redirect"){td.style.color="#ef4444";td.textContent="sessione scaduta";}
  else{td.style.color="#ef4444";td.textContent=state;}
}