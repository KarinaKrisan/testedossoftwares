// admin-module.js
import { db, state, getCompanyCollection, getCompanyDoc, getCompanySubDoc, HIERARCHY, availableMonths, monthNames, getDaysInMonth, pad } from './config.js';
import { showNotification, renderWeekendDuty } from './ui.js'; // Removido updateCalendar pois faremos um grid customizado
import { doc, setDoc, serverTimestamp, query, orderBy, onSnapshot, updateDoc, where, getDocs, addDoc, deleteDoc } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";

let dailyUpdateInterval = null;
let activeTool = null; 

// --- EXPORTAÇÕES GLOBAIS ---
window.openPromoteModal = openPromoteModal;
window.confirmPromotion = confirmPromotion;
window.selectRole = selectRole;
window.approveRequest = approveRequest;
window.rejectRequest = rejectRequest;
window.setEditTool = setEditTool;
window.askConfirmation = askConfirmation;
window.handleAdminCellClick = handleAdminCellClick; // Exportação crucial

// --- INICIALIZAÇÃO ---
export function initAdminUI() {
    ['adminTabNav', 'adminControls', 'editToolbar'].forEach(id => document.getElementById(id)?.classList.remove('hidden'));
    ['collabControls'].forEach(id => document.getElementById(id)?.classList.add('hidden'));

    const btnSave = document.getElementById('btnSaveConfirm');
    if(btnSave) btnSave.onclick = confirmSaveToCloud;
    
    populateEmployeeSelect();
    renderEditToolbar(); 
    initApprovalsTab(); 
    renderInviteWidget(); 
    initMonthSelector(); 
    
    switchAdminView('Daily');
    
    if (dailyUpdateInterval) clearInterval(dailyUpdateInterval);
    dailyUpdateInterval = setInterval(() => { 
        const screen = document.getElementById('screenDaily');
        if (screen && !screen.classList.contains('hidden')) renderDailyDashboard(); 
    }, 60000);
}

export function switchAdminView(view) {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    
    // Toggle de Telas
    ['Daily', 'Edit', 'Approvals', 'Logs'].forEach(s => {
        const screen = document.getElementById(`screen${s}`);
        if(screen) screen.classList.toggle('hidden', s.toLowerCase() !== view.toLowerCase());
        
        const btn = document.getElementById(`btnNav${s}`);
        if(btn) { 
            btn.classList.remove('active', 'bg-purple-600/20', 'text-purple-400'); 
            if(s.toLowerCase() === view.toLowerCase()) btn.classList.add('active', 'bg-purple-600/20', 'text-purple-400'); 
        }
    });
    
    // Lógica Específica de cada Tela
    const tb = document.getElementById('editToolbar');
    const fdsContainer = document.getElementById('weekendDutyContainer');

    if (view === 'Daily' || view === 'daily') {
        if(tb) tb.classList.add('hidden');
        if(fdsContainer) fdsContainer.classList.add('hidden'); // Oculta FDS na Dashboard (conforme pedido anterior)
        renderDailyDashboard();
    }
    
    if (view === 'Edit' || view === 'edit') { 
        if(tb) tb.classList.remove('hidden');
        if(fdsContainer) fdsContainer.classList.remove('hidden'); // Mostra FDS na Edição
        renderMasterGrid(); // <--- Renderiza a grade com nomes
        renderWeekendDuty(); // Atualiza o FDS
    }

    if (view === 'Logs' || view === 'logs') {
        if(tb) tb.classList.add('hidden');
        renderAuditLogs();
    }
}

