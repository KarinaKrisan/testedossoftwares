// admin-module.js
import { db, state, getCompanyCollection, getCompanyDoc, getCompanySubDoc, HIERARCHY, availableMonths, monthNames, getDaysInMonth, pad } from './config.js';
import { showNotification, renderWeekendDuty } from './ui.js';
import { doc, setDoc, serverTimestamp, query, orderBy, onSnapshot, updateDoc, where, getDocs, addDoc, deleteDoc, writeBatch } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";

let dailyUpdateInterval = null;
let activeTool = null; 
let currentEditingUid = null; 

// --- EXPORTAÇÕES GLOBAIS ---
window.openPromoteModal = openPromoteModal;
window.confirmPromotion = confirmPromotion;
window.selectRole = selectRole;
window.approveRequest = approveRequest;
window.rejectRequest = rejectRequest;
window.setEditTool = setEditTool;
window.askConfirmation = askConfirmation;
window.handleAdminCellClick = handleAdminCellClick;
window.loadSelectedUser = loadSelectedUser;
window.clearCurrentMonthSchedule = clearCurrentMonthSchedule;

// --- INICIALIZAÇÃO ---
export function initAdminUI() {
    ['adminTabNav', 'adminControls', 'editToolbar'].forEach(id => document.getElementById(id)?.classList.remove('hidden'));
    ['collabControls'].forEach(id => document.getElementById(id)?.classList.add('hidden'));

    const btnSave = document.getElementById('btnSaveConfirm');
    if(btnSave) btnSave.onclick = confirmSaveToCloud;
    
    renderEditToolbar(); 
    initApprovalsTab(); 
    renderInviteWidget(); 
    initMonthSelector(); 
    renderEmployeeSelectorWidget(); 

    // Força atualização inicial
    switchAdminView('Daily');
    
    if (dailyUpdateInterval) clearInterval(dailyUpdateInterval);
    dailyUpdateInterval = setInterval(() => { 
        const screen = document.getElementById('screenDaily');
        if (screen && !screen.classList.contains('hidden')) renderDailyDashboard(); 
    }, 60000);
}

export async function switchAdminView(view) {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    
    ['Daily', 'Edit', 'Approvals', 'Logs'].forEach(s => {
        const screen = document.getElementById(`screen${s}`);
        if(screen) screen.classList.toggle('hidden', s.toLowerCase() !== view.toLowerCase());
        
        const btn = document.getElementById(`btnNav${s}`);
        if(btn) { 
            btn.classList.remove('active', 'bg-purple-600/20', 'text-purple-400'); 
            if(s.toLowerCase() === view.toLowerCase()) btn.classList.add('active', 'bg-purple-600/20', 'text-purple-400'); 
        }
    });
    
    const tb = document.getElementById('editToolbar');
    const fdsContainer = document.getElementById('weekendDutyContainer');
    const empWidget = document.getElementById('adminEmployeeWidget');

    // --- MODO DASHBOARD ---
    if (view === 'Daily' || view === 'daily') {
        if(tb) tb.classList.add('hidden');
        if(fdsContainer) fdsContainer.classList.add('hidden');
        if(empWidget) empWidget.classList.add('hidden'); 
        
        // CORREÇÃO CRÍTICA: SE ESTIVER NA DASHBOARD, O MÊS TEM QUE SER O ATUAL
        const now = new Date();
        const currentY = now.getFullYear();
        const currentM = now.getMonth();

        // Verifica se o estado está diferente do mês real
        if (state.selectedMonthObj.year !== currentY || state.selectedMonthObj.month !== currentM) {
            
            // 1. Atualiza o estado
            state.selectedMonthObj = { year: currentY, month: currentM };
            
            // 2. Atualiza visualmente o Select
            const sel = document.getElementById('monthSelect');
            if(sel) sel.value = `${currentY}-${currentM}`;
            
            // 3. Força recarregamento dos dados do Firebase para o novo mês
            if(window.loadData) await window.loadData();
        } 
        
        // Só renderiza depois de garantir que os dados são de HOJE
        renderDailyDashboard();
    }
    
    // --- MODO EDIÇÃO ---
    if (view === 'Edit' || view === 'edit') { 
        if(tb) tb.classList.remove('hidden');
        if(fdsContainer) fdsContainer.classList.remove('hidden');
        if(empWidget) empWidget.classList.remove('hidden');
        
        populateEmployeeSelect();
        const select = document.getElementById('employeeSelect');
        if(select && select.value) { loadSelectedUser(select.value); } 
        else { document.getElementById('calendarContainer').innerHTML = '<div class="premium-glass p-10 text-center text-gray-500 text-xs uppercase tracking-widest border border-white/5 rounded-xl"><i class="fas fa-user-edit text-3xl mb-3 text-purple-400"></i><br>Selecione um colaborador na barra lateral</div>'; }
        
        renderWeekendDuty(); 
    }

    if (view === 'Logs' || view === 'logs') {
        if(tb) tb.classList.add('hidden');
        if(empWidget) empWidget.classList.add('hidden');
        renderAuditLogs();
    }
}

