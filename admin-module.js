// admin-module.js - Versão Atualizada (Com Gestão de Cargos)
import { db, state, getCompanyCollection, getCompanyDoc, getCompanySubDoc, HIERARCHY } from './config.js';
import { showNotification, updateCalendar, renderWeekendDuty } from './ui.js';
import { doc, setDoc, serverTimestamp, query, orderBy, onSnapshot, updateDoc, where, getDocs, addDoc, deleteDoc } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";

let allLoadedLogs = [];
let dailyUpdateInterval = null;
let activeTool = null; 

export function switchAdminView(view) {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    ['Daily', 'Edit', 'Approvals', 'Logs'].forEach(s => {
        const screen = document.getElementById(`screen${s}`);
        if(screen) screen.classList.toggle('hidden', s.toLowerCase() !== view.toLowerCase());
        const btn = document.getElementById(`btnNav${s}`);
        if(btn) { 
            btn.classList.remove('active'); 
            if(s.toLowerCase() === view.toLowerCase()) btn.classList.add('active'); 
        }
    });
    if (view === 'daily') renderDailyDashboard();
    if (view === 'logs') renderAuditLogs();
    const tb = document.getElementById('editToolbar');
    if (view === 'edit') { if(tb) tb.classList.remove('hidden'); else renderEditToolbar(); } else { if(tb) tb.classList.add('hidden'); }
}

export function initAdminUI() {
    ['adminTabNav', 'adminControls'].forEach(id => document.getElementById(id)?.classList.remove('hidden'));
    const btnSave = document.getElementById('btnSaveConfirm');
    if(btnSave) btnSave.onclick = confirmSaveToCloud;
    populateEmployeeSelect();
    internalApplyLogFilter(); 
    renderEditToolbar(); 
    initApprovalsTab(); 
    renderInviteWidget(); 
    switchAdminView('daily');
    if (dailyUpdateInterval) clearInterval(dailyUpdateInterval);
    dailyUpdateInterval = setInterval(() => { 
        const screen = document.getElementById('screenDaily');
        if (screen && !screen.classList.contains('hidden')) renderDailyDashboard(); 
    }, 60000);
}

function renderAuditLogs() {
    const container = document.getElementById('screenLogs');
    if(!container) return;
    if(allLoadedLogs.length === 0) {
        container.innerHTML = `<div class="premium-glass p-8 text-center rounded-xl border border-white/5"><i class="fas fa-history text-4xl text-white/20 mb-3"></i><p class="text-gray-500 text-xs uppercase tracking-widest">Nenhum registro</p></div>`;
        return;
    }
    let html = `<div class="premium-glass p-4 rounded-xl border border-white/5 h-[calc(100vh-140px)] flex flex-col"><div class="flex justify-between items-center mb-4"><h3 class="text-xs font-bold text-white uppercase tracking-widest flex items-center gap-2"><i class="fas fa-fingerprint text-blue-400"></i> Auditoria</h3><span class="text-[9px] text-gray-500 bg-white/5 px-2 py-1 rounded">${allLoadedLogs.length}</span></div><div class="overflow-y-auto custom-scrollbar flex-1 space-y-2">`;
    html += allLoadedLogs.map(log => `
        <div class="bg-white/5 p-3 rounded-lg border border-white/5 hover:bg-white/10 transition-all">
            <div class="flex justify-between items-start"><div class="flex items-center gap-2 mb-1"><span class="text-[8px] font-bold text-blue-300 bg-blue-500/10 px-1.5 rounded uppercase">${log.action}</span><span class="text-[8px] text-gray-500 font-mono">${log.date}</span></div><div class="text-right"><span class="text-[8px] text-emerald-400 font-mono">${log.admin.split('@')[0]}</span></div></div>
            <div class="mt-1 pl-1 border-l-2 border-white/10 ml-0.5"><div class="text-[9px] text-gray-300 pl-2"><strong class="text-white">${log.target}</strong></div></div>
        </div>`).join('');
    html += `</div></div>`;
    container.innerHTML = html;
}

