// UI Log Module — logging to the log area with timestamp

function log(msg, cls=""){
  const d = document.getElementById("logArea");
  const line = document.createElement("div");
  if(cls) line.className = cls;
  const t = new Date().toLocaleTimeString();
  line.textContent = `[${t}] ${msg}`;
  d.prepend(line);
  if(d.children.length > 200) d.removeChild(d.lastChild);
}
