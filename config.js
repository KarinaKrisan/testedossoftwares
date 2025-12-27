// config.js
import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js";
import { getFirestore, collection, doc } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";
import { getAuth } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";

const firebaseConfig = {
    apiKey: "AIzaSyCBKSPH7lfUt0VsQPhJX3a0CQ2wYcziQvM",
    authDomain: "dadosescala.firebaseapp.com",
    projectId: "dadosescala",
    storageBucket: "dadosescala.firebasestorage.app",
    messagingSenderId: "117221956502",
    appId: "1:117221956502:web:e5a7f051daf3306b501bb7"
};

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);

// --- LINHA OBRIGATÓRIA PARA O SCRIPT FUNCIONAR ---
window.db = db; 
// -------------------------------------------------

export const state = {
    isAdmin: false,
    isCollab: false,
    isDualRole: false,
    currentViewMode: 'collab',
    currentUser: null,
    profile: null, 
    scheduleData: {}, 
    selectedMonthObj: { year: 2025, month: 11 }, 
    activeRequestType: 'troca_dia_trabalho',
    companyId: null // Armazena o ID da empresa (Tenant)
};

// --- FUNÇÕES HELPER PARA SAAS ---

export function getCompanyCollection(path) {
    if (!state.companyId) throw new Error("Erro Crítico: ID da empresa não definido.");
    return collection(db, "companies", state.companyId, path);
}

export function getCompanyDoc(path, docId) {
    if (!state.companyId) throw new Error("Erro Crítico: ID da empresa não definido.");
    return doc(db, "companies", state.companyId, path, docId);
}

// Para subcoleções profundas (ex: escalas/2025-12/plantonistas)
export function getCompanySubCollection(root, docId, sub) {
    if (!state.companyId) throw new Error("Erro Crítico: ID da empresa não definido.");
    return collection(db, "companies", state.companyId, root, docId, sub);
}

export function getCompanySubDoc(root, docId, sub, subDocId) {
    if (!state.companyId) throw new Error("Erro Crítico: ID da empresa não definido.");
    return doc(db, "companies", state.companyId, root, docId, sub, subDocId);
}

// --- UTILITÁRIOS ---

export const monthNames = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

const generateMonths = () => {
    const list = [{ year: 2025, month: 11 }];
    for (let m = 0; m <= 11; m++) {
        list.push({ year: 2026, month: m });
    }
    return list;
};
export const availableMonths = generateMonths();

export function hideLoader() {
    const o = document.getElementById('appLoadingOverlay');
    if(o) { o.classList.add('opacity-0'); setTimeout(() => o.classList.add('hidden'), 500); }
}

export function pad(n) { return n < 10 ? '0' + n : n; }

export function getDaysInMonth(year, month) {
    const date = new Date(year, month, 1);
    const days = [];
    while (date.getMonth() === month) { days.push(new Date(date)); date.setDate(date.getDate() + 1); }
    return days;
}

export function isValidShiftStartDate(dateVal) {
    if (!dateVal) return false;
    return parseInt(dateVal.split('-')[2]) > 25; 
}

export function isWorkingTime(timeRange) {
    if (!timeRange || typeof timeRange !== 'string' || ['F', 'FS', 'FD', 'FE', 'A', 'LM'].includes(timeRange)) return false; 
    const times = timeRange.match(/(\d{1,2}:\d{2})/g);
    if (!times || times.length < 2) return false;
    const now = new Date();
    const curr = now.getHours() * 60 + now.getMinutes();
    const [h1, m1] = times[0].split(':').map(Number);
    const [h2, m2] = times[1].split(':').map(Number);
    const start = h1 * 60 + m1;
    const end = h2 * 60 + m2;
    return end < start ? (curr >= start || curr < end) : (curr >= start && curr < end);
}
