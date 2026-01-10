// admin-module.js
import { db, state, getCompanyCollection, getCompanyDoc, getCompanySubDoc, HIERARCHY } from './config.js';
import { showNotification, updateCalendar } from './ui.js';
import { doc, getDoc, setDoc, serverTimestamp, query, orderBy, onSnapshot, updateDoc, where, getDocs, addDoc, deleteDoc } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";

let allLoadedLogs = [];
let dailyUpdateInterval = null;
let activeTool = null; 

// --- EXPORTAÇÕES GLOBAIS ---
window.openPromoteModal = openPromoteModal;
window.confirmPromotion = confirmPromotion;
window.selectRole = selectRole;
window.approveRequest = approveRequest;
window.rejectRequest = rejectRequest;
window.setEditTool = setEditTool;
window.renderInviteWidget = renderInviteWidget;

// --- INICIALIZAÇÃO E NAVEGAÇÃO ---
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
    if (view === 'logs') internalApplyLogFilter();
    
    const tb = document.getElementById('editToolbar');
    if (view === 'edit') { 
        if(tb) tb.classList.remove('hidden'); else renderEditToolbar(); 
    } else { 
        if(tb) tb.classList.add('hidden'); 
    }
}

export function initAdminUI() {
    ['adminTabNav', 'adminControls'].forEach(id => document.getElementById(id)?.classList.remove('hidden'));
    const btnSave = document.getElementById('btnSaveConfirm');
    if(btnSave) btnSave.onclick = confirmSaveToCloud;
    
    // Controle do Botão Gerir Cargos
    const btnRoles = document.getElementById('btnManageRoles');
    if (btnRoles) {
        const myLevel = state.profile?.level || 0;
        if (myLevel >= 60) {
            btnRoles.classList.remove('hidden'); 
        } else {
            btnRoles.classList.add('hidden');
        }
    }

    populateEmployeeSelect();
    renderEditToolbar(); 
    initApprovalsTab(); 
    renderInviteWidget(); 
    // REMOVIDO: renderMigrationTool(); <- Não carrega mais o botão laranja
    internalApplyLogFilter();
    switchAdminView('daily');
    
    if (dailyUpdateInterval) clearInterval(dailyUpdateInterval);
    dailyUpdateInterval = setInterval(() => { 
        const screen = document.getElementById('screenDaily');
        if (screen && !screen.classList.contains('hidden')) renderDailyDashboard(); 
    }, 60000);
}

// --- DASHBOARD: LÓGICA DE TURNOS ---
export function renderDailyDashboard() {
    const now = new Date();
    const currentHour = now.getHours();
    const todayIndex = now.getDate() - 1; 

    const groups = { Ativo: [], Encerrado: [], Folga: [], Ferias: [], Afastado: [], Licenca: [] };

    if(state.scheduleData) {
        Object.values(state.scheduleData).forEach(emp => {
            const sToday = emp.schedule[todayIndex] || 'F';
            const sYesterday = (todayIndex > 0) ? (emp.schedule[todayIndex - 1] || 'F') : 'F';

            let g = 'Encerrado'; 

            const h = emp.horario ? emp.horario.toLowerCase() : "";
            const isNightShift = h.includes("19:00 às 07:00") || h.includes("noite") || h.includes("noturno") || h.startsWith("19");

            if (isNightShift) {
                if (sToday === 'T') {
                    g = (currentHour >= 19) ? 'Ativo' : 'Encerrado';
                } 
                else if (sToday === 'F' && sYesterday === 'T' && currentHour < 7) {
                    g = 'Ativo';
                }
                else if (['F','FS','FD'].includes(sToday)) g = 'Folga';
                else if (sToday === 'FE') g = 'Ferias';
                else if (sToday === 'A') g = 'Afastado';
                else if (sToday === 'LM') g = 'Licenca';

            } else {
                if (sToday === 'T') {
                    g = (currentHour >= 19) ? 'Encerrado' : 'Ativo';
                } 
                else if (['F','FS','FD'].includes(sToday)) g = 'Folga';
                else if (sToday === 'FE') g = 'Ferias';
                else if (sToday === 'A') g = 'Afastado';
                else if (sToday === 'LM') g = 'Licenca';
            }

            if (groups[g]) groups[g].push({ ...emp, status: sToday });
        });
    }

    const render = (k, l) => {
        const count = document.getElementById(`count${k}`); if(count) count.innerText = l.length;
        const list = document.getElementById(`list${k}`);
        if(list) {
            let color = 'bg-gray-600';
            if (k === 'Ativo') color = 'bg-emerald-500';
            if (k === 'Folga') color = 'bg-yellow-500';
            if (k === 'Ferias') color = 'bg-red-500';
            if (k === 'Afastado') color = 'bg-orange-500';
            if (k === 'Licenca') color = 'bg-pink-500';

            list.innerHTML = l.map(u => `
                <div class="flex items-center justify-between bg-white/5 border border-white/5 rounded px-2 py-1 mb-1 hover:bg-white/10 transition-colors">
                    <div class="flex items-center gap-2">
                        <div class="w-1.5 h-1.5 rounded-full ${color} shadow-[0_0_5px_rgba(255,255,255,0.3)]"></div>
                        <span class="text-[9px] font-medium text-gray-300 truncate max-w-[90px]" title="${u.name}">${u.name.split(' ')[0]} ${u.name.split(' ')[1] ? u.name.split(' ')[1][0]+'.' : ''}</span>
                    </div>
                    <span class="text-[8px] text-white/30 font-mono tracking-tighter">${u.horario ? u.horario.split(' ')[0] : '08:00'}</span>
                </div>`
            ).join('');
        }
    };

    Object.keys(groups).forEach(k => render(k, groups[k]));
}

