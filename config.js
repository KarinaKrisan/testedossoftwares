// config.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js";
import { getFirestore, collection, doc } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyDcD_4x6OHZS4dobzviooQOKwlP2EGxNHo",
  authDomain: "cronosys.firebaseapp.com",
  projectId: "cronosys",
  storageBucket: "cronosys.firebasestorage.app",
  messagingSenderId: "295756889020",
  appId: "1:295756889020:web:d37202112843bc7f7e89b9",
  measurementId: "G-SPM0CJ7L2T"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);
window.db = db;

// --- GERAÇÃO DE DATAS DINÂMICA ---
// Garante que o sistema sempre saiba que dia é hoje
const now = new Date();
const currentYear = now.getFullYear();
const currentMonth = now.getMonth(); // 0 = Janeiro

export const availableMonths = [];
// Gera lista de meses (Do mês passado até 12 meses à frente)
const startView = new Date(currentYear, currentMonth - 1, 1);

for (let i = 0; i < 14; i++) {
    const d = new Date(startView.getFullYear(), startView.getMonth() + i, 1);
    availableMonths.push({ year: d.getFullYear(), month: d.getMonth() });
}

export const state = {
    isAdmin: false,
    isCollab: false,
    isDualRole: false,
    currentViewMode: 'collab',
    currentUser: null,
    profile: null,
    scheduleData: {},
    // INICIALIZA COM A DATA DE HOJE (Janeiro 2026)
    selectedMonthObj: { year: currentYear, month: currentMonth },
    activeRequestType: 'troca_dia_trabalho',
    companyId: null
};

// --- HELPERS ---
export function getCompanyCollection(path) {
    if (!state.companyId) throw new Error("ID da empresa não definido.");
    return collection(db, "companies", state.companyId, path);
}
export function getCompanyDoc(path, docId) {
    if (!state.companyId) throw new Error("ID da empresa não definido.");
    return doc(db, "companies", state.companyId, path, docId);
}
export function getCompanySubCollection(root, docId, sub) {
    if (!state.companyId) throw new Error("ID da empresa não definido.");
    return collection(db, "companies", state.companyId, root, docId, sub);
}
export function getCompanySubDoc(root, docId, sub, subDocId) {
    if (!state.companyId) throw new Error("ID da empresa não definido.");
    return doc(db, "companies", state.companyId, root, docId, sub, subDocId);
}

export const monthNames = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

export function hideLoader() {
    const o = document.getElementById('appLoadingOverlay');
    if (o) { o.classList.add('opacity-0'); setTimeout(() => o.classList.add('hidden'), 500); }
}

export function pad(n) { return n < 10 ? '0' + n : n; }

export function getDaysInMonth(year, month) {
    const date = new Date(year, month, 1);
    const days = [];
    while (date.getMonth() === month) { days.push(new Date(date)); date.setDate(date.getDate() + 1); }
    return days;
}

export const HIERARCHY = {
    CEO: { role: 'ceo', level: 100, label: 'CEO' },
    DIRETOR: { role: 'director', level: 90, label: 'Diretor' },
    GERENTE: { role: 'manager', level: 70, label: 'Gerente' },
    COORDENADOR: { role: 'coordinator', level: 50, label: 'Coordenador' },
    SUPERVISOR: { role: 'supervisor', level: 40, label: 'Supervisor' },
    LIDER: { role: 'leader', level: 30, label: 'Líder de Célula' },
    COLABORADOR: { role: 'collaborator', level: 10, label: 'Colaborador' }
};

export function canSee(userLevel, requiredLevel) { return userLevel >= requiredLevel; }