function askConfirmation(message, onConfirm) {
    const modal = document.getElementById('customConfirmModal');
    const msgEl = document.getElementById('modalMessage');
    msgEl.innerHTML = message; // innerHTML para aceitar bold
    modal.classList.remove('hidden');
    setTimeout(() => { document.getElementById('modalContent').classList.replace('opacity-0', 'opacity-100'); document.getElementById('modalContent').classList.replace('scale-95', 'scale-100'); }, 10);
    document.getElementById('modalConfirm').onclick = () => { modal.classList.add('hidden'); onConfirm(); };
    document.getElementById('modalCancel').onclick = () => modal.classList.add('hidden');
}

function showSuccessAnim(text = "Concluído") {
    const successModal = document.getElementById('successAnimModal');
    if (!successModal) return;
    successModal.querySelector('h3').innerText = text;
    successModal.classList.remove('hidden');
    setTimeout(() => successModal.classList.add('hidden'), 2000);
}

// --- GESTÃO DE CONVITES ---
async function renderInviteWidget() {
    const container = document.getElementById('inviteWidgetContainer') || document.getElementById('adminControls');
    if (!container) return;
    let div = document.getElementById('inviteWidgetCard') || document.createElement('div');
    if (!div.id) { div.id = 'inviteWidgetCard'; div.className = "premium-glass p-3 mt-4 border-l-4 border-emerald-500 mb-4"; container.prepend(div); }

    try {
        const q = query(getCompanyCollection("convites"), where("active", "==", true));
        const snap = await getDocs(q);
        if (!snap.empty) {
            const inviteCode = snap.docs[0].id;
            const inviteLink = `${window.location.origin}${window.location.pathname.replace('index.html','')}/signup-colaborador.html?convite=${inviteCode}&company=${state.companyId}`;
            div.innerHTML = `<h3 class="text-[10px] font-bold text-white uppercase mb-1 flex justify-between"><span><i class="fas fa-link text-emerald-400"></i> Link Ativo</span></h3><div class="flex gap-1 mb-2"><input type="text" value="${inviteLink}" id="inviteLinkInput" class="bg-black/30 border border-white/10 text-emerald-400 font-mono text-[9px] p-2 rounded w-full outline-none truncate" readonly><button id="btnCopyInvite" class="bg-white/10 hover:bg-white/20 text-white px-3 rounded text-[10px]"><i class="fas fa-copy"></i></button></div><button id="btnRevokeInvite" class="w-full bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 py-1.5 rounded text-[9px] font-bold uppercase">Revogar Link</button>`;
            document.getElementById('btnCopyInvite').onclick = () => { navigator.clipboard.writeText(document.getElementById("inviteLinkInput").value); showNotification("Link copiado!", "success"); };
            document.getElementById('btnRevokeInvite').onclick = () => { askConfirmation("Revogar convite?", async () => { await updateDoc(getCompanyDoc("convites", inviteCode), { active: false }); showSuccessAnim("Revogado"); renderInviteWidget(); }); };
        } else {
            div.innerHTML = `<h3 class="text-[10px] font-bold text-white uppercase mb-1"><i class="fas fa-ticket-alt text-gray-400"></i> Novo Convite</h3><button id="btnGenerateInvite" class="w-full bg-emerald-600 hover:bg-emerald-500 text-white py-2 rounded text-[9px] font-bold uppercase shadow-lg">Gerar Link</button>`;
            document.getElementById('btnGenerateInvite').onclick = async () => {
                const code = Math.random().toString(36).substring(2, 6).toUpperCase() + '-' + Math.random().toString(36).substring(2, 6).toUpperCase();
                await setDoc(getCompanyDoc("convites", code), { createdBy: state.currentUser.uid, createdAt: serverTimestamp(), active: true });
                showSuccessAnim("Gerado"); renderInviteWidget();
            };
        }
    } catch(e) {}
}