// --- DASHBOARD INTELIGENTE ---
export function renderDailyDashboard() {
    const todayIndex = new Date().getDate() - 1; 
    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes(); 

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
            // Verifica o status do dia HOJE
            const s = emp.schedule[todayIndex] || 'F';
            let g = 'Off'; 
            let statusText = s;

            // Prioridade para Status Especiais
            if (s === 'FE') {
                g = 'Ferias'; // Só entra aqui se no dia de HOJE estiver marcado FE
            } else if (s === 'A') {
                g = 'Afastado';
            } else if (s === 'LM') {
                g = 'Licenca';
            } 
            // Trabalho e Folga
            else if (['T', 'P', 'MT', 'N', 'D', 'FS', 'FD'].includes(s)) {
                if (checkIsWorkingNow(emp.horario, currentMinutes)) {
                    g = 'Ativo';
                } else {
                    g = 'Off';
                    statusText = 'Fora de Turno';
                }
            } 
            else if (['F'].includes(s)) {
                g = 'Folga';
            }
            
            if (groups[g]) groups[g].push({ ...emp, status: statusText });
        });
    }

    const gridContainer = document.getElementById('dailyGrid');
    if (gridContainer) {
        document.getElementById('dailyStats').innerHTML = ''; 
        document.getElementById('dailyStats').className = 'hidden';

        gridContainer.className = "grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4";
        gridContainer.innerHTML = Object.keys(definitions).map(key => {
            const list = groups[key];
            const def = definitions[key];
            
            return `
            <div class="premium-glass rounded-xl border border-white/5 overflow-hidden flex flex-col h-[220px]">
                <div class="px-4 py-3 bg-white/5 border-b border-white/5 flex justify-between items-center">
                    <div class="flex items-center gap-2">
                        <div class="w-2 h-2 rounded-full bg-${def.color}-500 shadow-[0_0_8px_rgba(255,255,255,0.2)]"></div>
                        <span class="text-[10px] font-bold text-white uppercase tracking-widest">${def.label}</span>
                    </div>
                    <span class="text-[10px] font-mono text-gray-400 bg-black/30 px-2 py-0.5 rounded border border-white/5">${list.length}</span>
                </div>
                <div class="p-2 overflow-y-auto custom-scrollbar flex-1 space-y-1">
                    ${list.map(u => `
                        <div class="flex items-center justify-between px-3 py-2 rounded-lg bg-white/5 hover:bg-white/10 border border-white/5 transition-colors group">
                            <span class="text-[10px] text-gray-300 font-medium truncate w-[70%] group-hover:text-white">${u.name}</span>
                            <span class="text-[9px] font-bold font-mono text-${def.color}-400 bg-${def.color}-500/10 px-1.5 rounded border border-${def.color}-500/20">
                                ${u.status}
                            </span>
                        </div>
                    `).join('')}
                    ${list.length === 0 ? `<div class="h-full flex flex-col items-center justify-center opacity-30"><i class="fas ${def.icon} text-2xl mb-2"></i><p class="text-[8px] uppercase">Vazio</p></div>` : ''}
                </div>
            </div>`;
        }).join('');
    }
}