// --- GRADE MESTRA DE EDIÇÃO (NOVO) ---
function renderMasterGrid() {
    const container = document.getElementById('calendarContainer');
    if (!container || !state.scheduleData) return;

    const days = getDaysInMonth(state.selectedMonthObj.year, state.selectedMonthObj.month);
    
    // Cabeçalho (Dias)
    let html = `
    <div class="overflow-x-auto custom-scrollbar pb-4">
        <div class="min-w-max">
            <div class="flex mb-1">
                <div class="w-40 shrink-0 p-2 text-[9px] font-bold text-gray-500 uppercase tracking-widest sticky left-0 bg-[#0f0f0f] z-10 border-r border-white/10">Colaborador</div>
                <div class="flex flex-1">
                    ${days.map(d => {
                        const isWeekend = d.getDay() === 0 || d.getDay() === 6;
                        const color = isWeekend ? 'text-purple-400' : 'text-gray-500';
                        return `<div class="w-8 text-center text-[9px] font-bold ${color}">${d.getDate()}</div>`;
                    }).join('')}
                </div>
            </div>
            
            <div class="space-y-1">
    `;

    // Linhas (Colaboradores)
    Object.values(state.scheduleData).sort((a,b) => a.name.localeCompare(b.name)).forEach(user => {
        html += `
            <div class="flex items-center group hover:bg-white/5 transition-colors rounded border border-transparent hover:border-white/5">
                <div class="w-40 shrink-0 p-2 text-[10px] font-bold text-white truncate sticky left-0 bg-[#0f0f0f] group-hover:bg-[#1a1a1a] z-10 border-r border-white/10 flex items-center gap-2">
                    <div class="w-1.5 h-1.5 rounded-full ${user.active !== false ? 'bg-emerald-500' : 'bg-red-500'}"></div>
                    ${user.name}
                </div>
                
                <div class="flex flex-1">
                    ${days.map((d, i) => {
                        const val = user.schedule[i] || 'F';
                        let bgClass = 'text-gray-600';
                        if(val === 'T') bgClass = 'text-emerald-400 font-bold';
                        if(val === 'F') bgClass = 'text-yellow-600 opacity-50';
                        if(['FS','FD'].includes(val)) bgClass = 'text-purple-400 font-bold';
                        if(val === 'FE') bgClass = 'text-red-500 font-bold';

                        return `
                        <div onclick="window.handleAdminCellClick('${user.name}', ${i})" 
                             class="w-8 h-8 flex items-center justify-center cursor-pointer border border-white/5 hover:bg-white/10 text-[9px] ${bgClass} select-none transition-colors">
                            ${val}
                        </div>`;
                    }).join('')}
                </div>
            </div>
        `;
    });

    html += `</div></div></div>`;
    container.innerHTML = html;
}

export function handleAdminCellClick(name, i) {
    const user = state.scheduleData[name];
    if(!user) return;
    
    const seq = ['T', 'F', 'FS', 'FD', 'FE', 'A', 'LM'];
    const currentVal = user.schedule[i] || 'F';
    
    // Aplica ferramenta ou rotaciona
    user.schedule[i] = activeTool !== null ? activeTool : seq[(seq.indexOf(currentVal) + 1) % seq.length];
    
    // Re-renderiza tudo para atualizar FDS e Grid
    renderMasterGrid();
    renderWeekendDuty();
}

// --- DASHBOARD (6 Cards) ---
export function renderDailyDashboard() {
    const todayIndex = new Date().getDate() - 1; 
    
    const definitions = {
        'Ativo':    { label: 'Trabalhando', color: 'emerald', icon: 'fa-briefcase' },
        'Folga':    { label: 'Folga',       color: 'yellow',  icon: 'fa-coffee' },
        'Ferias':   { label: 'Férias',      color: 'red',     icon: 'fa-plane' },
        'Off':      { label: 'Off',         color: 'gray',    icon: 'fa-power-off' },
        'Afastado': { label: 'Atestado',    color: 'orange',  icon: 'fa-user-injured' },
        'Licenca':  { label: 'Licença',     color: 'pink',    icon: 'fa-baby' }
    };

    const groups = { Ativo: [], Folga: [], Ferias: [], Off: [], Afastado: [], Licenca: [] };
    
    if(state.scheduleData) {
        Object.values(state.scheduleData).forEach(emp => {
            const s = emp.schedule[todayIndex] || 'F';
            let g = 'Off'; 
            if (['T', 'P', 'MT', 'N', 'D'].includes(s)) g = 'Ativo'; 
            else if (['F', 'FS', 'FD'].includes(s)) g = 'Folga';
            else if (s === 'FE') g = 'Ferias';
            else if (s === 'A') g = 'Afastado';
            else if (s === 'LM') g = 'Licenca';
            if (groups[g]) groups[g].push({ ...emp, status: s });
        });
    }

    const gridContainer = document.getElementById('dailyGrid');
    if (gridContainer) {
        document.getElementById('dailyStats').innerHTML = ''; // Limpa topo
        document.getElementById('dailyStats').className = 'hidden';

        gridContainer.className = "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4";
        gridContainer.innerHTML = Object.keys(definitions).map(key => {
            const list = groups[key];
            const def = definitions[key];
            
            return `
            <div class="premium-glass rounded-xl border border-white/5 overflow-hidden flex flex-col h-[220px]">
                <div class="px-4 py-3 bg-white/5 border-b border-white/5 flex justify-between items-center">
                    <div class="flex items-center gap-2">
                        <div class="w-2 h-2 rounded-full bg-${def.color}-500"></div>
                        <span class="text-[10px] font-bold text-white uppercase tracking-widest">${def.label}</span>
                    </div>
                    <span class="text-[10px] font-mono text-gray-400 bg-black/30 px-2 py-0.5 rounded border border-white/5">${list.length}</span>
                </div>
                <div class="p-2 overflow-y-auto custom-scrollbar flex-1 space-y-1">
                    ${list.map(u => `<div class="flex items-center justify-between px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/5 transition-colors"><span class="text-[10px] text-gray-300 font-medium truncate w-[70%]">${u.name}</span><span class="text-[9px] font-bold font-mono text-${def.color}-400">${u.status}</span></div>`).join('')}
                    ${list.length === 0 ? `<div class="h-full flex flex-col items-center justify-center opacity-30"><i class="fas ${def.icon} text-2xl mb-2"></i><p class="text-[8px] uppercase">Vazio</p></div>` : ''}
                </div>
            </div>`;
        }).join('');
    }
}