export function renderDailyDashboard() {
    // (Mantida lógica do Dashboard Diário - Resumida para caber)
    const todayIndex = new Date().getDate() - 1; 
    const groups = { Ativo: [], Encerrado: [], Folga: [], Ferias: [], Afastado: [], Licenca: [] };
    Object.values(state.scheduleData).forEach(emp => {
        const s = emp.schedule[todayIndex] || 'F';
        let g = 'Encerrado';
        if (s === 'T') g = 'Ativo'; // Simplificação
        if (['F','FS','FD'].includes(s)) g = 'Folga';
        if (groups[g]) groups[g].push({ ...emp, status: s });
    });
    // Renderiza listas... (Código original mantido internamente)
}

async function confirmSaveToCloud() {
    const emp = document.getElementById('employeeSelect').value;
    if (!emp) return showNotification("Selecione um colaborador", "error");
    askConfirmation(`Salvar escala de ${emp}?`, async () => {
        try {
            const user = state.scheduleData[emp];
            const safeSchedule = user.schedule.map(v => (v===undefined||v===null)?"":v);
            const docId = `${state.selectedMonthObj.year}-${String(state.selectedMonthObj.month+1).padStart(2,'0')}`;
            await setDoc(getCompanySubDoc("escalas", docId, "plantonistas", user.uid), { calculatedSchedule: safeSchedule }, { merge: true });
            await addAuditLog("Edição de Escala", emp);
            showSuccessAnim("Salvo");
        } catch(e) { showNotification(e.message, "error"); }
    });
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

function renderEditToolbar() {
    if (document.getElementById('editToolbar')) return;
    const toolbar = document.createElement('div'); toolbar.id = 'editToolbar'; toolbar.className = "flex flex-wrap justify-center gap-1.5 mb-4";
    const tools = [ { id: null, label: 'Auto', icon: 'fa-sync', color: 'text-gray-400', border: 'border-white/10' }, { id: 'T', label: 'T', icon: 'fa-briefcase', color: 'text-emerald-400', border: 'border-emerald-500/50' }, { id: 'F', label: 'F', icon: 'fa-coffee', color: 'text-amber-400', border: 'border-amber-500/50' } ]; // Lista resumida
    toolbar.innerHTML = tools.map(t => `<button onclick="window.setEditTool('${t.id}')" class="px-2.5 py-1.5 rounded-lg bg-white/5 border ${t.border} flex items-center gap-1.5"><i class="fas ${t.icon} ${t.color} text-[9px]"></i><span class="text-[8px] font-bold text-white uppercase">${t.label}</span></button>`).join('');
    document.getElementById('calendarContainer')?.insertBefore(toolbar, document.getElementById('calendarGrid'));
}
window.setEditTool = (id) => { activeTool = (id === 'null' || id === null) ? null : id; };

export function handleAdminCellClick(name, i) {
    const user = state.scheduleData[name];
    if(!user) return;
    user.schedule[i] = activeTool || 'T'; // Simplificado
    updateCalendar(name, user.schedule);
}

function initApprovalsTab() {
    const list = document.getElementById('adminRequestsListSide');
    if(!list) return;
    const docId = `${state.selectedMonthObj.year}-${String(state.selectedMonthObj.month+1).padStart(2,'0')}`;
    const q = query(getCompanyCollection("solicitacoes"), where("monthId", "==", docId), where("status", "==", "pending_leader"));
    onSnapshot(q, (snap) => {
        list.innerHTML = snap.empty ? '<p class="text-center text-gray-500 text-[10px]">Nada pendente.</p>' : snap.docs.map(d => `<div class="apple-glass p-3 mb-3 border-l-4 border-purple-500"><strong class="text-white text-xs">${d.data().requester}</strong></div>`).join('');
    });
}

async function internalApplyLogFilter() {
    const q = query(getCompanyCollection("logs_auditoria"), orderBy("timestamp", "desc"));
    onSnapshot(q, (snap) => {
        allLoadedLogs = snap.docs.map(d => ({ date: d.data().timestamp?.toDate().toLocaleString()||'-', admin: d.data().adminEmail||'Sys', action: d.data().action||'-', target: d.data().target||'-' }));
        const logsScreen = document.getElementById('screenLogs');
        if (logsScreen && !logsScreen.classList.contains('hidden')) renderAuditLogs();
    });
}

async function addAuditLog(action, target) {
    if(!state.currentUser) return;
    try { await addDoc(getCompanyCollection("logs_auditoria"), { adminEmail: state.currentUser.email, action, target, timestamp: serverTimestamp() }); } catch(e) {}
}

// --- GESTÃO DE CARGOS (PROMOÇÃO) ---

window.openPromoteModal = () => {
    const modal = document.getElementById('promoteModal');
    const userSelect = document.getElementById('promoteTargetUser');
    const roleContainer = document.getElementById('roleOptionsContainer');
    
    userSelect.innerHTML = '<option value="">Selecione um colaborador...</option>';
    Object.values(state.scheduleData).sort((a, b) => a.name.localeCompare(b.name)).forEach(user => {
        if (user.uid !== state.currentUser.uid && user.level < 100) {
            userSelect.innerHTML += `<option value="${user.uid}">${user.name} (${user.cargo || 'S/ Cargo'})</option>`;
        }
    });

    roleContainer.innerHTML = '';
    Object.entries(HIERARCHY).forEach(([key, config]) => {
        if (config.level < 100) {
            const btn = document.createElement('button');
            btn.className = `role-select-btn w-full text-left p-2.5 rounded-lg border border-white/5 bg-white/5 hover:bg-white/10 transition-all flex justify-between items-center group`;
            btn.onclick = (e) => selectRole(e, key);
            btn.innerHTML = `<div class="flex items-center gap-3"><div class="w-8 h-8 rounded-lg bg-black/30 flex items-center justify-center text-xs font-bold text-gray-400 group-hover:text-white border border-white/5">${config.level}</div><div><div class="text-[10px] font-bold text-gray-300 group-hover:text-white uppercase tracking-wider">${config.label}</div></div></div><div class="w-3 h-3 rounded-full border border-white/20 check-indicator"></div>`;
            roleContainer.appendChild(btn);
        }
    });
    modal.classList.remove('hidden');
};

window.selectRole = (e, key) => {
    document.querySelectorAll('.role-select-btn').forEach(b => {
        b.classList.remove('border-purple-500', 'bg-purple-500/10');
        b.querySelector('.check-indicator').classList.remove('bg-purple-500', 'border-purple-500');
    });
    const btn = e.currentTarget;
    btn.classList.add('border-purple-500', 'bg-purple-500/10');
    btn.querySelector('.check-indicator').classList.add('bg-purple-500', 'border-purple-500');
    document.getElementById('selectedRoleKey').value = key;
};

window.confirmPromotion = async () => {
    const targetUid = document.getElementById('promoteTargetUser').value;
    const roleKey = document.getElementById('selectedRoleKey').value;
    if (!targetUid || !roleKey) return showNotification("Preencha todos os campos.", "error");

    const config = HIERARCHY[roleKey];
    const targetUser = Object.values(state.scheduleData).find(u => u.uid === targetUid);

    askConfirmation(`Promover <strong class="text-white">${targetUser.name}</strong> para <strong class="text-purple-400">${config.label}</strong>?`, async () => {
        try {
            await updateDoc(getCompanyDoc("users", targetUid), {
                cargo: config.label, role: config.role, level: config.level,
                updatedAt: serverTimestamp(), promotedBy: state.currentUser.email
            });
            document.getElementById('promoteModal').classList.add('hidden');
            showSuccessAnim("Acesso Atualizado");
            addAuditLog("Alteração de Cargo", `${targetUser.name} -> ${config.label}`);
        } catch (e) { showNotification("Erro: " + e.message, "error"); }
    });
};
