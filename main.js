/**
 * main.js - Versão Final (Enterprise Ready)
 * Sistema: Cronosys SaaS
 * Descrição: Gerenciamento de rotas, autenticação e sanitização de dados.
 */

import { db, auth, state, hideLoader, availableMonths, getCompanyCollection, getCompanyDoc, getCompanySubCollection } from './config.js';
import * as Admin from './admin-module.js';
import * as Collab from './collab-module.js';
import { updatePersonalView, switchSubTab, renderMonthSelector, renderWeekendDuty, showNotification } from './ui.js'; 
import { doc, getDoc, getDocs } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";

// --- EXPORTAÇÕES GLOBAIS (Acessíveis pelo HTML) ---
window.switchSubTab = switchSubTab;
window.updatePersonalView = updatePersonalView;
window.switchAdminView = Admin.switchAdminView;
window.renderDailyDashboard = Admin.renderDailyDashboard;

// Manipulador de clique na célula (Roteamento inteligente por nível de acesso)
window.handleCellClick = (name, dayIndex) => {
    state.isAdmin ? Admin.handleAdminCellClick(name, dayIndex) : Collab.handleCollabCellClick(name, dayIndex);
};

// --- SISTEMA DE LOGOUT ---
const performLogout = async () => { 
    try { 
        await signOut(auth); 
        window.location.href = "start.html"; 
    } catch (e) { 
        console.error("Erro ao sair:", e); 
    } 
};

// Bind de botões de logout
['btnLogout', 'btnLogoutMobile'].forEach(id => {
    const btn = document.getElementById(id);
    if(btn) btn.onclick = performLogout;
});

// --- NÚCLEO DE AUTENTICAÇÃO E HIERARQUIA ---
onAuthStateChanged(auth, async (user) => {
    if (user) {
        state.currentUser = user;
        try {
            // 1. REFRESH DE CLAIMS (Crucial para o sistema de Níveis)
            // Força o download do token novo para detectar se o nível mudou via Cloud Function
            const idTokenResult = await user.getIdTokenResult(true);
            const userClaims = idTokenResult.claims;

            // 2. IDENTIFICAÇÃO DE EMPRESA (Multi-tenant)
            // Primeiro checamos se a claim da empresa existe, senão buscamos no sys_users
            let companyId = userClaims.companyId;

            if (!companyId) {
                const sysUserSnap = await getDoc(doc(db, "sys_users", user.uid));
                if (sysUserSnap.exists()) {
                    companyId = sysUserSnap.data().companyId;
                }
            }

            if (!companyId) {
                console.error("⛔ Falha Crítica: Usuário sem empresa vinculada.");
                return performLogout();
            }

            state.companyId = companyId;

            // 3. CARREGAMENTO DE PERFIL (Para UI: Foto, Nome, Cargo)
            const userSnap = await getDoc(getCompanyDoc("users", user.uid));
            if (!userSnap.exists()) throw new Error("Perfil não localizado no tenant.");

            state.profile = userSnap.data();
            
            // --- LÓGICA DE PODER (HIERARQUIA) ---
            // O nível vem das Claims (Seguro) ou do Perfil (Fallback)
            const myLevel = userClaims.level || state.profile.level || 10;
            
            // Gerentes, Diretores e CEOs (Nível >= 40) possuem modo Admin
            state.isDualRole = myLevel >= 40; 

            // Roteamento Automático Inicial
            if (state.isDualRole) {
                setInterfaceMode('admin');
            } else {
                setInterfaceMode('collab');
            }

            await loadData();

        } catch (e) {
            console.error("Erro no fluxo de entrada:", e);
            showNotification("Erro ao carregar perfil: " + e.message, "error");
        }
    } else {
        // Sem usuário logado, volta para o início
        window.location.href = "start.html";
    }
});

// --- MOTOR DE DADOS ---
async function loadData() {
    const docId = `${state.selectedMonthObj.year}-${String(state.selectedMonthObj.month + 1).padStart(2, '0')}`;
    
    try {
        // Busca paralela: Escalas do mês + Lista de usuários ativos
        const [rosterSnap, usersSnap] = await Promise.all([
            getDocs(getCompanySubCollection("escalas", docId, "plantonistas")),
            getDocs(getCompanyCollection("users"))
        ]);

        const detailsMap = {};
        usersSnap.forEach(doc => { detailsMap[doc.id] = doc.data(); });

        await processScheduleData(rosterSnap, detailsMap);
        
        // Atualiza seletores de data na UI
        renderMonthSelector(() => handleMonthChange(-1), () => handleMonthChange(1));
        
        // Renderiza a visualização correta
        setInterfaceMode(state.currentViewMode);
        renderWeekendDuty();

    } catch (error) { 
        console.error("Erro no carregamento de dados:", error); 
        showNotification("Erro ao sincronizar dados com o servidor.", "error");
    } finally { 
        hideLoader(); 
    }
}

