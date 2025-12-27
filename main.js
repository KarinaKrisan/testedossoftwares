// main.js - Versão Final e Completa
import { db, auth, state, hideLoader, availableMonths, getCompanyCollection, getCompanyDoc, getCompanySubCollection } from './config.js';
import * as Admin from './admin-module.js';
import * as Collab from './collab-module.js';
import { updatePersonalView, switchSubTab, renderMonthSelector, renderWeekendDuty, showNotification } from './ui.js'; 
import { doc, getDoc, getDocs } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";

// --- EXPORTAÇÕES GLOBAIS (Para funcionar com onclicks no HTML) ---
window.switchSubTab = switchSubTab;
window.updatePersonalView = updatePersonalView;
window.switchAdminView = Admin.switchAdminView;
window.renderDailyDashboard = Admin.renderDailyDashboard;

// Manipulador de clique na célula (inteligente: sabe se é Admin ou Collab)
window.handleCellClick = (name, dayIndex) => {
    state.isAdmin ? Admin.handleAdminCellClick(name, dayIndex) : Collab.handleCollabCellClick(name, dayIndex);
};

// --- LOGOUT ---
const performLogout = async () => { 
    try { 
        await signOut(auth); 
        window.location.href = "start.html"; 
    } catch (e) { 
        console.error(e); 
    } 
};
if(document.getElementById('btnLogout')) document.getElementById('btnLogout').onclick = performLogout;
if(document.getElementById('btnLogoutMobile')) document.getElementById('btnLogoutMobile').onclick = performLogout;

// --- LÓGICA DE LOGIN E ROTEAMENTO ---
onAuthStateChanged(auth, async (user) => {
    if (user) {
        state.currentUser = user;
        try {
            // 1. Identificar a Empresa do Usuário (sys_users)
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

            // 2. Carregar Perfil do Colaborador dentro da Empresa
            const userDocRef = getCompanyDoc("users", user.uid);
            const userSnap = await getDoc(userDocRef);

            if (!userSnap.exists()) {
                throw new Error("Perfil não encontrado na empresa.");
            }

            state.profile = userSnap.data();
            
            // --- REGRA DE HIERARQUIA ---
            const myLevel = state.profile.level || 0;
            
            // Se Nível >= 40 (Líder, Gestor, CEO), ativa o modo DUPLO (pode ver Admin e Collab)
            const isManager = myLevel >= 40;
            state.isDualRole = isManager; 

            // Decisão Inicial: Gerentes vão para Admin, Colaboradores para Collab
            if (isManager) {
                setInterfaceMode('admin');
            } else {
                setInterfaceMode('collab');
            }

            await loadData();

        } catch (e) {
            console.error("Erro Login:", e);
            alert("Erro ao carregar perfil: " + e.message);
        }
    } else {
        // Se não estiver logado, manda para o login
        window.location.href = "start.html";
    }
});

// --- CARREGAMENTO DE DADOS (Firestore) ---
async function loadData() {
    const docId = `${state.selectedMonthObj.year}-${String(state.selectedMonthObj.month + 1).padStart(2, '0')}`;
    
    try {
        // Busca a Escala do Mês (plantonistas)
        const rosterRef = getCompanySubCollection("escalas", docId, "plantonistas");
        const rosterSnap = await getDocs(rosterRef);

        // Busca Lista de Usuários (Todos da empresa para referência)
        const usersRef = getCompanyCollection("users");
        const usersSnap = await getDocs(usersRef);
        
        const detailsMap = {};
        usersSnap.forEach(doc => { detailsMap[doc.id] = doc.data(); });

        // Processa e unifica os dados
        await processScheduleData(rosterSnap, detailsMap);
        
        // Renderiza seletores e interface
        renderMonthSelector(() => handleMonthChange(-1), () => handleMonthChange(1));
        
        // Reaplica a UI atual para garantir que os dados novos apareçam
        setInterfaceMode(state.currentViewMode);
        
        // Atualiza o painel de fim de semana
        renderWeekendDuty();

    } catch (error) { 
        console.error("Load Data Error:", error); 
        showNotification("Erro ao carregar dados.", "error");
    } finally { 
        hideLoader(); 
    }
}

