// main.js - Versão Final (Correção do Erro Undefined)
import { db, auth, state, hideLoader, availableMonths, getCompanyCollection, getCompanyDoc, getCompanySubCollection } from './config.js';
import * as Admin from './admin-module.js';
import * as Collab from './collab-module.js';
import { updatePersonalView, switchSubTab, renderMonthSelector, renderWeekendDuty, showNotification } from './ui.js'; 
import { doc, getDoc, getDocs } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";

// --- EXPORTAÇÕES GLOBAIS ---
window.switchSubTab = switchSubTab;
window.updatePersonalView = updatePersonalView;
window.switchAdminView = Admin.switchAdminView;
window.renderDailyDashboard = Admin.renderDailyDashboard;

// Manipulador de clique na célula
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
            // 1. Identificar a Empresa do Usuário
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

            // 2. Carregar Perfil do Colaborador
            const userDocRef = getCompanyDoc("users", user.uid);
            const userSnap = await getDoc(userDocRef);

            if (!userSnap.exists()) {
                throw new Error("Perfil não encontrado na empresa.");
            }

            state.profile = userSnap.data();
            
            // --- REGRA DE HIERARQUIA ---
            const myLevel = state.profile.level || 0;
            
            // Se Nível >= 40 (Líder, Gestor, CEO), ativa o modo DUPLO
            const isManager = myLevel >= 40;
            state.isDualRole = isManager; 

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
        window.location.href = "start.html";
    }
});

// --- CARREGAMENTO DE DADOS ---
async function loadData() {
    const docId = `${state.selectedMonthObj.year}-${String(state.selectedMonthObj.month + 1).padStart(2, '0')}`;
    
    try {
        const rosterRef = getCompanySubCollection("escalas", docId, "plantonistas");
        const rosterSnap = await getDocs(rosterRef);

        const usersRef = getCompanyCollection("users");
        const usersSnap = await getDocs(usersRef);
        
        const detailsMap = {};
        usersSnap.forEach(doc => { detailsMap[doc.id] = doc.data(); });

        await processScheduleData(rosterSnap, detailsMap);
        
        renderMonthSelector(() => handleMonthChange(-1), () => handleMonthChange(1));
        
        setInterfaceMode(state.currentViewMode);
        
        renderWeekendDuty();

    } catch (error) { 
        console.error("Load Data Error:", error); 
        showNotification("Erro ao carregar dados.", "error");
    } finally { 
        hideLoader(); 
    }
}

// Processa os dados brutos
async function processScheduleData(querySnapshot, detailsMap) {
    const processed = {};
    
    // 1. Quem tem escala salva
    querySnapshot.forEach((doc) => {
        const uid = doc.id;
        const scaleData = doc.data();
        const userProfile = detailsMap[uid];

        if (userProfile && userProfile.active !== false) { 
            // CORREÇÃO: Garante que o nome não seja undefined na chave do objeto
            const safeName = userProfile.name || userProfile.nome || "Sem Nome";
            processed[safeName] = buildUserObj(uid, userProfile, scaleData.calculatedSchedule);
        }
    });

    // 2. Quem existe mas não tem escala
    Object.keys(detailsMap).forEach(uid => {
        const u = detailsMap[uid];
        // CORREÇÃO: Verifica nome seguro aqui também
        const safeName = u.name || u.nome || "Sem Nome";

        if (u.active !== false && !Object.values(processed).some(p => p.uid === uid)) {
             processed[safeName] = buildUserObj(uid, u, []);
        }
    });

    state.scheduleData = processed;
}

// Cria o objeto padrão do usuário (BLINDADO CONTRA UNDEFINED)
function buildUserObj(uid, profile, schedule) {
    // CORREÇÃO CRÍTICA: Verifica name (novo) e nome (antigo)
    // Se ambos falharem, usa string fixa para não quebrar o Firebase
    const safeName = profile.name || profile.nome || "Usuário Sem Nome";

    return {
        uid: uid,
        name: safeName, 
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

    // Botão de troca
    if (state.isDualRole && btnDual) {
        btnDual.classList.remove('hidden'); 
        btnDual.classList.add('flex');
        btnDual.onclick = () => setInterfaceMode(state.currentViewMode === 'admin' ? 'collab' : 'admin');
        
        document.getElementById('dualModeText').innerText = mode === 'admin' ? "Área Colaborador" : "Área Admin";
        document.getElementById('dualModeIcon').className = mode === 'admin' 
            ? "fas fa-user-astronaut text-[9px] text-gray-400 group-hover:text-blue-400" 
            : "fas fa-shield-alt text-[9px] text-gray-400 group-hover:text-purple-400";
    }

    if (mode === 'admin') {
        state.isAdmin = true; 
        
        if(headerInd) headerInd.className = "w-1 h-5 md:h-8 bg-purple-600 rounded-full shadow-[0_0_15px_#9333ea] transition-colors";
        if(headerSuf) { headerSuf.className = "text-purple-500 text-[10px] align-top ml-1"; headerSuf.innerText = "ADMIN"; }
        
        Collab.destroyCollabUI(); 
        Admin.initAdminUI(); 

    } else {
        state.isAdmin = false; 
        
        if(headerInd) headerInd.className = "w-1 h-5 md:h-8 bg-blue-600 rounded-full shadow-[0_0_15px_#2563eb] transition-colors";
        if(headerSuf) { headerSuf.className = "text-blue-500 text-[10px] align-top ml-1"; headerSuf.innerText = "COLLAB"; }

        ['screenDaily', 'screenLogs', 'screenApprovals', 'adminTabNav', 'editToolbar', 'adminControls'].forEach(id => {
            document.getElementById(id)?.classList.add('hidden');
        });

        document.getElementById('screenEdit').classList.remove('hidden');
        document.getElementById('weekendDutyContainer').classList.remove('hidden');

        Collab.initCollabUI();
        
        // CORREÇÃO: Garante nome seguro ao renderizar visão pessoal
        const myName = state.profile?.name || state.profile?.nome || "Usuário";
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
