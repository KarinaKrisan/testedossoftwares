// admin-module.js
import { db, state, getCompanyCollection, getCompanyDoc, getCompanySubDoc, HIERARCHY } from './config.js';
import { showNotification, updateCalendar, renderWeekendDuty } from './ui.js';
import { doc, setDoc, serverTimestamp, query, orderBy, onSnapshot, updateDoc, where, getDocs, addDoc, deleteDoc } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";

let allLoadedLogs = [];

// --- EXPORTAÇÕES GLOBAIS ---
window.setEditTool = setEditTool;
window.approveRequest = approveRequest;
window.rejectRequest = rejectRequest;

// --- INICIALIZAÇÃO ---
export function initAdminUI() {
    ['adminControls', 'adminTabNav', 'editToolbar'].forEach(id => document.getElementById(id)?.classList.remove('hidden'));
    ['collabControls'].forEach(id => document.getElementById(id)?.classList.add('hidden'));
    
    renderEditToolbar();
    renderInviteWidget(); // Chamada crucial aqui
    renderLogs();
    renderApprovals();
}

export function switchAdminView(view) {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    ['Daily', 'Edit', 'Approvals', 'Logs'].forEach(s => {
        const screen = document.getElementById(`screen${s}`);
        if(screen) screen.classList.toggle('hidden', s.toLowerCase() !== view.toLowerCase());
        const btn = document.getElementById(`btnNav${s}`);
        if(btn) { 
            btn.classList.remove('active', 'bg-purple-600/20', 'text-purple-400');
            if(s.toLowerCase() === view.toLowerCase()) {
                btn.classList.add('active', 'bg-purple-600/20', 'text-purple-400');
            }
        }
    });
    if(view === 'Edit') updateCalendar();
}

// --- GESTÃO DE CONVITES (SaaS) ---
export async function renderInviteWidget() {
    const container = document.getElementById('inviteWidgetContainer');
    if (!container) return;

    // Estado de carregamento
    container.innerHTML = '<div class="text-[9px] text-gray-500 animate-pulse p-4">Carregando convites...</div>';

    try {
        const q = query(getCompanyCollection("convites"), where("active", "==", true));
        
        // Usamos onSnapshot para atualizar em tempo real se alguém revogar
        onSnapshot(q, (snap) => {
            const div = document.createElement('div');
            div.className = "premium-glass p-3 border-l-4 border-emerald-500 mb-4 animate-fade-in";

            if (!snap.empty) {
                const inviteCode = snap.docs[0].id;
                const inviteLink = `${window.location.origin}${window.location.pathname.replace('index.html','')}/signup-colaborador.html?convite=${inviteCode}&company=${state.companyId}`;
                
                div.innerHTML = `
                    <h3 class="text-[10px] font-bold text-white uppercase mb-2 flex justify-between">
                        <span><i class="fas fa-link text-emerald-400 mr-1"></i> Link de Convite Ativo</span>
                    </h3>
                    <div class="flex gap-1 mb-2">
                        <input type="text" value="${inviteLink}" id="inviteLinkInput" class="bg-black/30 border border-white/10 text-emerald-400 font-mono text-[9px] p-2 rounded w-full outline-none truncate" readonly>
                        <button id="btnCopyInvite" class="bg-white/10 hover:bg-white/20 text-white px-3 rounded text-[10px]"><i class="fas fa-copy"></i></button>
                    </div>
                    <button id="btnRevokeInvite" class="w-full bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 py-1.5 rounded text-[9px] font-bold uppercase transition-colors">Revogar Link</button>
                `;
                
                container.innerHTML = '';
                container.appendChild(div);

                document.getElementById('btnCopyInvite').onclick = () => {
                    navigator.clipboard.writeText(document.getElementById("inviteLinkInput").value);
                    showNotification("Link copiado!", "success");
                };

                document.getElementById('btnRevokeInvite').onclick = () => {
                    window.askConfirmation("Revogar este convite? Ninguém mais poderá usar este link.", async () => {
                        await updateDoc(getCompanyDoc("convites", inviteCode), { active: false });
                        showNotification("Link revogado");
                    });
                };
            } else {
                div.innerHTML = `
                    <h3 class="text-[10px] font-bold text-white uppercase mb-1">Novo Colaborador</h3>
                    <p class="text-[8px] text-gray-500 mb-3 uppercase tracking-tight font-medium">Gere um link para permitir novos cadastros.</p>
                    <button id="btnGenerateInvite" class="w-full bg-emerald-600 hover:bg-emerald-500 text-white py-2.5 rounded-xl text-[9px] font-bold uppercase shadow-lg shadow-emerald-900/20 transition-all active:scale-95">
                        Gerar Link de Cadastro
                    </button>
                `;
                container.innerHTML = '';
                container.appendChild(div);

                document.getElementById('btnGenerateInvite').onclick = async () => {
                    const code = Math.random().toString(36).substring(2, 6).toUpperCase() + '-' + Math.random().toString(36).substring(2, 6).toUpperCase();
                    try {
                        await setDoc(getCompanyDoc("convites", code), { 
                            createdBy: state.currentUser.uid, 
                            createdAt: serverTimestamp(), 
                            active: true 
                        });
                        showNotification("Link Gerado com Sucesso!");
                    } catch (e) {
                        showNotification("Erro ao gerar link", "error");
                    }
                };
            }
        });
    } catch(e) {
        console.error("Erro Invite Widget:", e);
        container.innerHTML = '<p class="text-[8px] text-red-400">Erro ao carregar módulo de convites.</p>';
    }
}