// --- UTILS ---
function checkIsWorkingNow(horarioString, currentMinutes) {
    if (!horarioString) return true; 
    try {
        const parts = horarioString.toLowerCase().split('às');
        if (parts.length !== 2) return true;
        const startParts = parts[0].trim().split(':');
        const endParts = parts[1].trim().split(':');
        const startMin = parseInt(startParts[0]) * 60 + parseInt(startParts[1]);
        const endMin = parseInt(endParts[0]) * 60 + parseInt(endParts[1]);
        if (endMin > startMin) return currentMinutes >= startMin && currentMinutes < endMin;
        else return currentMinutes >= startMin || currentMinutes < endMin;
    } catch (e) { return true; }
}

function renderEmployeeSelectorWidget() {
    const container = document.getElementById('adminControls');
    if (!container || document.getElementById('adminEmployeeWidget')) return;
    const widget = document.createElement('div');
    widget.id = 'adminEmployeeWidget';
    widget.className = "premium-glass p-4 rounded-2xl border border-white/10 hidden animate-fade-in mb-4"; 
    widget.innerHTML = `
        <label class="text-[8px] font-bold text-gray-500 uppercase tracking-widest mb-2 block">Editar Colaborador</label>
        <select id="employeeSelect" class="w-full bg-black/40 border border-white/10 text-white text-xs p-3 rounded-xl outline-none focus:border-purple-500 transition-all cursor-pointer">
            <option value="">Carregando...</option>
        </select>`;
    container.insertBefore(widget, container.firstChild);
}

export function populateEmployeeSelect() {
    const s = document.getElementById('employeeSelect');
    if(!s) return;
    const currentValue = s.value;
    s.innerHTML = '<option value="">Selecione...</option>'; 
    if(state.scheduleData) {
        Object.keys(state.scheduleData).sort().forEach(n => {
            const user = state.scheduleData[n];
            if (user.level < 100) s.innerHTML += `<option value="${n}">${n}</option>`;
        });
    }
    if(currentValue && state.scheduleData[currentValue]) s.value = currentValue;
    s.onchange = () => loadSelectedUser(s.value);
}

function loadSelectedUser(name) {
    currentEditingUid = name;
    if(!name) { document.getElementById('calendarContainer').innerHTML = '<div class="premium-glass p-10 text-center text-gray-500 text-xs uppercase tracking-widest border border-white/5 rounded-xl"><i class="fas fa-user-edit text-3xl mb-3 text-purple-400"></i><br>Selecione um colaborador na barra lateral</div>'; return; }
    renderIndividualEditor(name);
}

