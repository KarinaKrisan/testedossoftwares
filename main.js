// main.js - Versão Final (Baseada em Níveis)
import { db, auth, state, hideLoader, availableMonths, getCompanyCollection, getCompanyDoc, getCompanySubCollection } from './config.js';
import * as Admin from './admin-module.js';
import * as Collab from './collab-module.js';
import { updatePersonalView, switchSubTab, renderMonthSelector, renderWeekendDuty, showNotification } from './ui.js'; 
import { doc, getDoc, getDocs } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";

// Exportações Globais
window.switchSubTab = switchSubTab;
window.updatePersonalView = updatePersonalView;
window.switchAdminView = Admin.switchAdminView;
window.renderDailyDashboard = Admin.renderDailyDashboard;
window.handleCellClick = (name, dayIndex) => {
    // Se estiver no modo Admin, usa a lógica de edição. Se estiver no modo Collab, usa a lógica de visualização/troca.
    state.isAdmin ? Admin.handleAdminCellClick(name, dayIndex) : Collab.handleCollabCellClick(name, dayIndex);
};

// Logout
const performLogout = async () => { try { await signOut(auth); window.location.href = "start.html"; } catch (e) { console.error(e); } };
if(document.getElementById('btnLogout')) document.getElementById('btnLogout').onclick = performLogout;
if(document.getElementById('btnLogoutMobile')) document.getElementById('btnLogoutMobile').onclick = performLogout;

// --- LÓGICA DE LOGIN E ROTEAMENTO ---
onAuthStateChanged(auth, async (user) => {
    if (user) {
        state.currentUser = user;
        try {
            // 1. Identificar Empresa
            const sysUserRef = doc(db, "sys_users", user.uid);
            const sysUserSnap = await getDoc(sysUserRef);

            if (!sysUserSnap.exists()) {
                console.error("⛔ Usuário sem empresa vinculada.");
                await signOut(auth);
                window.location.href = "start.html";
                return;
            }

            const sysData = sysUserSnap.data();
            state.companyId = sysData.companyId;

            // 2. Carregar Perfil Unificado
            const userDocRef = getCompanyDoc("users", user.uid);
            const userSnap = await getDoc(userDocRef);

            if (!userSnap.exists()) {
                throw new Error("Perfil não encontrado na empresa.");
            }

            state.profile = userSnap.data();
            
            // --- AQUI ESTÁ A REGRA DO LÍDER ---
            const myLevel = state.profile.level || 0;
            
            // Se Nível >= 40 (Líder, Gestor, CEO), ativa o modo DUPLO
            const isManager = myLevel >= 40;
            state.isDualRole = isManager; 

            // Se for Gerente/Líder, começa no Admin. Se for Colaborador, só tem Collab.
            if (isManager) {
                setInterfaceMode('admin');
            } else {
                setInterfaceMode('collab');
            }

            await loadData();

        } catch (e) {
            console.error("Erro Login:", e);
            alert("Erro ao carregar perfil: " + e.message);
            // window.location.href = "start.html"; 
        }
    } else {
        window.location.href = "start.html";
    }
});

// --- CARREGAMENTO DE DADOS ---
async function loadData() {
    const docId = `${state.selectedMonthObj.year}-${String(state.selectedMonthObj.month + 1).padStart(2, '0')}`;
    try {
        // Busca Escala
        const rosterRef = getCompanySubCollection("escalas", docId, "plantonistas");
        const rosterSnap = await getDocs(rosterRef);

        // Busca Lista de Usuários (Todos da empresa)
        const usersRef = getCompanyCollection("users");
        const usersSnap = await getDocs(usersRef);
        
        const detailsMap = {};
        usersSnap.forEach(doc => { detailsMap[doc.id] = doc.data(); });

        await processScheduleData(rosterSnap, detailsMap);
        
        renderMonthSelector(() => handleMonthChange(-1), () => handleMonthChange(1));
        
        // Reaplica interface para garantir que os dados apareçam
        setInterfaceMode(state.currentViewMode);
        renderWeekendDuty();

    } catch (error) { console.error("Load Data Error:", error); } 
    finally { hideLoader(); }
}

