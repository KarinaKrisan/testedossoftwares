// admin-module.js - Versão Atualizada (Correção de Permissões SaaS)
import { db, state, getCompanyCollection, getCompanyDoc, getCompanySubDoc } from './config.js';
import { showNotification, updateCalendar, renderWeekendDuty } from './ui.js';
import { doc, setDoc, serverTimestamp, query, orderBy, onSnapshot, updateDoc, where, getDocs, addDoc, deleteDoc } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";

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
    if (view === 'logs') renderAuditLogs();
    
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
    
    // Atualiza o dashboard a cada minuto
    if (dailyUpdateInterval) clearInterval(dailyUpdateInterval);
    dailyUpdateInterval = setInterval(() => { 
        const screen = document.getElementById('screenDaily');
        if (screen && !screen.classList.contains('hidden')) renderDailyDashboard(); 
    }, 60000);
}

// --- RENDERIZAÇÃO DE LOGS ---
function renderAuditLogs() {
    const container = document.getElementById('screenLogs');
    if(!container) return;

    if(allLoadedLogs.length === 0) {
        container.innerHTML = `
            <div class="premium-glass p-8 text-center rounded-xl border border-white/5">
                <i class="fas fa-history text-4xl text-white/20 mb-3"></i>
                <p class="text-gray-500 text-xs uppercase tracking-widest">Nenhum registro encontrado</p>
            </div>`;
        return;
    }

    let html = `
    <div class="premium-glass p-1 md:p-4 rounded-xl border border-white/5 flex flex-col h-[calc(100vh-140px)] md:h-[calc(100vh-180px)]">
        <div class="flex justify-between items-center mb-4 px-2 pt-2">
            <h3 class="text-xs font-bold text-white uppercase tracking-widest flex items-center gap-2">
                <i class="fas fa-fingerprint text-blue-400"></i> Auditoria
            </h3>
            <span class="text-[9px] text-gray-500 bg-white/5 px-2 py-1 rounded border border-white/5">
                ${allLoadedLogs.length} Registros
            </span>
        </div>
        <div class="overflow-y-auto custom-scrollbar flex-1 space-y-2 pr-1 md:pr-2">`;

    html += allLoadedLogs.map(log => `
        <div class="bg-white/5 p-3 rounded-lg border border-white/5 hover:bg-white/10 transition-all group">
            <div class="flex justify-between items-start">
                <div class="flex items-center gap-2 mb-1">
                    <span class="text-[8px] font-bold text-blue-300 bg-blue-500/10 px-1.5 py-0.5 rounded uppercase tracking-wider border border-blue-500/20">
                        ${log.action}
                    </span>
                    <span class="text-[8px] text-gray-500 font-mono flex items-center gap-1">
                        <i class="far fa-clock text-[7px]"></i> ${log.date}
                    </span>
                </div>
                <div class="text-right">
                     <span class="text-[8px] text-emerald-400 font-mono bg-emerald-500/10 px-1.5 rounded border border-emerald-500/10" title="${log.admin}">
                        ${log.admin.split('@')[0]}
                      </span>
                </div>
            </div>
            <div class="mt-1 pl-1 border-l-2 border-white/10 ml-0.5">
                <div class="text-[9px] text-gray-300 pl-2">
                    <span class="text-white/30 uppercase text-[7px] tracking-wider mr-1">Alvo:</span> 
                    <strong class="text-white">${log.target}</strong>
                </div>
            </div>
        </div>
    `).join('');

    html += `</div></div>`;
    container.innerHTML = html;
}

// --- LOGICA DOS MODAIS ---
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

// --- GESTÃO DE CONVITES (CORRIGIDO: Escopo da Empresa) ---
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
        // CORREÇÃO AQUI: Usa getCompanyCollection para buscar dentro da empresa
        const q = query(getCompanyCollection("convites"), where("active", "==", true));
        const snap = await getDocs(q);
        
        if (!snap.empty) {
            const inviteCode = snap.docs[0].id;
            // Adiciona o companyId na URL para facilitar o cadastro depois, ou apenas o código se for único
            const inviteLink = `${window.location.origin}${window.location.pathname.replace('index.html','')}/signup-colaborador.html?convite=${inviteCode}&company=${state.companyId}`;
            
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
                    // CORREÇÃO: Usa getCompanyDoc
                    await updateDoc(getCompanyDoc("convites", inviteCode), { active: false });
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
                    // Gera código alfanumérico simples
                    const code = Math.random().toString(36).substring(2, 6).toUpperCase() + '-' + Math.random().toString(36).substring(2, 6).toUpperCase();
                    
                    // Salva DENTRO da empresa (companies/{id}/convites/{code})
                    await setDoc(getCompanyDoc("convites", code), { 
                        createdBy: state.currentUser.uid, 
                        createdAt: serverTimestamp(), 
                        active: true 
                    });
                    
                    showSuccessAnim("Link Gerado");
                    renderInviteWidget();
                } catch(err) {
                    console.error("Erro ao gerar:", err);
                    showNotification("Erro de permissão: " + err.message, "error");
                }
            };
        }
    } catch(e) { console.error(e); }
}

