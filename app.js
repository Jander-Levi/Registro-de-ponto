const STORAGE_KEY = "ponto_v1_records";

const el = (id) => document.getElementById(id);

const dateInput = el("date");
const timeInput = el("time");
const typeInput = el("type");
const noteInput = el("note");

const btnAdd = el("btnAdd");
const btnNow = el("btnNow");
const btnClear = el("btnClear");
const btnExport = el("btnExport");

const filterDate = el("filterDate");
const btnToday = el("btnToday");

const tbody = el("tbody");

const kpiWork = el("kpiWork");
const kpiBreak = el("kpiBreak");
const kpiStatus = el("kpiStatus");

function pad2(n){ return String(n).padStart(2, "0"); }

function toISODate(d){
  return `${d.getFullYear()}-${pad2(d.getMonth()+1)}-${pad2(d.getDate())}`;
}

function toTimeHM(d){
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function parseHM(hm){
  // "HH:MM" -> minutos desde 00:00
  const [h, m] = hm.split(":").map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  return h*60 + m;
}

function fmtMinutes(min){
  const sign = min < 0 ? "-" : "";
  const v = Math.abs(min);
  const h = Math.floor(v/60);
  const m = v % 60;
  return `${sign}${pad2(h)}:${pad2(m)}`;
}

function typeLabel(t){
  switch(t){
    case "IN": return "Entrada";
    case "OUT": return "Saída";
    case "BREAK_START": return "Início pausa";
    case "BREAK_END": return "Fim pausa";
    default: return t;
  }
}

function load(){
  try{
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  }catch{
    return [];
  }
}

function save(records){
  localStorage.setItem(STORAGE_KEY, JSON.stringify(records));
}

function uuid(){
  return Math.random().toString(16).slice(2) + Date.now().toString(16);
}

function nowFill(){
  const d = new Date();
  dateInput.value = toISODate(d);
  timeInput.value = toTimeHM(d);
  if(!filterDate.value) filterDate.value = dateInput.value;
}

function normalizeSort(records){
  // ordena por data+hora
  return [...records].sort((a,b)=>{
    if(a.date !== b.date) return a.date.localeCompare(b.date);
    return a.time.localeCompare(b.time);
  });
}

function getFiltered(records){
  const d = filterDate.value;
  if(!d) return normalizeSort(records);
  return normalizeSort(records.filter(r => r.date === d));
}

function validateNewRecord(rec, allForDay){
  // Regras simples para reduzir erros óbvios (não é prova formal)
  // 1) Não permitir dois eventos iguais no mesmo minuto
  if(allForDay.some(r => r.time === rec.time && r.type === rec.type)){
    return "Já existe um evento igual nessa hora.";
  }

  // 2) Sequência mínima recomendada:
  // IN -> (BREAK_START -> BREAK_END)* -> OUT
  // Vamos verificar status atual do dia e sugerir/impedir certas transições.
  const status = computeDayStatus(allForDay);

  const next = rec.type;

  if(next === "IN"){
    if(status.state !== "EMPTY" && status.state !== "CLOSED"){
      return "Entrada não faz sentido: o dia já está em andamento.";
    }
  }

  if(next === "OUT"){
    if(status.state === "EMPTY" || status.state === "CLOSED"){
      return "Saída não faz sentido: não há uma entrada aberta.";
    }
    if(status.state === "ON_BREAK"){
      return "Você está em pausa. Registre o fim da pausa antes da saída.";
    }
  }

  if(next === "BREAK_START"){
    if(status.state !== "WORKING"){
      return "Início de pausa só faz sentido durante o expediente (após Entrada e antes de Saída).";
    }
  }

  if(next === "BREAK_END"){
    if(status.state !== "ON_BREAK"){
      return "Fim de pausa só faz sentido se uma pausa estiver em andamento.";
    }
  }

  return null;
}

function computeDayStatus(dayRecords){
  // dayRecords pode estar desordenado
  const recs = normalizeSort(dayRecords);

  // estados: EMPTY, WORKING, ON_BREAK, CLOSED
  let state = "EMPTY";

  for(const r of recs){
    if(r.type === "IN"){
      state = "WORKING";
    } else if(r.type === "BREAK_START"){
      if(state === "WORKING") state = "ON_BREAK";
    } else if(r.type === "BREAK_END"){
      if(state === "ON_BREAK") state = "WORKING";
    } else if(r.type === "OUT"){
      if(state === "WORKING") state = "CLOSED";
    }
  }

  return { state };
}

function computeDayTotals(dayRecords){
  const recs = normalizeSort(dayRecords);

  let workMin = 0;
  let breakMin = 0;

  let lastIn = null;         // minutos
  let breakStart = null;     // minutos
  let isWorkingOpen = false;

  for(const r of recs){
    const t = parseHM(r.time);
    if(t === null) continue;

    if(r.type === "IN"){
      lastIn = t;
      isWorkingOpen = true;
      breakStart = null;
    }

    if(r.type === "BREAK_START" && isWorkingOpen){
      if(breakStart === null){
        breakStart = t;
      }
    }

    if(r.type === "BREAK_END" && isWorkingOpen){
      if(breakStart !== null){
        breakMin += Math.max(0, t - breakStart);
        breakStart = null;
      }
    }

    if(r.type === "OUT" && isWorkingOpen){
      // soma trabalho: tempo total entre IN e OUT menos pausas internas já acumuladas.
      workMin += Math.max(0, t - lastIn);
      isWorkingOpen = false;
      lastIn = null;
      breakStart = null;
    }
  }

  // Se estiver aberto (sem OUT), calcula até "agora"
  if(isWorkingOpen && lastIn !== null){
    const now = new Date();
    const nowMin = now.getHours()*60 + now.getMinutes();
    workMin += Math.max(0, nowMin - lastIn);

    // se pausa aberta, conta pausa até agora
    if(breakStart !== null){
      breakMin += Math.max(0, nowMin - breakStart);
    }
  }

  // trabalho líquido = total - pausa
  const netWork = Math.max(0, workMin - breakMin);

  return { netWork, breakMin };
}

function render(){
  const records = load();
  const shown = getFiltered(records);

  tbody.innerHTML = "";

  for(const r of shown){
    const tr = document.createElement("tr");

    const tdDate = document.createElement("td");
    tdDate.textContent = r.date;

    const tdTime = document.createElement("td");
    tdTime.textContent = r.time;

    const tdType = document.createElement("td");
    const badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = typeLabel(r.type);
    tdType.appendChild(badge);

    const tdNote = document.createElement("td");
    tdNote.textContent = r.note || "";

    const tdActions = document.createElement("td");
    tdActions.className = "right";

    const btnEdit = document.createElement("button");
    btnEdit.textContent = "Editar";
    btnEdit.onclick = () => editRecord(r.id);

    const btnDel = document.createElement("button");
    btnDel.textContent = "Excluir";
    btnDel.className = "danger subtle";
    btnDel.style.marginLeft = "8px";
    btnDel.onclick = () => deleteRecord(r.id);

    tdActions.appendChild(btnEdit);
    tdActions.appendChild(btnDel);

    tr.appendChild(tdDate);
    tr.appendChild(tdTime);
    tr.appendChild(tdType);
    tr.appendChild(tdNote);
    tr.appendChild(tdActions);

    tbody.appendChild(tr);
  }

  renderKPIs(records);
}

function renderKPIs(allRecords){
  const d = filterDate.value || dateInput.value || toISODate(new Date());
  const day = allRecords.filter(r => r.date === d);

  const totals = computeDayTotals(day);
  kpiWork.textContent = fmtMinutes(totals.netWork);
  kpiBreak.textContent = fmtMinutes(totals.breakMin);

  const { state } = computeDayStatus(day);
  const statusLabel =
    state === "EMPTY" ? "Sem registro" :
    state === "WORKING" ? "Em expediente" :
    state === "ON_BREAK" ? "Em pausa" :
    state === "CLOSED" ? "Dia fechado" : "—";

  kpiStatus.textContent = statusLabel;
}

function addRecord(){
  const date = dateInput.value;
  const time = timeInput.value;
  const type = typeInput.value;
  const note = noteInput.value.trim();

  if(!date || !time){
    alert("Preencha data e hora.");
    return;
  }

  const records = load();
  const dayRecords = records.filter(r => r.date === date);

  const newRec = { id: uuid(), date, time, type, note };
  const err = validateNewRecord(newRec, dayRecords);
  if(err){
    alert(err);
    return;
  }

  records.push(newRec);
  save(records);

  // Para conveniência, mantém filtro na mesma data registrada
  filterDate.value = date;
  render();
}

function editRecord(id){
  const records = load();
  const rec = records.find(r => r.id === id);
  if(!rec) return;

  const newDate = prompt("Data (YYYY-MM-DD):", rec.date);
  if(newDate === null) return;

  const newTime = prompt("Hora (HH:MM):", rec.time);
  if(newTime === null) return;

  const newType = prompt("Tipo (IN, BREAK_START, BREAK_END, OUT):", rec.type);
  if(newType === null) return;

  const newNote = prompt("Observação:", rec.note || "");
  if(newNote === null) return;

  // validação básica
  if(!/^\d{4}-\d{2}-\d{2}$/.test(newDate) || !/^\d{2}:\d{2}$/.test(newTime)){
    alert("Formato inválido.");
    return;
  }

  rec.date = newDate;
  rec.time = newTime;
  rec.type = newType;
  rec.note = newNote.trim();

  save(records);
  filterDate.value = newDate;
  render();
}

function deleteRecord(id){
  const ok = confirm("Excluir este registro?");
  if(!ok) return;

  const records = load().filter(r => r.id !== id);
  save(records);
  render();
}

function clearAll(){
  const ok = confirm("Isso vai apagar TODOS os registros do navegador. Continuar?");
  if(!ok) return;
  localStorage.removeItem(STORAGE_KEY);
  render();
}

function exportCSV(){
  const records = normalizeSort(load());
  if(records.length === 0){
    alert("Não há registros para exportar.");
    return;
  }

  const header = ["date","time","type","note"];
  const rows = records.map(r => [
    r.date,
    r.time,
    r.type,
    (r.note || "").replaceAll('"', '""')
  ]);

  const csv = [
    header.join(","),
    ...rows.map(cols => `${cols[0]},${cols[1]},${cols[2]},"${cols[3]}"`)
  ].join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  const a = document.createElement("a");
  a.href = url;
  a.download = "registros_ponto.csv";
  document.body.appendChild(a);
  a.click();
  a.remove();

  URL.revokeObjectURL(url);
}

function setTodayFilter(){
  const today = toISODate(new Date());
  filterDate.value = today;
  dateInput.value = today;
  render();
}

// Eventos
btnAdd.addEventListener("click", addRecord);
btnNow.addEventListener("click", nowFill);
btnClear.addEventListener("click", clearAll);
btnExport.addEventListener("click", exportCSV);

filterDate.addEventListener("change", () => {
  if(filterDate.value) dateInput.value = filterDate.value;
  render();
});

btnToday.addEventListener("click", setTodayFilter);

// Inicialização
(function init(){
  const today = toISODate(new Date());
  dateInput.value = today;
  filterDate.value = today;
  nowFill();
  render();
})();