// Cruzamento de dados entre Escalas e Perfis
async function processScheduleData(querySnapshot, detailsMap) {
    const processed = {};
    
    // 1. Processa quem já tem escala gravada no Firestore
    querySnapshot.forEach((doc) => {
        const uid = doc.id;
        const scaleData = doc.data();
        const userProfile = detailsMap[uid];

        if (userProfile && userProfile.active !== false) { 
            const safeName = userProfile.name || userProfile.nome || "Sem Nome";
            processed[safeName] = buildUserObj(uid, userProfile, scaleData.calculatedSchedule);
        }
    });

    // 2. Preenche com usuários que não possuem escala ainda (Garante que apareçam na lista)
    Object.keys(detailsMap).forEach(uid => {
        const u = detailsMap[uid];
        const safeName = u.name || u.nome || "Sem Nome";

        if (u.active !== false && !Object.values(processed).some(p => p.uid === uid)) {
             processed[safeName] = buildUserObj(uid, u, []);
        }
    });

    state.scheduleData = processed;
}

// --- SANITIZAÇÃO E BLINDAGEM DE OBJETOS ---
// Previne erros de 'undefined' que travam o salvamento no Firebase
function buildUserObj(uid, profile, schedule) {
    const safeName = profile.name || profile.nome || "Usuário Sem Nome";

    // Limpeza de array de escala (evita buracos de dados)
    let safeSchedule = Array.isArray(schedule) 
        ? schedule.map(day => (day === undefined || day === null) ? "" : day)
        : [];

    const userObj = {
        uid: uid,
        name: safeName, 
        role: profile.role || 'collaborator',
        level: profile.level || 10,
        cargo: profile.cargo || '-',
        setorID: profile.setorID || 'NOC',
        celulaID: profile.celulaID || '',     
        department: profile.department || '', 
        horario: profile.horario || "08:00 às 17:00",
        schedule: safeSchedule,
        email: profile.email || "",
        ...profile 
    };

    // Filtro final: troca qualquer undefined por null (Aceito pelo Firebase)
    Object.keys(userObj).forEach(key => {
        if (userObj[key] === undefined) userObj[key] = null;
    });

    return userObj;
}

// --- CONTROLE DE INTERFACE (ADMIN VS COLLAB) ---
function setInterfaceMode(mode) {
    state.currentViewMode = mode;
    const btnDual = document.getElementById('btnDualMode');
    const headerInd = document.getElementById('headerIndicator');
    const headerSuf = document.getElementById('headerSuffix');

    // Ativa botão de troca apenas para Gestores/CEO
    if (state.isDualRole && btnDual) {
        btnDual.classList.replace('hidden', 'flex');
        btnDual.onclick = () => setInterfaceMode(state.currentViewMode === 'admin' ? 'collab' : 'admin');
        
        document.getElementById('dualModeText').innerText = mode === 'admin' ? "Área Colaborador" : "Área Admin";
        document.getElementById('dualModeIcon').className = mode === 'admin' 
            ? "fas fa-user-astronaut text-[9px] text-gray-400" 
            : "fas fa-shield-alt text-[9px] text-gray-400";
    }

    if (mode === 'admin') {
        state.isAdmin = true; 
        if(headerInd) headerInd.className = "w-1 h-5 md:h-8 bg-purple-600 rounded-full shadow-[0_0_15px_#9333ea]";
        if(headerSuf) { headerSuf.className = "text-purple-500 text-[10px] align-top ml-1"; headerSuf.innerText = "ADMIN"; }
        
        Collab.destroyCollabUI(); 
        Admin.initAdminUI(); 
    } else {
        state.isAdmin = false; 
        if(headerInd) headerInd.className = "w-1 h-5 md:h-8 bg-blue-600 rounded-full shadow-[0_0_15px_#2563eb]";
        if(headerSuf) { headerSuf.className = "text-blue-500 text-[10px] align-top ml-1"; headerSuf.innerText = "COLLAB"; }

        // Esconde componentes administrativos
        ['screenDaily', 'screenLogs', 'screenApprovals', 'adminTabNav', 'editToolbar', 'adminControls'].forEach(id => {
            document.getElementById(id)?.classList.add('hidden');
        });

        // Ativa componentes do colaborador
        document.getElementById('screenEdit')?.classList.remove('hidden');
        document.getElementById('weekendDutyContainer')?.classList.remove('hidden');

        Collab.initCollabUI();
        updatePersonalView(state.profile?.name || "Usuário");
    }
}

// Navegação de Meses
async function handleMonthChange(direction) {
    const cur = availableMonths.findIndex(m => m.year === state.selectedMonthObj.year && m.month === state.selectedMonthObj.month);
    const next = cur + direction;
    
    if (next >= 0 && next < availableMonths.length) {
        state.selectedMonthObj = availableMonths[next];
        await loadData();
    }
}
