// main.js - Versão Final (Com Blindagem de Dados)
import { db, auth, state, hideLoader, availableMonths, getCompanyCollection, getCompanyDoc, getCompanySubCollection } from './config.js';
import * as Admin from './admin-module.js';
import * as Collab from './collab-module.js';
import { updatePersonalView, switchSubTab, renderMonthSelector, renderWeekendDuty, showNotification, updateDynamicMenu } from './ui.js'; 
import { doc, getDoc, getDocs, onSnapshot } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";
import { onAuthStateChanged, signOut } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";

// Exportações
window.switchSubTab = switchSubTab;
window.updatePersonalView = updatePersonalView;
window.switchAdminView = Admin.switchAdminView;
window.renderDailyDashboard = Admin.renderDailyDashboard;
window.handleCellClick = (name, dayIndex) => { state.isAdmin ? Admin.handleAdminCellClick(name, dayIndex) : Collab.handleCollabCellClick(name, dayIndex); };

const performLogout = async () => { try { await signOut(auth); window.location.href = "start.html"; } catch (e) { console.error(e); } };
['btnLogout', 'btnLogoutMobile'].forEach(id => { const btn = document.getElementById(id); if(btn) btn.onclick = performLogout; });

// Autenticação e Carregamento
onAuthStateChanged(auth, async (user) => {
    if (user) {
        state.currentUser = user;
        try {
            const idTokenResult = await user.getIdTokenResult(true);
            let rawCompanyId = idTokenResult.claims.companyId;

            // Fallback para sys_users (caso o claim falhe na primeira vez)
            if (!rawCompanyId) {
                const sysUserSnap = await getDoc(doc(db, "sys_users", user.uid));
                if (sysUserSnap.exists()) rawCompanyId = sysUserSnap.data().companyId;
            }

            if (!rawCompanyId) return performLogout();
            state.companyId = String(rawCompanyId).trim();

            // REATIVIDADE DE PERFIL
            const userDocRef = getCompanyDoc("users", user.uid);
            let isFirstLoad = true;

            onSnapshot(userDocRef, (docSnap) => {
                if (!docSnap.exists()) {
                    console.warn("Perfil não encontrado em 'users'.");
                    if(isFirstLoad) { 
                        state.profile = { level: 10, name: "Visitante" }; 
                        setInterfaceMode('collab'); 
                        loadData();
                    }
                    return;
                }

                const newData = docSnap.data();
                const oldLevel = state.profile?.level || 0;
                state.profile = newData;
                const myLevel = newData.level || 10;
                state.isDualRole = myLevel >= 40; 

                // Notificação de Promoção
                if (!isFirstLoad && myLevel > oldLevel) {
                    showNotification(`Permissões atualizadas: ${newData.cargo}`, "success");
                }

                updateDynamicMenu();

                if (state.isDualRole) {
                    setInterfaceMode('admin');
                } else {
                    setInterfaceMode('collab');
                }
                
                loadData(); 
                isFirstLoad = false;

            }, (err) => console.error("Erro stream perfil:", err));

        } catch (e) {
            console.error(e);
            showNotification(e.message, "error");
        }
    } else {
        if (!window.location.href.includes("start.html")) window.location.href = "start.html";
    }
});

// Carregamento de Dados (Escalas + Usuários)
async function loadData() {
    const docId = `${state.selectedMonthObj.year}-${String(state.selectedMonthObj.month + 1).padStart(2, '0')}`;
    
    try {
        const [rosterSnap, usersSnap] = await Promise.all([
            getDocs(getCompanySubCollection("escalas", docId, "plantonistas")),
            getDocs(getCompanyCollection("users"))
        ]);

        const detailsMap = {};
        usersSnap.forEach(doc => { detailsMap[doc.id] = doc.data(); });

        await processScheduleData(rosterSnap, detailsMap);
        
        renderMonthSelector(() => handleMonthChange(-1), () => handleMonthChange(1));
        
        // Renderiza a tela correta após carregar
        if (state.currentViewMode === 'admin') {
            Admin.renderDailyDashboard();
            Admin.populateEmployeeSelect();
        } else {
            updatePersonalView(state.profile?.name);
        }
        
        renderWeekendDuty();

    } catch (error) { console.error(error); } finally { hideLoader(); }
}