// --- WIDGET DE CONVITES ---
async function renderInviteWidget() {
    const container = document.getElementById('inviteWidgetContainer');
    if (!container) return; 
    container.innerHTML = `<div class="premium-glass p-4 rounded-xl border border-white/10 animate-pulse flex justify-center"><span class="text-[10px] text-gray-500 uppercase tracking-widest"><i class="fas fa-circle-notch fa-spin mr-2"></i> Carregando...</span></div>`;

    try {
        const q = query(getCompanyCollection("convites"), where("active", "==", true));
        const snap = await getDocs(q);

        if (!snap.empty) {
            const inviteCode = snap.docs[0].id;
            const inviteLink = `${window.location.origin}${window.location.pathname.replace('index.html','')}/signup-colaborador.html?convite=${inviteCode}&company=${state.companyId}`;

            container.innerHTML = `
                <div class="premium-glass p-4 rounded-xl border-l-4 border-emerald-500 shadow-[0_0_20px_rgba(16,185,129,0.1)]">
                    <div class="flex justify-between items-center mb-3">
                        <h3 class="text-[10px] font-bold text-emerald-400 uppercase tracking-widest"><i class="fas fa-ticket-alt mr-1"></i> Convite Ativo</h3>
                        <span class="text-[8px] bg-emerald-500/10 text-emerald-400 px-2 py-1 rounded border border-emerald-500/20 animate-pulse">Aguardando cadastro</span>
                    </div>
                    <div class="flex gap-2 mb-3">
                        <div class="relative w-full">
                            <input type="text" value="${inviteLink}" id="inviteLinkInput" class="w-full bg-black/40 border border-white/10 text-gray-300 font-mono text-[9px] p-3 rounded-lg outline-none focus:border-emerald-500/50 transition-all pr-10" readonly>
                            <div class="absolute right-3 top-3 text-gray-600"><i class="fas fa-link text-xs"></i></div>
                        </div>
                        <button id="btnCopyInvite" class="bg-white/5 hover:bg-white/10 border border-white/10 text-white px-4 rounded-lg transition-all active:scale-95 group relative"><i class="fas fa-copy text-gray-400 group-hover:text-white transition-colors"></i></button>
                    </div>
                    <button id="btnRevokeInvite" class="w-full bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 py-2 rounded-lg text-[9px] font-bold uppercase tracking-widest transition-all"><i class="fas fa-ban mr-1"></i> Revogar Link</button>
                </div>`;
            document.getElementById('btnCopyInvite').onclick = () => { const input = document.getElementById("inviteLinkInput"); input.select(); input.setSelectionRange(0, 99999); navigator.clipboard.writeText(input.value); showNotification("Link copiado!", "success"); };
            document.getElementById('btnRevokeInvite').onclick = () => { askConfirmation("Revogar este convite?", async () => { await updateDoc(getCompanyDoc("convites", inviteCode), { active: false }); showNotification("Convite revogado.", "success"); renderInviteWidget(); }); };
        } else {
            container.innerHTML = `
                <div class="premium-glass p-4 rounded-xl border border-white/5 border-dashed hover:border-white/10 transition-all group">
                    <div class="flex items-center justify-between mb-3"><h3 class="text-[10px] font-bold text-gray-400 uppercase tracking-widest group-hover:text-white transition-colors"><i class="fas fa-user-plus mr-1"></i> Novo Colaborador</h3></div>
                    <p class="text-[9px] text-gray-500 mb-3 leading-relaxed">Gere um link para adicionar novos membros à equipe.</p>
                    <button id="btnGenerateInvite" class="w-full bg-blue-600 hover:bg-blue-500 text-white py-3 rounded-xl text-[10px] font-bold uppercase tracking-widest shadow-lg shadow-blue-900/20 active:scale-95 transition-all"><i class="fas fa-magic mr-2"></i> Gerar Link de Convite</button>
                </div>`;
            document.getElementById('btnGenerateInvite').onclick = async () => {
                const btn = document.getElementById('btnGenerateInvite'); btn.innerHTML = '<i class="fas fa-circle-notch fa-spin mr-2"></i> Gerando...'; btn.disabled = true;
                try {
                    const companySnap = await getDoc(doc(db, "companies", state.companyId));
                    const companyName = companySnap.exists() ? (companySnap.data().name || companySnap.data().nome || "Sua Empresa") : "Sua Empresa";
                    const code = Math.random().toString(36).substring(2, 6).toUpperCase() + '-' + Math.random().toString(36).substring(2, 6).toUpperCase();
                    await setDoc(getCompanyDoc("convites", code), { createdBy: state.currentUser.uid, createdAt: serverTimestamp(), active: true, companyName: companyName, companyId: state.companyId });
                    showNotification("Link gerado!", "success"); renderInviteWidget();
                } catch (error) { showNotification("Erro ao gerar.", "error"); btn.innerHTML = 'Tentar Novamente'; btn.disabled = false; }
            };
        }
    } catch (e) { console.error("Erro no widget:", e); }
}