// --- DASHBOARD INTELIGENTE ---
export function renderDailyDashboard() {
    const todayIndex = new Date().getDate() - 1; 
    const now = new Date();
    const currentMinutes = now.getHours() * 60 + now.getMinutes();

    const getMins = (str) => {
        if(!str) return 0;
        const [h, m] = str.split(':').map(Number);
        return h * 60 + m;
    };

    const groups = { Ativo: [], Encerrado: [], Folga: [], Ferias: [], Afastado: [], Licenca: [] };

    Object.values(state.scheduleData).sort((a,b) => a.name.localeCompare(b.name)).forEach(emp => {
        // Filtro opcional: CEO não aparece no dashboard
        // if (emp.level >= 100) return;

        const sToday = emp.schedule[todayIndex] || 'F';
        const sYesterday = todayIndex > 0 ? (emp.schedule[todayIndex - 1] || 'F') : 'F'; 
        
        let group = 'Encerrado';

        let isNightShift = false;
        let startMin = 480; 
        let endMin = 1020;  
        
        const times = (emp.horario || "08:00 às 17:00").match(/(\d{1,2}:\d{2})/g);
        if (times && times.length >= 2) {
            startMin = getMins(times[0]);
            endMin = getMins(times[1]);
            if (endMin < startMin) isNightShift = true; 
        }

        if (sToday !== 'T' && sYesterday === 'T' && isNightShift && currentMinutes < endMin) {
            group = 'Ativo';
        }
        else if (sToday === 'T') {
            if (isNightShift) {
                if (currentMinutes >= startMin) {
                    group = 'Ativo';
                } else {
                    group = 'Encerrado'; 
                }
            } else {
                if (currentMinutes >= startMin && currentMinutes < endMin) {
                    group = 'Ativo';
                } else {
                    group = 'Encerrado'; 
                }
            }
        }
        else if (['F', 'FS', 'FD'].includes(sToday)) group = 'Folga';
        else if (sToday === 'FE') group = 'Ferias';
        else if (sToday === 'A') group = 'Afastado';
        else if (sToday === 'LM') group = 'Licenca';

        if (groups[group]) groups[group].push({ ...emp, status: sToday });
    });

    const render = (k, l) => {
        const count = document.getElementById(`count${k}`); 
        if(count) count.innerText = l.length;
        
        const list = document.getElementById(`list${k}`);
        if(list) {
            let color = 'bg-gray-600';
            if (k === 'Ativo') color = 'bg-emerald-500';
            if (k === 'Folga') color = 'bg-yellow-500';
            if (k === 'Ferias') color = 'bg-red-500';
            if (k === 'Afastado') color = 'bg-orange-500';
            if (k === 'Licenca') color = 'bg-pink-500';
            if (k === 'Encerrado') color = 'bg-purple-500';

            list.innerHTML = l.map(u => `
                <div class="flex items-center justify-between bg-white/5 border border-white/5 rounded px-2 py-1 hover:bg-white/10 transition-colors group">
                    <div class="flex items-center gap-2 overflow-hidden">
                        <div class="w-1 h-3 rounded-full ${color} shadow-[0_0_5px_rgba(0,0,0,0.5)]"></div>
                        <span class="text-[9px] font-medium text-gray-300 group-hover:text-white truncate max-w-[80px] md:max-w-[100px]">${u.name}</span>
                    </div>
                    <span class="text-[8px] font-mono text-white/30 ml-2">${u.status}</span>
                </div>`
            ).join('');
        }
    };
    Object.keys(groups).forEach(k => render(k, groups[k]));
}

// --- SALVAMENTO BLINDADO ---
async function confirmSaveToCloud() {
    const emp = document.getElementById('employeeSelect').value;
    if (!emp) return showNotification("Selecione um colaborador", "error");
    
    askConfirmation(`Deseja salvar as alterações de ${emp}?`, async () => {
        try {
            const user = state.scheduleData[emp];
            const daysInMonth = new Date(state.selectedMonthObj.year, state.selectedMonthObj.month + 1, 0).getDate();
            const safeSchedule = [];
            for (let i = 0; i < daysInMonth; i++) {
                const val = user.schedule[i];
                safeSchedule.push((val === undefined || val === null) ? "" : val);
            }

            const docId = `${state.selectedMonthObj.year}-${String(state.selectedMonthObj.month+1).padStart(2,'0')}`;
            const ref = getCompanySubDoc("escalas", docId, "plantonistas", user.uid);
            
            await setDoc(ref, { calculatedSchedule: safeSchedule }, { merge: true });
            
            await addAuditLog("Edição de Escala", emp);
            showSuccessAnim("Escala Salva");
            renderDailyDashboard();
        } catch(e) { 
            console.error(e); 
            showNotification("Erro ao salvar: " + e.message, "error"); 
        }
    });
}

// --- PREENCHIMENTO DO SELECT ---
export function populateEmployeeSelect() {
    const s = document.getElementById('employeeSelect');
    if(s) { 
        s.innerHTML = '<option value="">Selecionar...</option>'; 
        Object.keys(state.scheduleData || {}).sort().forEach(n => {
            const user = state.scheduleData[n];
            // Admin pode ver todo mundo, mas idealmente não edita a si mesmo se for regra estrita
            if (user.level < 100) { 
                s.innerHTML += `<option value="${n}">${n}</option>`;
            }
        }); 
    }
}

// --- FERRAMENTAS DE EDIÇÃO ---
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

// CORREÇÃO: Usa getCompanyCollection para Logs
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