function renderIndividualEditor(name) {
    const container = document.getElementById('calendarContainer');
    const user = state.scheduleData[name];
    if (!container || !user) return;
    const days = getDaysInMonth(state.selectedMonthObj.year, state.selectedMonthObj.month);
    let html = `
    <div class="premium-glass p-4 rounded-xl border border-white/5 mb-4 animate-fade-in">
        <div class="flex justify-between items-center mb-4 border-b border-white/5 pb-2">
            <div>
                <h2 class="text-lg font-bold text-white flex items-center gap-2">
                    <div class="w-3 h-3 rounded-full ${user.active !== false ? 'bg-emerald-500' : 'bg-red-500'}"></div>
                    ${user.name}
                </h2>
                <p class="text-[10px] text-gray-400 uppercase tracking-widest pl-5">${user.cargo || 'Colaborador'}</p>
            </div>
            <div class="text-right"><span class="text-[9px] font-mono text-purple-400 bg-purple-500/10 px-2 py-1 rounded border border-purple-500/20">EDITION MODE</span></div>
        </div>
        <div class="grid grid-cols-7 gap-1 md:gap-2">
            ${['DOM','SEG','TER','QUA','QUI','SEX','SÁB'].map(d => `<div class="text-center text-[9px] font-bold text-gray-500 uppercase py-1">${d}</div>`).join('')}
    `;
    for (let i = 0; i < days[0].getDay(); i++) html += `<div class="bg-transparent"></div>`;
    days.forEach((day, i) => {
        const val = user.schedule[i] || 'F';
        let bgClass = 'bg-white/5 border-white/5 text-gray-400';
        let icon = '';
        if(val === 'T') { bgClass = 'bg-emerald-500/20 border-emerald-500/50 text-emerald-400 font-bold'; icon='<i class="fas fa-briefcase text-[8px] opacity-50"></i>'; }
        if(val === 'F') { bgClass = 'bg-yellow-500/10 border-yellow-500/30 text-yellow-500'; icon='<i class="fas fa-coffee text-[8px] opacity-50"></i>'; }
        if(['FS','FD'].includes(val)) { bgClass = 'bg-blue-500/20 border-blue-500/50 text-blue-400 font-bold'; icon='<i class="fas fa-sun text-[8px] opacity-50"></i>'; }
        if(val === 'FE') { bgClass = 'bg-red-500/20 border-red-500/50 text-red-400 font-bold'; icon='<i class="fas fa-plane text-[8px] opacity-50"></i>'; }
        if(val === 'A') { bgClass = 'bg-orange-500/20 border-orange-500/50 text-orange-400 font-bold'; icon='<i class="fas fa-user-injured text-[8px] opacity-50"></i>'; }
        if(val === 'LM') { bgClass = 'bg-pink-500/20 border-pink-500/50 text-pink-400 font-bold'; icon='<i class="fas fa-baby text-[8px] opacity-50"></i>'; }
        
        const isToday = day.getDate() === new Date().getDate() && day.getMonth() === new Date().getMonth();
        const todayBorder = isToday ? 'ring-1 ring-white' : '';

        html += `<div onclick="window.handleAdminCellClick('${name}', ${i})" class="aspect-square rounded-lg border ${bgClass} ${todayBorder} flex flex-col items-center justify-center cursor-pointer hover:scale-105 hover:brightness-125 transition-all select-none relative group"><span class="text-[10px] md:text-sm">${day.getDate()}</span><span class="text-[9px] md:text-xs font-bold mt-1">${val}</span><div class="absolute top-1 right-1 hidden md:block">${icon}</div></div>`;
    });
    html += `</div><div class="mt-4 pt-4 border-t border-white/5 flex justify-end"><button id="btnSaveIndividual" class="bg-emerald-600 hover:bg-emerald-500 text-white py-2 px-6 rounded-lg text-[10px] font-bold uppercase tracking-widest shadow-lg flex items-center gap-2 transition-transform active:scale-95"><i class="fas fa-save"></i> Salvar Alterações</button></div></div>`;
    container.innerHTML = html;
    document.getElementById('btnSaveIndividual').onclick = confirmSaveToCloud;
}

export function handleAdminCellClick(name, i) {
    const user = state.scheduleData[name];
    if(!user) return;
    const seq = ['T', 'F', 'FS', 'FD', 'FE', 'A', 'LM'];
    const currentVal = user.schedule[i] || 'F';
    user.schedule[i] = activeTool !== null ? activeTool : seq[(seq.indexOf(currentVal) + 1) % seq.length];
    renderIndividualEditor(name);
}