// --- GESTÃO DE CARGOS ---
function openPromoteModal() {
    const modal = document.getElementById('promoteModal');
    const userSelect = document.getElementById('promoteTargetUser');
    const roleContainer = document.getElementById('roleOptionsContainer');
    document.getElementById('selectedRoleKey').value = ""; userSelect.innerHTML = '<option value="">Selecione...</option>';
    if(state.scheduleData) { Object.values(state.scheduleData).sort((a,b)=>a.name.localeCompare(b.name)).forEach(user => { if (user.uid !== state.currentUser.uid) { userSelect.innerHTML += `<option value="${user.uid}">${user.name} (${user.cargo || 'S/ Cargo'})</option>`; } }); }
    roleContainer.innerHTML = '';
    Object.entries(HIERARCHY).forEach(([key, config]) => {
        if (config.level <= 100) { 
            const btn = document.createElement('div'); btn.className = `role-option cursor-pointer w-full p-3 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 transition-all flex items-center justify-between group`;
            btn.onclick = (e) => window.selectRole(e, key);
            btn.innerHTML = `<div class="flex items-center gap-3"><div class="w-10 h-10 rounded-lg bg-black/40 flex items-center justify-center text-sm font-bold text-gray-400 group-hover:text-white border border-white/5 transition-colors">${config.level}</div><div><div class="text-[11px] font-bold text-gray-200 group-hover:text-white uppercase tracking-wider">${config.label}</div><div class="text-[9px] text-gray-500 group-hover:text-gray-400 font-mono">${config.role}</div></div></div><div class="w-4 h-4 rounded-full border-2 border-white/20 flex items-center justify-center role-check-circle transition-colors"><div class="w-2 h-2 rounded-full bg-transparent role-check-dot transition-colors"></div></div>`;
            roleContainer.appendChild(btn);
        }
    });
    modal.classList.remove('hidden');
}

function selectRole(e, key) {
    document.querySelectorAll('.role-option').forEach(el => { el.classList.remove('border-purple-500', 'bg-purple-500/10'); el.querySelector('.role-check-circle').classList.remove('border-purple-500'); el.querySelector('.role-check-dot').classList.remove('bg-purple-500'); });
    const selectedDiv = e.currentTarget; selectedDiv.classList.add('border-purple-500', 'bg-purple-500/10'); selectedDiv.querySelector('.role-check-circle').classList.add('border-purple-500'); selectedDiv.querySelector('.role-check-dot').classList.add('bg-purple-500');
    document.getElementById('selectedRoleKey').value = key;
}