// Processa os dados brutos do Firestore para o formato da App
async function processScheduleData(querySnapshot, detailsMap) {
    const processed = {};
    
    // 1. Quem tem escala salva
    querySnapshot.forEach((doc) => {
        const uid = doc.id;
        const scaleData = doc.data();
        const userProfile = detailsMap[uid];

        if (userProfile && userProfile.active !== false) { 
            processed[userProfile.nome] = buildUserObj(uid, userProfile, scaleData.calculatedSchedule);
        }
    });

    // 2. Quem existe mas não tem escala (apenas para Admin ver e poder escalar)
    Object.keys(detailsMap).forEach(uid => {
        const u = detailsMap[uid];
        // Se não foi processado acima e está ativo
        if (u.active !== false && !Object.values(processed).some(p => p.uid === uid)) {
             processed[u.nome] = buildUserObj(uid, u, []);
        }
    });

    state.scheduleData = processed;
}

// Cria o objeto padrão do usuário
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

    // Botão de troca (Apenas para managers)
    if (state.isDualRole && btnDual) {
        btnDual.classList.remove('hidden'); 
        btnDual.classList.add('flex');
        
        // Ao clicar, inverte o modo
        btnDual.onclick = () => setInterfaceMode(state.currentViewMode === 'admin' ? 'collab' : 'admin');
        
        // Atualiza texto e ícone do botão
        document.getElementById('dualModeText').innerText = mode === 'admin' ? "Área Colaborador" : "Área Admin";
        document.getElementById('dualModeIcon').className = mode === 'admin' 
            ? "fas fa-user-astronaut text-[9px] text-gray-400 group-hover:text-blue-400" 
            : "fas fa-shield-alt text-[9px] text-gray-400 group-hover:text-purple-400";
    }

    if (mode === 'admin') {
        // === MODO ADMIN ===
        state.isAdmin = true; 
        
        // Estilo do Header (Roxo)
        if(headerInd) headerInd.className = "w-1 h-5 md:h-8 bg-purple-600 rounded-full shadow-[0_0_15px_#9333ea] transition-colors";
        if(headerSuf) { headerSuf.className = "text-purple-500 text-[10px] align-top ml-1"; headerSuf.innerText = "ADMIN"; }
        
        // Limpa UI antiga e Inicia UI Admin
        Collab.destroyCollabUI(); 
        Admin.initAdminUI(); 

    } else {
        // === MODO COLABORADOR ===
        state.isAdmin = false; 
        
        // Estilo do Header (Azul)
        if(headerInd) headerInd.className = "w-1 h-5 md:h-8 bg-blue-600 rounded-full shadow-[0_0_15px_#2563eb] transition-colors";
        if(headerSuf) { headerSuf.className = "text-blue-500 text-[10px] align-top ml-1"; headerSuf.innerText = "COLLAB"; }

        // Esconde Painéis exclusivos de Admin
        ['screenDaily', 'screenLogs', 'screenApprovals', 'adminTabNav', 'editToolbar', 'adminControls'].forEach(id => {
            document.getElementById(id)?.classList.add('hidden');
        });

        // Mostra Painéis Comuns
        document.getElementById('screenEdit').classList.remove('hidden');
        document.getElementById('weekendDutyContainer').classList.remove('hidden');

        // Inicia UI Collab
        Collab.initCollabUI();
        
        // Renderiza a visão pessoal do usuário logado
        const myName = state.profile?.nome || state.profile?.name;
        updatePersonalView(myName);
    }
}

// Troca de Mês
async function handleMonthChange(direction) {
    const cur = availableMonths.findIndex(m => m.year === state.selectedMonthObj.year && m.month === state.selectedMonthObj.month);
    const next = cur + direction;
    
    if (next >= 0 && next < availableMonths.length) {
        state.selectedMonthObj = availableMonths[next];
        await loadData();
    }
}