// --- OUTRAS FUNÇÕES (MANTIDAS) ---
function initMonthSelector() {
    const sel = document.getElementById('monthSelect');
    if (!sel) return;
    sel.innerHTML = availableMonths.map(m => {
        const isSelected = m.year === state.selectedMonthObj.year && m.month === state.selectedMonthObj.month;
        return `<option value="${m.year}-${m.month}" ${isSelected ? 'selected' : ''}>${monthNames[m.month]} ${m.year}</option>`;
    }).join('');
    sel.onchange = (e) => {
        const [y, m] = e.target.value.split('-');
        state.selectedMonthObj = { year: parseInt(y), month: parseInt(m) };
        if (window.loadData) window.loadData(); else location.reload();
    };
}

export async function renderInviteWidget() {
    const container = document.getElementById('inviteWidgetContainer');
    if (!container) return;
    container.innerHTML = ''; 
    try {
        const q = query(getCompanyCollection("convites"), where("active", "==", true));
        onSnapshot(q, (snap) => {
            const div = document.createElement('div');
            div.className = "premium-glass p-3 border-l-4 border-emerald-500 mb-4 animate-fade-in";
            if (!snap.empty) {
                const inviteCode = snap.docs[0].id;
                const inviteLink = `${window.location.origin}${window.location.pathname.replace('index.html','')}/signup-colaborador.html?convite=${inviteCode}&company=${state.companyId}`;
                div.innerHTML = `<h3 class="text-[10px] font-bold text-white uppercase mb-2 flex justify-between"><span><i class="fas fa-link text-emerald-400 mr-1"></i> Convite Ativo</span></h3><div class="flex gap-1 mb-2"><input type="text" value="${inviteLink}" id="inviteLinkInput" class="bg-black/30 border border-white/10 text-emerald-400 font-mono text-[9px] p-2 rounded w-full outline-none truncate" readonly><button id="btnCopyInvite" class="bg-white/10 hover:bg-white/20 text-white px-3 rounded text-[10px]"><i class="fas fa-copy"></i></button></div><button id="btnRevokeInvite" class="w-full bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 py-1.5 rounded text-[9px] font-bold uppercase transition-colors">Revogar Link</button>`;
                container.innerHTML = ''; container.appendChild(div);
                document.getElementById('btnCopyInvite').onclick = () => { navigator.clipboard.writeText(document.getElementById("inviteLinkInput").value); showNotification("Link copiado!", "success"); };
                document.getElementById('btnRevokeInvite').onclick = () => { askConfirmation("Revogar convite?", async () => { await updateDoc(getCompanyDoc("convites", inviteCode), { active: false }); showNotification("Revogado"); }); };
            } else {
                div.innerHTML = `<h3 class="text-[10px] font-bold text-white uppercase mb-1">Novo Colaborador</h3><button id="btnGenerateInvite" class="w-full bg-emerald-600 hover:bg-emerald-500 text-white py-2 rounded text-[9px] font-bold uppercase shadow-lg transition-all active:scale-95">Gerar Link</button>`;
                container.innerHTML = ''; container.appendChild(div);
                document.getElementById('btnGenerateInvite').onclick = async () => {
                    const code = Math.random().toString(36).substring(2, 6).toUpperCase() + '-' + Math.random().toString(36).substring(2, 6).toUpperCase();
                    try { await setDoc(getCompanyDoc("convites", code), { createdBy: state.currentUser.uid, createdAt: serverTimestamp(), active: true }); showNotification("Gerado!"); } catch (e) { showNotification("Erro", "error"); }
                };
            }
        });
    } catch(e) {}
}