async function confirmPromotion() {
    const targetUid = document.getElementById('promoteTargetUser').value; const roleKey = document.getElementById('selectedRoleKey').value;
    if (!targetUid || !roleKey) return showNotification("Selecione colaborador e cargo.", "error");
    const config = HIERARCHY[roleKey]; const targetUser = Object.values(state.scheduleData).find(u => u.uid === targetUid);
    askConfirmation(`Promover ${targetUser.name} para ${config.label}?`, async () => {
        try { await updateDoc(getCompanyDoc("users", targetUid), { cargo: config.label, role: config.role, level: config.level, updatedAt: serverTimestamp(), _claimsRefresh: Date.now(), promotedBy: state.currentUser.email });
        document.getElementById('promoteModal').classList.add('hidden'); showNotification("Cargo Atualizado"); await addAuditLog("Gestão de Equipe", `Alterou ${targetUser.name} para ${config.label}`); } catch (e) { showNotification("Erro: " + e.message, "error"); }
    });
}

// --- LOGS E AUDITORIA ---
async function internalApplyLogFilter() {
    const q = query(getCompanyCollection("logs_auditoria"), orderBy("timestamp", "desc"));
    onSnapshot(q, (snap) => {
        allLoadedLogs = snap.docs.map(d => { const data = d.data(); return { id: d.id, date: data.timestamp?.toDate ? data.timestamp.toDate().toLocaleString('pt-BR') : "---", admin: data.adminEmail || 'Sistema', action: data.action || 'Ação', target: data.target || '-' }; });
        const logsScreen = document.getElementById('screenLogs'); if (logsScreen && !logsScreen.classList.contains('hidden')) renderAuditLogs();
    });
}
function renderAuditLogs() {
    const container = document.getElementById('screenLogs'); if(!container) return;
    if(allLoadedLogs.length === 0) { container.innerHTML = `<div class="premium-glass p-10 text-center rounded-xl mt-4"><p class="text-gray-500 text-xs">Sem registros</p></div>`; return; }
    container.innerHTML = `<div class="premium-glass p-4 rounded-xl h-[calc(100vh-140px)] flex flex-col mt-2"><div class="flex justify-between mb-4"><h3 class="text-xs font-bold text-white uppercase"><i class="fas fa-fingerprint text-blue-400"></i> Auditoria</h3></div><div class="overflow-y-auto custom-scrollbar flex-1 space-y-2">` + allLoadedLogs.map(log => `<div class="bg-white/5 p-3 rounded-lg border border-white/5"><div class="flex justify-between"><span class="text-[9px] font-bold text-blue-200">${log.action}</span><span class="text-[8px] text-gray-500">${log.date}</span></div><div class="text-[10px] text-gray-300 mt-1">${log.target}</div><div class="text-[8px] text-gray-500 mt-1"><i class="fas fa-user-shield"></i> ${log.admin}</div></div>`).join('') + `</div></div>`;
}
async function addAuditLog(action, target) { if(!state.currentUser) return; try { await addDoc(getCompanyCollection("logs_auditoria"), { adminEmail: state.currentUser.email, action, target, timestamp: serverTimestamp() }); } catch(e) {} }

// --- FERRAMENTAS ---
// REMOVIDO: Funções de Migração (renderMigrationTool e runLegacyMigration)

// --- EDIÇÃO DE ESCALA ---
async function confirmSaveToCloud() {
    const emp = document.getElementById('employeeSelect').value; if (!emp) return showNotification("Selecione um colaborador", "error");
    askConfirmation(`Salvar escala de ${emp}?`, async () => {
        try { const user = state.scheduleData[emp]; const safeSchedule = user.schedule.map(v => (v===undefined||v===null||v==="")?"F":v); const docId = `${state.selectedMonthObj.year}-${String(state.selectedMonthObj.month+1).padStart(2,'0')}`; await setDoc(getCompanySubDoc("escalas", docId, "plantonistas", user.uid), { calculatedSchedule: safeSchedule }, { merge: true }); await addAuditLog("Edição de Escala", emp); showNotification("Salvo com sucesso"); user.schedule = safeSchedule; renderDailyDashboard(); } catch(e) { showNotification(e.message, "error"); }
    });
}

