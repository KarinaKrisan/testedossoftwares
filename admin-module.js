// admin-module.js - SaaS Dinâmico Multi-tenant
import { db, state, getCompanyCollection, getCompanyDoc, getCompanySubDoc } from './config.js';
import { showNotification, updateCalendar, renderWeekendDuty } from './ui.js';
import { doc, getDoc, setDoc, serverTimestamp, query, orderBy, onSnapshot, updateDoc, where, getDocs, collection, addDoc } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";

let allLoadedLogs = [];
let dailyUpdateInterval = null;
let activeTool = null; 

// --- NAVEGAÇÃO E INICIALIZAÇÃO ---
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

// --- LOGICA DOS MODAIS (SUBSTITUI CONFIRM) ---
function askConfirmation(message, onConfirm) {
    const modal = document.getElementById('customConfirmModal');
    const content = document.getElementById('modalContent');
    const msgEl = document.getElementById('modalMessage');
    
    if (!modal || !content || !msgEl) return;

    msgEl.innerText = message;
    modal.classList.remove('hidden');
    setTimeout(() => {
        content.classList.replace('opacity-0', 'opacity-100');
        content.classList.replace('scale-95', 'scale-100');
    }, 10);

    document.getElementById('modalConfirm').onclick = () => {
        modal.classList.add('hidden');
        onConfirm();
    };
    document.getElementById('modalCancel').onclick = () => modal.classList.add('hidden');
}

function showSuccessAnim(text = "Concluído") {
    const successModal = document.getElementById('successAnimModal');
    if (!successModal) return;
    successModal.querySelector('h3').innerText = text;
    successModal.classList.remove('hidden');
    setTimeout(() => successModal.classList.add('hidden'), 2000);
}

// --- GESTÃO DE CONVITES (Sincronizado com Nome da Empresa) ---
async function renderInviteWidget() {
    const container = document.getElementById('inviteWidgetContainer') || document.getElementById('adminControls');
    if (!container) return;
    
    let div = document.getElementById('inviteWidgetCard') || document.createElement('div');
    if (!div.id) { 
        div.id = 'inviteWidgetCard'; 
        div.className = "premium-glass p-3 mt-4 border-l-4 border-emerald-500 mb-4 animate-fade-in"; 
        container.prepend(div); 
    }

    try {
        const q = query(collection(db, "convites"), where("companyId", "==", state.companyId), where("active", "==", true));
        const snap = await getDocs(q);
        
        if (!snap.empty) {
            const inviteCode = snap.docs[0].id;
            const inviteLink = `${window.location.origin}${window.location.pathname.replace('index.html','')}/signup-colaborador.html?convite=${inviteCode}`;
            
            div.innerHTML = `
                <h3 class="text-[10px] font-bold text-white uppercase mb-1 flex items-center justify-between">
                    <span><i class="fas fa-link text-emerald-400"></i> Link Ativo</span>
                </h3>
                <div class="flex gap-1 mb-2">
                    <input type="text" value="${inviteLink}" id="inviteLinkInput" class="bg-black/30 border border-white/10 text-emerald-400 font-mono text-[9px] p-2 rounded w-full outline-none truncate" readonly>
                    <button id="btnCopyInvite" class="bg-white/10 hover:bg-white/20 text-white px-3 rounded text-[10px] border border-white/5 transition-all"><i class="fas fa-copy"></i></button>
                </div>
                <button id="btnRevokeInvite" class="w-full bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 py-1.5 rounded text-[9px] font-bold uppercase transition-colors">Revogar Link</button>`;

            document.getElementById('btnCopyInvite').onclick = () => {
                const ct = document.getElementById("inviteLinkInput");
                ct.select();
                navigator.clipboard.writeText(ct.value);
                showNotification("Link copiado!", "success");
            };

            document.getElementById('btnRevokeInvite').onclick = () => {
                askConfirmation("Ao revogar, ninguém mais poderá usar este link. Continuar?", async () => {
                    await updateDoc(doc(db, "convites", inviteCode), { active: false });
                    showSuccessAnim("Link Revogado");
                    renderInviteWidget();
                });
            };
        } else {
            div.innerHTML = `
                <h3 class="text-[10px] font-bold text-white uppercase mb-1"><i class="fas fa-ticket-alt text-gray-400"></i> Novo Convite</h3>
                <button id="btnGenerateInvite" class="w-full bg-emerald-600 hover:bg-emerald-500 text-white py-2 rounded text-[9px] font-bold uppercase shadow-lg transition-all">Gerar Link</button>`;
            
            document.getElementById('btnGenerateInvite').onclick = async () => {
                try {
                    const code = Math.random().toString(36).substring(2, 5).toUpperCase() + '-' + Math.random().toString(36).substring(2, 5).toUpperCase();
                    
                    // BUSCA DINÂMICA DO NOME DA ORGANIZAÇÃO (Ex: Sitelbra)
                    const companySnap = await getDoc(doc(db, "companies", state.companyId));
                    const companyName = companySnap.exists() ? (companySnap.data().name || companySnap.data().nome) : "Minha Empresa";

                    await setDoc(doc(db, "convites", code), { 
                        companyId: state.companyId, 
                        companyName: companyName, // Salva o nome da empresa, não da Karina Krisan
                        createdBy: state.currentUser.uid, 
                        createdAt: serverTimestamp(), 
                        active: true 
                    });
                    
                    showSuccessAnim("Link Gerado para " + companyName);
                    renderInviteWidget();
                } catch(err) {
                    console.error("Erro ao gerar:", err);
                    showNotification("Erro de permissão", "error");
                }
            };
        }
    } catch(e) { console.error(e); }
}