async function processScheduleData(querySnapshot, detailsMap) {
    const processed = {};
    
    // 1. Processa quem já tem escala
    querySnapshot.forEach((doc) => {
        const uid = doc.id;
        const scaleData = doc.data();
        const userProfile = detailsMap[uid];

        if (userProfile && userProfile.active !== false) { 
            processed[userProfile.nome] = buildUserObj(uid, userProfile, scaleData.calculatedSchedule);
        }
    });

    // 2. Adiciona quem está no cadastro mas sem escala (para aparecer no Admin)
    Object.keys(detailsMap).forEach(uid => {
        const u = detailsMap[uid];
        if (u.active !== false && !Object.values(processed).some(p => p.uid === uid)) {
             processed[u.nome] = buildUserObj(uid, u, []);
        }
    });

    state.scheduleData = processed;
}

function buildUserObj(uid, profile, schedule) {
    return {
        uid: uid,
        name: profile.nome,
        role: profile.role || 'collaborator',
        level: profile.level || 10,
        cargo: profile.cargo || '-',
        setorID: profile.setorID || 'NOC',
        horario: profile.horario || "08:00 às 17:00",
        schedule: Array.isArray(schedule) ? [...schedule] : [],
        email: profile.email || ""
    };
}

// --- CONTROLE DE MODO (ADMIN vs COLLAB) ---
function setInterfaceMode(mode) {
    state.currentViewMode = mode;
    const btnDual = document.getElementById('btnDualMode');
    const headerInd = document.getElementById('headerIndicator');
    const headerSuf = document.getElementById('headerSuffix');

    // Botão de troca só aparece para quem tem permissão (isDualRole)
    if (state.isDualRole && btnDual) {
        btnDual.classList.remove('hidden'); 
        btnDual.classList.add('flex');
        btnDual.onclick = () => setInterfaceMode(state.currentViewMode === 'admin' ? 'collab' : 'admin');
        
        // Ajusta texto do botão
        document.getElementById('dualModeText').innerText = mode === 'admin' ? "Área Colaborador" : "Área Admin";
        document.getElementById('dualModeIcon').className = mode === 'admin' ? "fas fa-user-astronaut text-[9px] text-gray-400 group-hover:text-blue-400" : "fas fa-shield-alt text-[9px] text-gray-400 group-hover:text-purple-400";
    }

    if (mode === 'admin') {
        // --- MODO ADMIN ---
        state.isAdmin = true; 
        
        // Estilo Visual
        if(headerInd) headerInd.className = "w-1 h-5 md:h-8 bg-purple-600 rounded-full shadow-[0_0_15px_#9333ea] transition-colors";
        if(headerSuf) { headerSuf.className = "text-purple-500 text-[10px] align-top ml-1"; headerSuf.innerText = "ADMIN"; }
        
        // Troca as interfaces
        Collab.destroyCollabUI(); 
        Admin.initAdminUI(); 

    } else {
        // --- MODO COLABORADOR ---
        state.isAdmin = false; 
        
        // Estilo Visual
        if(headerInd) headerInd.className = "w-1 h-5 md:h-8 bg-blue-600 rounded-full shadow-[0_0_15px_#2563eb] transition-colors";
        if(headerSuf) { headerSuf.className = "text-blue-500 text-[10px] align-top ml-1"; headerSuf.innerText = "COLLAB"; }

        // Esconde Painéis Admin
        ['screenDaily', 'screenLogs', 'screenApprovals', 'adminTabNav', 'editToolbar', 'adminControls'].forEach(id => {
            document.getElementById(id)?.classList.add('hidden');
        });

        // Mostra Painéis Comuns/Collab
        document.getElementById('screenEdit').classList.remove('hidden');
        document.getElementById('weekendDutyContainer').classList.remove('hidden');

        // Inicia UI Collab
        Collab.initCollabUI();
        
        // Força visão pessoal
        const myName = state.profile?.nome || state.profile?.name;
        updatePersonalView(myName);
    }
}

async function handleMonthChange(direction) {
    const cur = availableMonths.findIndex(m => m.year === state.selectedMonthObj.year && m.month === state.selectedMonthObj.month);
    const next = cur + direction;
    if (next >= 0 && next < availableMonths.length) {
        state.selectedMonthObj = availableMonths[next];
        await loadData();
    }
}