function initApprovalsTab() {
    const list = document.getElementById('adminRequestsListSide'); if(!list) return;
    const docId = `${state.selectedMonthObj.year}-${String(state.selectedMonthObj.month+1).padStart(2,'0')}`;
    const q = query(getCompanyCollection("solicitacoes"), where("monthId", "==", docId), where("status", "==", "pending_leader"));
    onSnapshot(q, (snap) => { const badge = document.getElementById('notificationBadge'); if(badge) badge.classList.toggle('hidden', snap.empty); list.innerHTML = snap.empty ? '<p class="text-center text-gray-500 text-[10px]">Nada pendente.</p>' : snap.docs.map(d => `<div class="bg-white/5 p-3 rounded-lg border-l-4 border-yellow-500 flex justify-between"><div><strong class="text-white text-[10px] block">${d.data().requester}</strong><span class="text-[9px] text-gray-400">${d.data().type}</span></div><div class="flex gap-1"><button onclick="window.approveRequest('${d.id}')" class="bg-emerald-500/20 text-emerald-400 p-1.5 rounded"><i class="fas fa-check"></i></button><button onclick="window.rejectRequest('${d.id}')" class="bg-red-500/20 text-red-400 p-1.5 rounded"><i class="fas fa-times"></i></button></div></div>`).join(''); });
}
async function approveRequest(id) { await updateDoc(getCompanyDoc("solicitacoes", id), { status: 'approved' }); showNotification("Aprovado"); }
async function rejectRequest(id) { await updateDoc(getCompanyDoc("solicitacoes", id), { status: 'rejected' }); showNotification("Recusado"); }

function askConfirmation(message, onConfirm) {
    const modal = document.getElementById('customConfirmModal'); document.getElementById('modalMessage').innerHTML = message; modal.classList.remove('hidden'); setTimeout(() => document.getElementById('modalContent').classList.remove('opacity-0', 'scale-95'), 10);
    document.getElementById('modalConfirm').onclick = () => { modal.classList.add('hidden'); onConfirm(); }; document.getElementById('modalCancel').onclick = () => modal.classList.add('hidden');
}

export function populateEmployeeSelect() { const s = document.getElementById('employeeSelect'); if(s && state.scheduleData) { s.innerHTML = '<option value="">Selecionar...</option>' + Object.keys(state.scheduleData).sort().filter(n=>state.scheduleData[n].level < 100).map(n=>`<option value="${n}">${n}</option>`).join(''); } }
function renderEditToolbar() {
    if (document.getElementById('editToolbar')) return;
    const toolbar = document.createElement('div'); toolbar.id = 'editToolbar'; toolbar.className = "flex flex-wrap justify-center gap-1.5 mb-4";
    const tools = [ { id: null, label: 'Auto', icon: 'fa-sync', color: 'text-gray-400', border: 'border-white/10' }, { id: 'T', label: 'T', icon: 'fa-briefcase', color: 'text-emerald-400', border: 'border-emerald-500/50' }, { id: 'F', label: 'F', icon: 'fa-coffee', color: 'text-amber-400', border: 'border-amber-500/50' }, { id: 'FS', label: 'Sab', icon: 'fa-sun', color: 'text-[#40E0D0]', border: 'border-[#40E0D0]' }, { id: 'FD', label: 'Dom', icon: 'fa-sun', color: 'text-[#4169E1]', border: 'border-[#4169E1]' }, { id: 'FE', label: 'Fér', icon: 'fa-plane', color: 'text-red-400', border: 'border-red-500/50' }, { id: 'A', label: 'Af', icon: 'fa-user-injured', color: 'text-orange-400', border: 'border-orange-500/50' }, { id: 'LM', label: 'LM', icon: 'fa-baby', color: 'text-pink-400', border: 'border-pink-500/50' } ];
    toolbar.innerHTML = tools.map(t => `<button onclick="window.setEditTool('${t.id}')" class="px-2.5 py-1.5 rounded-lg bg-white/5 border ${t.border} flex items-center gap-1.5"><i class="fas ${t.icon} ${t.color} text-[9px]"></i><span class="text-[8px] font-bold text-white uppercase">${t.label}</span></button>`).join('');
    document.getElementById('calendarContainer')?.insertBefore(toolbar, document.getElementById('calendarGrid'));
}
function setEditTool(id) { activeTool = (id === 'null' || id === null) ? null : id; }
export function handleAdminCellClick(name, i) { const user = state.scheduleData[name]; if(!user) return; const seq = ['T', 'F', 'FS', 'FD', 'FE', 'A', 'LM']; const currentVal = user.schedule[i] || 'F'; user.schedule[i] = activeTool || seq[(seq.indexOf(currentVal) + 1) % seq.length]; updateCalendar(name, user.schedule); }