async function confirmSaveToCloud() {
    const select = document.getElementById('employeeSelect');
    const empName = select ? select.value : currentEditingUid;
    if (!empName) return showNotification("Selecione um colaborador", "error");
    
    askConfirmation(`Salvar escala de ${empName}?`, async () => {
        try {
            const user = state.scheduleData[empName];
            const safeSchedule = user.schedule.map(v => (v===undefined||v===null||v==="")?"F":v);
            const docId = `${state.selectedMonthObj.year}-${String(state.selectedMonthObj.month+1).padStart(2,'0')}`;
            await setDoc(getCompanySubDoc("escalas", docId, "plantonistas", user.uid), { calculatedSchedule: safeSchedule }, { merge: true });
            await addAuditLog("Edição de Escala", empName);
            showNotification("Salvo com sucesso");
            renderWeekendDuty();
            renderDailyDashboard();
        } catch(e) { showNotification(e.message, "error"); }
    });
}

// --- FUNÇÃO DE EXCLUSÃO (Limpar Mês) ---
async function clearCurrentMonthSchedule() {
    const m = state.selectedMonthObj;
    const label = `${monthNames[m.month]}/${m.year}`;
    askConfirmation(`Deseja EXCLUIR toda a escala de ${label}?`, async () => {
        try {
            const batch = writeBatch(db);
            const docId = `${m.year}-${String(m.month+1).padStart(2,'0')}`;
            Object.values(state.scheduleData).forEach(user => {
                const ref = getCompanySubDoc("escalas", docId, "plantonistas", user.uid);
                batch.delete(ref);
                user.schedule = Array(32).fill('F');
            });
            await batch.commit();
            await addAuditLog("Exclusão de Escala", `Excluiu ${label}`);
            showNotification(`Escala excluída!`);
            if(currentEditingUid) renderIndividualEditor(currentEditingUid);
            renderWeekendDuty();
        } catch(e) { showNotification("Erro: " + e.message, "error"); }
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
    
    const btnClear = document.createElement('button');
    btnClear.className = "px-2.5 py-1.5 rounded-lg bg-red-500/10 border border-red-500/50 flex items-center gap-1.5 hover:bg-red-500/20 transition-all ml-auto";
    btnClear.innerHTML = `<i class="fas fa-trash text-red-400 text-[9px]"></i><span class="text-[8px] font-bold text-red-200 uppercase">Excluir Escala</span>`;
    btnClear.onclick = window.clearCurrentMonthSchedule;
    toolbar.appendChild(btnClear);
}

function setEditTool(id) { activeTool = (id === 'null' || id === null) ? null : id; showNotification(activeTool ? `Ferramenta: ${activeTool}` : "Modo Automático"); }
function initMonthSelector() { const sel = document.getElementById('monthSelect'); if (!sel) return; sel.innerHTML = availableMonths.map(m => { const isSelected = m.year === state.selectedMonthObj.year && m.month === state.selectedMonthObj.month; return `<option value="${m.year}-${m.month}" ${isSelected ? 'selected' : ''}>${monthNames[m.month]} ${m.year}</option>`; }).join(''); sel.onchange = (e) => { const [y, m] = e.target.value.split('-'); state.selectedMonthObj = { year: parseInt(y), month: parseInt(m) }; if (window.loadData) window.loadData(); else location.reload(); }; }
export async function renderInviteWidget() { const container = document.getElementById('inviteWidgetContainer'); if (!container) return; container.innerHTML = ''; try { const q = query(getCompanyCollection("convites"), where("active", "==", true)); onSnapshot(q, (snap) => { const div = document.createElement('div'); div.className = "premium-glass p-3 border-l-4 border-emerald-500 mb-4 animate-fade-in"; if (!snap.empty) { const inviteCode = snap.docs[0].id; const inviteLink = `${window.location.origin}${window.location.pathname.replace('index.html','')}/signup-colaborador.html?convite=${inviteCode}&company=${state.companyId}`; div.innerHTML = `<h3 class="text-[10px] font-bold text-white uppercase mb-2 flex justify-between"><span><i class="fas fa-link text-emerald-400 mr-1"></i> Convite Ativo</span></h3><div class="flex gap-1 mb-2"><input type="text" value="${inviteLink}" id="inviteLinkInput" class="bg-black/30 border border-white/10 text-emerald-400 font-mono text-[9px] p-2 rounded w-full outline-none truncate" readonly><button id="btnCopyInvite" class="bg-white/10 hover:bg-white/20 text-white px-3 rounded text-[10px]"><i class="fas fa-copy"></i></button></div><button id="btnRevokeInvite" class="w-full bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 py-1.5 rounded text-[9px] font-bold uppercase transition-colors">Revogar Link</button>`; container.innerHTML = ''; container.appendChild(div); document.getElementById('btnCopyInvite').onclick = () => { navigator.clipboard.writeText(document.getElementById("inviteLinkInput").value); showNotification("Link copiado!", "success"); }; document.getElementById('btnRevokeInvite').onclick = () => { askConfirmation("Revogar convite?", async () => { await updateDoc(getCompanyDoc("convites", inviteCode), { active: false }); showNotification("Revogado"); }); }; } else { div.innerHTML = `<h3 class="text-[10px] font-bold text-white uppercase mb-1">Novo Colaborador</h3><button id="btnGenerateInvite" class="w-full bg-emerald-600 hover:bg-emerald-500 text-white py-2 rounded text-[9px] font-bold uppercase shadow-lg transition-all active:scale-95">Gerar Link</button>`; container.innerHTML = ''; container.appendChild(div); document.getElementById('btnGenerateInvite').onclick = async () => { const code = Math.random().toString(36).substring(2, 6).toUpperCase() + '-' + Math.random().toString(36).substring(2, 6).toUpperCase(); try { await setDoc(getCompanyDoc("convites", code), { createdBy: state.currentUser.uid, createdAt: serverTimestamp(), active: true }); showNotification("Gerado!"); } catch (e) { showNotification("Erro", "error"); } }; } }); } catch(e) {} }
function openPromoteModal() { const modal = document.getElementById('promoteModal'); const userSelect = document.getElementById('promoteTargetUser'); const roleContainer = document.getElementById('roleOptionsContainer'); if(!userSelect || !modal) return; document.getElementById('selectedRoleKey').value = ""; userSelect.innerHTML = '<option value="">Selecione...</option>'; Object.values(state.scheduleData).sort((a,b)=>a.name.localeCompare(b.name)).forEach(user => { if (user.uid !== state.currentUser.uid) userSelect.innerHTML += `<option value="${user.uid}">${user.name} (${user.cargo || '-'})</option>`; }); roleContainer.innerHTML = ''; Object.entries(HIERARCHY).forEach(([key, config]) => { if (config.level <= 100) { const btn = document.createElement('div'); btn.className = `role-option cursor-pointer w-full p-2 mb-2 rounded border border-white/10 bg-white/5 flex items-center justify-between`; btn.onclick = (e) => window.selectRole(e, key); btn.innerHTML = `<span class="text-[10px] text-white font-bold">${config.label}</span><span class="text-[9px] text-gray-500">${config.level}</span>`; roleContainer.appendChild(btn); } }); modal.classList.remove('hidden'); }
function selectRole(e, key) { document.querySelectorAll('.role-option').forEach(el => el.classList.remove('border-purple-500', 'bg-purple-500/10')); e.currentTarget.classList.add('border-purple-500', 'bg-purple-500/10'); document.getElementById('selectedRoleKey').value = key; }
async function confirmPromotion() { const targetUid = document.getElementById('promoteTargetUser').value; const roleKey = document.getElementById('selectedRoleKey').value; if (!targetUid || !roleKey) return showNotification("Preencha todos os campos", "error"); const config = HIERARCHY[roleKey]; const targetUser = Object.values(state.scheduleData).find(u => u.uid === targetUid); askConfirmation(`Promover ${targetUser.name} para ${config.label}?`, async () => { try { await updateDoc(getCompanyDoc("users", targetUid), { cargo: config.label, role: config.role, level: config.level, promotedBy: state.currentUser.email }); document.getElementById('promoteModal').classList.add('hidden'); showNotification("Cargo Atualizado"); addAuditLog("Promoção", `${targetUser.name} -> ${config.label}`); } catch (e) { showNotification("Erro", "error"); } }); }
function renderAuditLogs() { const container = document.getElementById('screenLogs'); const q = query(getCompanyCollection("logs_auditoria"), orderBy("timestamp", "desc")); onSnapshot(q, (snap) => { if(!container) return; if(snap.empty) { container.innerHTML = '<p class="text-white/30 text-center text-xs mt-4">Sem logs.</p>'; return; } container.innerHTML = `<div class="premium-glass p-4 rounded-xl border border-white/5 h-[calc(100vh-140px)] flex flex-col mt-2"><h3 class="text-xs font-bold text-white mb-4">Auditoria</h3><div class="overflow-y-auto custom-scrollbar flex-1 space-y-2">${snap.docs.map(d => { const l = d.data(); const time = l.timestamp?.toDate().toLocaleString() || '--'; return `<div class="bg-white/5 p-2 rounded border border-white/5"><div class="flex justify-between"><span class="text-[9px] text-blue-300 font-bold">${l.action}</span><span class="text-[8px] text-gray-500">${time}</span></div><p class="text-[9px] text-gray-300">${l.target}</p><p class="text-[8px] text-gray-500">Por: ${l.adminEmail}</p></div>`; }).join('')}</div></div>`; }); }
async function addAuditLog(action, target) { try { await addDoc(getCompanyCollection("logs_auditoria"), { adminEmail: state.currentUser.email, action, target, timestamp: serverTimestamp() }); } catch(e){} }
function initApprovalsTab() { const list = document.getElementById('adminRequestsListSide'); if(!list && !document.getElementById('approvalsList')) return; const docId = `${state.selectedMonthObj.year}-${String(state.selectedMonthObj.month+1).padStart(2,'0')}`; const q = query(getCompanyCollection("solicitacoes"), where("monthId", "==", docId), where("status", "==", "pending_leader")); onSnapshot(q, (snap) => { const targetDiv = document.getElementById('approvalsList') || list; if(!targetDiv) return; if(snap.empty) { targetDiv.innerHTML = '<p class="text-center text-gray-500 text-[10px]">Nada pendente.</p>'; } else { targetDiv.innerHTML = snap.docs.map(d => { const r = d.data(); return `<div class="bg-white/5 p-3 rounded-lg border-l-4 border-yellow-500 flex justify-between items-center mb-2"><div><strong class="text-white text-[10px] block">${r.requester}</strong><span class="text-[9px] text-gray-400">${r.type} • Dia ${r.dayIndex+1}</span></div><div class="flex gap-1"><button onclick="window.approveRequest('${d.id}')" class="bg-emerald-500/20 text-emerald-400 p-1.5 rounded"><i class="fas fa-check text-[10px]"></i></button><button onclick="window.rejectRequest('${d.id}')" class="bg-red-500/20 text-red-400 p-1.5 rounded"><i class="fas fa-times text-[10px]"></i></button></div></div>`; }).join(''); } }); }
async function approveRequest(id) { await updateDoc(getCompanyDoc("solicitacoes", id), { status: 'approved' }); showNotification("Aprovado"); }
async function rejectRequest(id) { await updateDoc(getCompanyDoc("solicitacoes", id), { status: 'rejected' }); showNotification("Recusado"); }
function askConfirmation(msg, onConfirm) { const modal = document.getElementById('confirmModal') || document.getElementById('customConfirmModal'); if(!modal) { if(confirm(msg)) onConfirm(); return; } document.getElementById('modalMessage').innerHTML = msg; modal.classList.remove('hidden'); const btnConfirm = document.getElementById('modalConfirm'); const newBtn = btnConfirm.cloneNode(true); btnConfirm.parentNode.replaceChild(newBtn, btnConfirm); newBtn.onclick = () => { modal.classList.add('hidden'); onConfirm(); }; document.getElementById('modalCancel').onclick = () => modal.classList.add('hidden'); }