// --- DASHBOARD E ESCALAS ---
export function renderDailyDashboard() {
    const today = new Date().getDate() - 1; 
    const groups = { Ativo: [], Encerrado: [], Folga: [], Ferias: [] };

    Object.values(state.scheduleData).sort((a,b) => a.name.localeCompare(b.name)).forEach(emp => {
        const sToday = emp.schedule[today] || 'F';
        let group = ['FE', 'A', 'LM'].includes(sToday) ? 'Ferias' : (sToday === 'T' ? 'Ativo' : 'Folga');
        if (group) groups[group].push({ ...emp, status: sToday });
    });

    const render = (k, l) => {
        const count = document.getElementById(`count${k}`); if(count) count.innerText = l.length;
        const list = document.getElementById(`list${k}`);
        if(list) list.innerHTML = l.map(u => `<div class="dashboard-pill"><div class="pill-indicator bg-blue-500"></div><span class="text-[9px] font-bold text-white">${u.name}</span><span class="text-[8px] font-black opacity-40 text-white">${u.status}</span></div>`).join('');
    };
    Object.keys(groups).forEach(k => render(k, groups[k]));
}

async function confirmSaveToCloud() {
    const emp = document.getElementById('employeeSelect').value;
    if (!emp) return showNotification("Selecione um colaborador", "error");
    
    askConfirmation(`Deseja salvar as alterações de ${emp}?`, async () => {
        try {
            const user = state.scheduleData[emp];
            const docId = `${state.selectedMonthObj.year}-${String(state.selectedMonthObj.month+1).padStart(2,'0')}`;
            const ref = getCompanySubDoc("escalas", docId, "plantonistas", user.uid);
            await setDoc(ref, { calculatedSchedule: user.schedule }, { merge: true });
            await addAuditLog("Edição de Escala", emp);
            showSuccessAnim("Escala Salva");
            renderDailyDashboard();
        } catch(e) { console.error(e); showNotification("Erro ao salvar.", "error"); }
    });
}

export function populateEmployeeSelect() {
    const s = document.getElementById('employeeSelect');
    if(s) { 
        s.innerHTML = '<option value="">Selecionar...</option>'; 
        Object.keys(state.scheduleData || {}).sort().forEach(n => s.innerHTML += `<option value="${n}">${n}</option>`); 
    }
}

// --- FERRAMENTAS DE EDIÇÃO RESTAURADAS ---
function renderEditToolbar() {
    if (document.getElementById('editToolbar')) return;
    const toolbar = document.createElement('div');
    toolbar.id = 'editToolbar';
    toolbar.className = "flex flex-wrap justify-center gap-1.5 mb-4 animate-fade-in";
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
    toolbar.innerHTML = tools.map(t => `<button onclick="window.setEditTool('${t.id}')" class="tool-btn group relative px-2.5 py-1.5 rounded-lg bg-white/5 border ${t.border} flex items-center gap-1.5 ${activeTool === t.id ? 'bg-white/20 ring-1 ring-white/50' : 'opacity-60 hover:opacity-100'}"><i class="fas ${t.icon} ${t.color} text-[9px]"></i><span class="text-[8px] font-bold uppercase text-white tracking-wider">${t.label}</span></button>`).join('');
    document.getElementById('calendarContainer')?.insertBefore(toolbar, document.getElementById('calendarGrid'));
}
window.setEditTool = (id) => { activeTool = (id === 'null' || id === null) ? null : id; document.getElementById('editToolbar')?.remove(); renderEditToolbar(); };

export function handleAdminCellClick(name, i) {
    const user = state.scheduleData[name];
    if(!user) return;
    const seq = ['T', 'F', 'FS', 'FD', 'FE', 'A', 'LM'];
    user.schedule[i] = activeTool || seq[(seq.indexOf(user.schedule[i]||'F') + 1) % seq.length];
    updateCalendar(name, user.schedule);
    renderWeekendDuty();
}

// --- TROCAS E AUDITORIA ---
function initApprovalsTab() {
    const list = document.getElementById('adminRequestsListSide');
    if(!list) return;
    const docId = `${state.selectedMonthObj.year}-${String(state.selectedMonthObj.month+1).padStart(2,'0')}`;
    const q = query(getCompanyCollection("solicitacoes"), where("monthId", "==", docId), where("status", "==", "pending_leader"));
    onSnapshot(q, (snap) => {
        list.innerHTML = snap.empty ? '<p class="text-center text-gray-500 text-[10px] py-4 opacity-50">Nada pendente.</p>' : snap.docs.map(d => {
            const r = d.data();
            return `<div class="apple-glass p-3 mb-3 border-l-4 border-purple-500"><div class="flex justify-between mb-2"><strong class="text-white text-xs">${r.requester}</strong><span class="text-[8px] text-gray-400">DIA ${r.dayIndex+1}</span></div></div>`;
        }).join('');
    });
}

async function internalApplyLogFilter() {
    const q = query(getCompanyCollection("logs_auditoria"), orderBy("timestamp", "desc"));
    onSnapshot(q, (snap) => {
        allLoadedLogs = snap.docs.map(d => ({ date: d.data().timestamp?.toDate().toLocaleString()||'-', admin: d.data().adminEmail||'Sys', action: d.data().action||'-', target: d.data().target||'-' }));
    });
}

async function addAuditLog(action, target) {
    if(!state.currentUser) return;
    try { await addDoc(getCompanyCollection("logs_auditoria"), { adminEmail: state.currentUser.email, action, target, timestamp: serverTimestamp() }); } catch(e) {}
}
