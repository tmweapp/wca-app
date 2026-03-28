// WCA — Login

async function doLogin(){
  const btn = document.getElementById("btnLogin");
  btn.disabled = true; btn.style.opacity = "0.5";
  setStatus("Login in corso...");
  log("Avvio login WCA...");
  try {
    const resp = await fetch(API+"/api/login", {
      method:"POST", headers:{"Content-Type":"application/json"},
      body: JSON.stringify({})
    });
    const data = await resp.json();
    if(data.success){
      sessionCookies = data.cookies;
      wcaToken = data.wcaToken || null;
      // Login icon → verde
      const lb = document.getElementById("loginBadge");
      lb.textContent = "CONNESSO"; lb.className = "badge on";
      btn.classList.remove("off"); btn.classList.add("on");
      document.getElementById("btnStart").disabled = false;
      setStatus("Connesso — seleziona paesi e avvia.", true);
      log("Login riuscito!" + (wcaToken ? " Token trovato." : " Nessun token."), "ok");
    } else {
      log("Login fallito: " + (data.error||"errore sconosciuto"), "err");
      setStatus("Login fallito");
      btn.classList.remove("on"); btn.classList.add("off");
      if(data.debug) log("Debug: "+JSON.stringify(data.debug).substring(0,300), "warn");
    }
  } catch(e){
    log("Errore login: "+e.message, "err");
    setStatus("Errore di connessione");
    btn.classList.remove("on"); btn.classList.add("off");
  }
  btn.disabled = false; btn.style.opacity = "1";
}