// Cruzamento de Dados e Normalização
async function processScheduleData(querySnapshot, detailsMap) {
    const processed = {};
    
    // 1. Usuários COM documento de escala criado
    querySnapshot.forEach((doc) => {
        const uid = doc.id;
        const scaleData = doc.data();
        const userProfile = detailsMap[uid];

        if (userProfile && userProfile.active !== false) { 
            const safeName = userProfile.name || userProfile.nome || "Sem Nome";
            processed[safeName] = buildUserObj(uid, userProfile, scaleData.calculatedSchedule);
        }
    });

    // 2. Usuários SEM escala (Preenche com F)
    Object.keys(detailsMap).forEach(uid => {
        const u = detailsMap[uid];
        const safeName = u.name || u.nome || "Sem Nome";

        if (u.active !== false && !Object.values(processed).some(p => p.uid === uid)) {
             processed[safeName] = buildUserObj(uid, u, []); // Manda array vazio para ser preenchido
        }
    });

    state.scheduleData = processed;
}

// BLINDAGEM DO OBJETO DE USUÁRIO
function buildUserObj(uid, profile, schedule) {
    const daysInMonth = 32; // Margem de segurança
    let safeSchedule = [];

    // Se existe array, normaliza os valores
    if (Array.isArray(schedule)) {
        for(let i=0; i<daysInMonth; i++) {
            const val = schedule[i];
            // Se for nulo, undefined ou string vazia, vira 'F'
            if (val === undefined || val === null || val === "") {
                safeSchedule.push("F");
            } else {
                safeSchedule.push(val);
            }
        }
    } else {
        // Se não existe, cria tudo Folga
        safeSchedule = Array(daysInMonth).fill("F");
    }

    const userObj = {
        uid: uid,
        name: profile.name || profile.nome || "Usuário", 
        role: profile.role || 'collaborator',
        level: profile.level || 10,
        cargo: profile.cargo || '-',
        setorID: profile.setorID || 'NOC',
        email: profile.email || "",
        horario: profile.horario || "08:00 às 17:00",
        schedule: safeSchedule, 
        ...profile 
    };

    // Remove undefined
    Object.keys(userObj).forEach(key => {
        if (userObj[key] === undefined) userObj[key] = null;
    });

    return userObj;
}

function setInterfaceMode(mode) {
    state.currentViewMode = mode;
    const btnDual = document.getElementById('btnDualMode');
    const headerInd = document.getElementById('headerIndicator');
    const headerSuf = document.getElementById('headerSuffix');

    if (state.isDualRole && btnDual) {
        btnDual.classList.replace('hidden', 'flex');
        btnDual.onclick = () => setInterfaceMode(state.currentViewMode === 'admin' ? 'collab' : 'admin');
        document.getElementById('dualModeText').innerText = mode === 'admin' ? "Área Colaborador" : "Área Admin";
        document.getElementById('dualModeIcon').className = mode === 'admin' ? "fas fa-user-astronaut text-[9px] text-gray-400" : "fas fa-shield-alt text-[9px] text-gray-400";
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
        ['screenDaily', 'screenLogs', 'screenApprovals', 'adminTabNav', 'editToolbar', 'adminControls'].forEach(id => document.getElementById(id)?.classList.add('hidden'));
        document.getElementById('screenEdit')?.classList.remove('hidden');
        document.getElementById('weekendDutyContainer')?.classList.remove('hidden');
        Collab.initCollabUI();
        updatePersonalView(state.profile?.name || "Usuário");
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