export function populateEmployeeSelect() {
    const s = document.getElementById('employeeSelect');
    if(s) { 
        s.innerHTML = '<option value="">Selecionar...</option>'; 
        Object.keys(state.scheduleData || {}).sort().forEach(n => {
            const user = state.scheduleData[n];
            if (user.level < 100) s.innerHTML += `<option value="${n}">${n}</option>`;
        }); 
    }
}

async function confirmSaveToCloud() {
    const emp = document.getElementById('employeeSelect').value;
    if (!emp) return showNotification("Selecione um colaborador", "error");
    askConfirmation(`Salvar escala de ${emp}?`, async () => {
        try {
            const user = state.scheduleData[emp];
            const safeSchedule = user.schedule.map(v => (v===undefined||v===null||v==="")?"F":v);
            const docId = `${state.selectedMonthObj.year}-${String(state.selectedMonthObj.month+1).padStart(2,'0')}`;
            await setDoc(getCompanySubDoc("escalas", docId, "plantonistas", user.uid), { calculatedSchedule: safeSchedule }, { merge: true });
            await addAuditLog("Edição de Escala", emp);
            showNotification("Salvo com sucesso");
            user.schedule = safeSchedule;
            renderDailyDashboard();
        } catch(e) { showNotification(e.message, "error"); }
    });
}

function renderEditToolbar() {
    const toolbar = document.getElementById('editToolbar');
    if(!toolbar) return;
    const tools = [
        { id: null, label: 'Auto', icon: 'fa-sync', color: 'text-gray-400', border: 'border-white/10' },
        { id: 'T', label: 'T', icon: 'fa-briefcase', color: 'text-emerald-400', border: 'border-emerald-500/50' },
        { id: 'F', label: 'F', icon: 'fa-coffee', color: 'text-amber-400', border: 'border-amber-500/50' },
        { id: 'FS', label: 'Sab', icon: 'fa-sun', color: 'text-[#40E0D0]', border: 'border-[#40E0D0]' },
        { id: 'FD', label: 'Dom', icon: 'fa-sun', color: 'text-[#4169E1]', border: 'border-[#4169E1]' },
        { id: 'FE', label: 'Fér', icon: 'fa-plane', color: 'text-red-400', border: 'border-red-500/50' },
        { id: 'A', label: 'Af', icon: 'fa-user-injured', color: 'text-orange-400', border: 'border-orange-500/50' },
        { id: 'LM', label: 'LM', icon: 'fa-baby', color: 'text-pink-400', border: 'border-pink-500/50' }
    ];
    toolbar.innerHTML = tools.map(t => `<button onclick="window.setEditTool('${t.id}')" class="px-2.5 py-1.5 rounded-lg bg-white/5 border ${t.border} flex items-center gap-1.5 hover:bg-white/10 transition-all"><i class="fas ${t.icon} ${t.color} text-[9px]"></i><span class="text-[8px] font-bold text-white uppercase">${t.label}</span></button>`).join('');
}

function setEditTool(id) { activeTool = (id === 'null' || id === null) ? null : id; showNotification(activeTool ? `Ferramenta: ${activeTool}` : "Modo Automático"); }

// --- FUNÇÕES AUXILIARES DE APROVAÇÃO E AUDITORIA (MANTIDAS) ---
function openPromoteModal() { /* ... código mantido ... */ }
function selectRole(e, key) { /* ... código mantido ... */ }
async function confirmPromotion() { /* ... código mantido ... */ }
function renderAuditLogs() { /* ... código mantido ... */ }
async function addAuditLog(action, target) { try { await addDoc(getCompanyCollection("logs_auditoria"), { adminEmail: state.currentUser.email, action, target, timestamp: serverTimestamp() }); } catch(e){} }
function initApprovalsTab() { /* ... código mantido ... */ }
async function approveRequest(id) { await updateDoc(getCompanyDoc("solicitacoes", id), { status: 'approved' }); showNotification("Aprovado"); }
async function rejectRequest(id) { await updateDoc(getCompanyDoc("solicitacoes", id), { status: 'rejected' }); showNotification("Recusado"); }
function askConfirmation(msg, onConfirm) {
    const modal = document.getElementById('confirmModal') || document.getElementById('customConfirmModal');
    if(!modal) { if(confirm(msg)) onConfirm(); return; }
    document.getElementById('modalMessage').innerHTML = msg;
    modal.classList.remove('hidden');
    const btnConfirm = document.getElementById('modalConfirm');
    const newBtn = btnConfirm.cloneNode(true);
    btnConfirm.parentNode.replaceChild(newBtn, btnConfirm);
    newBtn.onclick = () => { modal.classList.add('hidden'); onConfirm(); };
    document.getElementById('modalCancel').onclick = () => modal.classList.add('hidden');
}