// --- RESTANTE DO MÓDULO (EDITION & LOGS) ---
function renderEditToolbar() {
    const toolbar = document.getElementById('editToolbar');
    if(!toolbar) return;
    const tools = [
        { id: 'MT', label: 'Manhã', icon: 'fa-sun', color: 'text-amber-400', border: 'border-amber-500/50' },
        { id: 'T', label: 'Tarde', icon: 'fa-cloud-sun', color: 'text-orange-400', border: 'border-orange-500/50' },
        { id: 'N', label: 'Noite', icon: 'fa-moon', color: 'text-indigo-400', border: 'border-indigo-500/50' },
        { id: 'P', label: 'Plantão', icon: 'fa-star', color: 'text-emerald-400', border: 'border-emerald-500/50' },
        { id: 'F', label: 'Folga', icon: 'fa-coffee', color: 'text-gray-400', border: 'border-white/20' }
    ];
    toolbar.innerHTML = tools.map(t => `
        <button onclick="window.setEditTool('${t.id}')" id="tool-${t.id}" class="tool-btn px-3 py-2 rounded-xl bg-white/5 border ${t.border} flex items-center gap-2 transition-all">
            <i class="fas ${t.icon} ${t.color} text-[10px]"></i>
            <span class="text-[9px] font-bold text-white uppercase">${t.label}</span>
        </button>
    `).join('');
}

function setEditTool(toolId) {
    state.activeTool = toolId;
    document.querySelectorAll('.tool-btn').forEach(b => b.classList.remove('ring-2', 'ring-purple-500', 'bg-white/10'));
    document.getElementById(`tool-${toolId}`)?.classList.add('ring-2', 'ring-purple-500', 'bg-white/10');
}

async function renderLogs() {
    const q = query(getCompanyCollection("logs"), orderBy("timestamp", "desc"));
    onSnapshot(q, (snap) => {
        const tbody = document.getElementById('logsTableBody');
        if(!tbody) return;
        tbody.innerHTML = snap.docs.map(d => {
            const data = d.data();
            const date = data.timestamp?.toDate().toLocaleString('pt-BR') || '...';
            return `<tr>
                <td class="p-4 text-gray-500">${date}</td>
                <td class="p-4 font-bold text-purple-400">${data.adminName || 'Admin'}</td>
                <td class="p-4">${data.action}</td>
            </tr>`;
        }).join('');
    });
}

async function renderApprovals() {
    const q = query(getCompanyCollection("solicitacoes"), where("status", "==", "pending_admin"));
    onSnapshot(q, (snap) => {
        const container = document.getElementById('approvalsList');
        if(!container) return;
        if(snap.empty) {
            container.innerHTML = '<div class="premium-glass p-10 text-center text-gray-500 text-[10px] uppercase font-bold tracking-widest">Nenhuma solicitação pendente</div>';
            return;
        }
        container.innerHTML = snap.docs.map(doc => {
            const d = doc.data();
            return `
                <div class="premium-glass p-4 rounded-2xl border border-white/10 flex justify-between items-center animate-fade-in">
                    <div>
                        <p class="text-[10px] font-bold text-white uppercase">${d.requesterName}</p>
                        <p class="text-[9px] text-gray-500">Troca: Dia ${d.dayIndex + 1} (${d.oldShift} ➔ ${d.newShift})</p>
                    </div>
                    <div class="flex gap-2">
                        <button onclick="window.rejectRequest('${doc.id}')" class="p-2 w-8 h-8 rounded-full bg-red-500/10 text-red-500 hover:bg-red-500 hover:text-white transition-all"><i class="fas fa-times"></i></button>
                        <button onclick="window.approveRequest('${doc.id}')" class="p-2 w-8 h-8 rounded-full bg-emerald-500/10 text-emerald-500 hover:bg-emerald-500 hover:text-white transition-all"><i class="fas fa-check"></i></button>
                    </div>
                </div>
            `;
        }).join('');
    });
}

async function approveRequest(id) { /* Lógica de aprovação aqui */ }
async function rejectRequest(id) { /* Lógica de rejeição aqui */ }
