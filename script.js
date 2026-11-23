const STORAGE_KEY = "codementor_state_v1";

const DEFAULT_ROADMAP = [
    { id: "variables", title: "1. Zmienne (let, const)", desc: "Przechowywanie danych i typy podstawowe.", done: false },
    { id: "loops", title: "2. Pętle (for, while)", desc: "Powtarzanie operacji na danych.", done: false },
    { id: "functions", title: "3. Funkcje", desc: "Dzielenie kodu na mniejsze, wielokrotnego użytku bloki.", done: false },
    { id: "arrays", title: "4. Tablice i obiekty", desc: "Praca z listami (map, filter) i strukturami danych.", done: false },
    { id: "api", title: "5. API i fetch()", desc: "Pobieranie danych z internetu i integracja z AI.", done: false }
];

// Przykładowe kroki do trybu "Naucz się swojego projektu" (możesz dopisać kolejne projekty)
const PROJECT_STEPS = [
    {
        title: "Krok 1: Szkielet HTML",
        task: "Napisz prosty szkielet: <input>, <button> i <ul>, a potem wklej go tutaj.",
        hint: "Pamiętaj o atrybutach id, np. <input id='task-input'>.",
        required: ["<input", "<button", "<ul"]
    },
    {
        title: "Krok 2: Pobranie elementu w JS",
        task: "Napisz w JS kod używający document.querySelector lub getElementById.",
        hint: "Np. const btn = document.getElementById('add-btn');",
        required: ["document."]
    }
];

let state = {
    chatHistory: [
        { sender: "mentor", text: "Cześć! Jestem CodeMentor. Zadaj pytanie albo wklej fragment kodu do omówienia." }
    ],
    roadmap: DEFAULT_ROADMAP,
    analyses: [],
    projectMode: false,
    projectStepIndex: 0,
    lastActive: "-"
};
let chatRequestInProgress = false;

function saveToStorage() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function loadFromStorage() {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    try {
        const parsed = JSON.parse(raw);
        state = { ...state, ...parsed };
    } catch {
        // Ignorujemy uszkodzony zapis
    }
}

// Nawigacja między stronami
function showPage(pageName) {
    document.querySelectorAll(".page").forEach(p => p.classList.remove("active"));
    document.querySelectorAll(".nav-btn").forEach(b => b.classList.remove("active"));

    const targetPage = document.getElementById(`${pageName}-page`);
    const targetBtn = document.querySelector(`.nav-btn[data-page="${pageName}"]`);
    if (targetPage) targetPage.classList.add("active");
    if (targetBtn) targetBtn.classList.add("active");

    if (pageName === "progress") renderProgress();
    if (pageName === "roadmap") renderRoadmap();
}

async function sendMessage(text) {
    const trimmed = text.trim();
    if (!trimmed || chatRequestInProgress) return;

    chatRequestInProgress = true;
    document.querySelector("#chat-form button[type='submit']").disabled = true;
    state.chatHistory.push({ sender: "user", text: trimmed });
    state.chatHistory.push({ sender: "mentor", text: "⏳ Mentor pisze..." });
    renderChatHistory();

    try {
        const messages = state.chatHistory
            .slice(0, -1)
            .filter(message => message.text !== "⏳ Mentor pisze...")
            .slice(-10)
            .map(message => ({
                role: message.sender === "user" ? "user" : "assistant",
                content: message.text
            }));

        const response = await fetch("/api/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ messages, projectMode: state.projectMode })
        });
        const responseText = await response.text();
        let result;
        try {
            result = JSON.parse(responseText);
        } catch {
            throw new Error(
                `Serwer zwrócił pustą lub nieprawidłową odpowiedź (HTTP ${response.status}). ` +
                "Uruchom aplikację poleceniem `npm start` i otwórz http://localhost:3000."
            );
        }
        if (!response.ok) {
            throw new Error(result.error || `Błąd serwera (${response.status})`);
        }

        state.chatHistory.pop();
        const reply = result.reply;
        state.chatHistory.push({ sender: "mentor", text: reply });
    } catch (err) {
        state.chatHistory.pop();
        state.chatHistory.push({ sender: "mentor", text: `⚠️ Nie udało się połączyć z Groq: ${err.message}` });
    } finally {
        chatRequestInProgress = false;
        document.querySelector("#chat-form button[type='submit']").disabled = false;
    }

    state.lastActive = new Date().toLocaleString("pl-PL");
    saveToStorage();
    renderChatHistory();
}

function renderChatHistory() {
    const container = document.getElementById("chat-history");
    container.innerHTML = "";
    state.chatHistory.forEach(msg => {
        const div = document.createElement("div");
        div.className = `message ${msg.sender}`;
        div.textContent = msg.text;
        container.appendChild(div);
    });
    container.scrollTop = container.scrollHeight;
}

function updateProjectBanner() {
    const banner = document.getElementById("project-banner");
    const label = document.getElementById("project-step-label");
    banner.classList.toggle("hidden", !state.projectMode);
    if (state.projectMode) {
        const step = PROJECT_STEPS[state.projectStepIndex];
        label.textContent = step ? `${step.title}: ${step.task}` : "Projekt ukończony!";
    }
}

// Analizator i statystyki kodu
function analyzePastedCode(code, lang) {
    const lines = code.split("\n");
    const nonEmptyLines = lines.filter(l => l.trim() !== "").length;
    const commentsCount = (code.match(/\/\/.*|\/\*[\s\S]*?\*\//g) || []).length;
    const functionsCount = (code.match(/\bfunction\b|=>/g) || []).length;
    const issues = [];

    if (lang === "js") {
        lines.forEach((line, idx) => {
            if (/\bvar\b/.test(line)) {
                issues.push({ line: idx + 1, type: "warning", msg: "Użyto `var` zamiast `let` lub `const`.", hint: "Zamień `var` na `const` lub `let`." });
            }
            if (/console\.log/.test(line)) {
                issues.push({ line: idx + 1, type: "warning", msg: "Pozostawiono `console.log`.", hint: "Usuń logi debugujące przed oddaniem kodu." });
            }
        });

        const openBraces = (code.match(/\{/g) || []).length;
        const closeBraces = (code.match(/\}/g) || []).length;
        if (openBraces !== closeBraces) {
            issues.push({ line: "-", type: "error", msg: "Niezamknięte nawiasy klamrowe `{ }`.", hint: `Otwarte: ${openBraces}, zamknięte: ${closeBraces}.` });
        }
    }

    const errorsCount = issues.filter(i => i.type === "error").length;
    const warningsCount = issues.filter(i => i.type === "warning").length;
    const score = Math.max(0, 100 - errorsCount * 15 - warningsCount * 5);

    const stats = { lang, totalLines: lines.length, nonEmptyLines, commentsCount, functionsCount, score };
    displayAnalysisResults(issues, stats);
    saveCodeAnalysis(lang, issues.length, score);
}

function displayAnalysisResults(issues, stats) {
    const statsBox = document.getElementById("code-stats");
    const statsBar = document.getElementById("stats-bar");
    const statsDetails = document.getElementById("stats-details");
    const results = document.getElementById("linter-results");

    statsBox.classList.remove("hidden");
    const colorMap = { js: "#eab308", css: "#2563eb", html: "#ea580c" };
    statsBar.innerHTML = `<div style="width: 100%; background: ${colorMap[stats.lang] || "#64748b"};"></div>`;
    statsDetails.innerHTML = `
        <span>Język: <strong>${stats.lang.toUpperCase()}</strong></span>
        <span>Linie (niepuste): <strong>${stats.nonEmptyLines}/${stats.totalLines}</strong></span>
        <span>Funkcje: <strong>${stats.functionsCount}</strong></span>
        <span>Komentarze: <strong>${stats.commentsCount}</strong></span>
        <span>Ocena: <strong>${stats.score}/100 pkt</strong></span>
    `;

    if (issues.length === 0) {
        results.innerHTML = `<div class="issue-card">✅ Brak wykrytych problemów!</div>`;
        return;
    }

    results.innerHTML = issues.map(issue => `
        <div class="issue-card ${issue.type}">
            <strong>${issue.type === "error" ? "❌ Błąd" : "⚠️ Ostrzeżenie"} (linia ${issue.line}):</strong>
            ${issue.msg}<br>
            <small>Sugestia: ${issue.hint}</small>
        </div>
    `).join("");
}

function saveCodeAnalysis(lang, issuesCount, score) {
    state.analyses.unshift({
        date: new Date().toLocaleString("pl-PL"),
        lang,
        issuesCount,
        score
    });
    state.lastActive = new Date().toLocaleString("pl-PL");
    saveToStorage();
}

// Mapa nauki
function toggleTopicCompletion(topicId) {
    const topic = state.roadmap.find(t => t.id === topicId);
    if (!topic) return;
    topic.done = !topic.done;
    state.lastActive = new Date().toLocaleString("pl-PL");
    saveToStorage();
    renderRoadmap();
}

function renderRoadmap() {
    const list = document.getElementById("roadmap-list");
    list.innerHTML = "";

    state.roadmap.forEach(topic => {
        const card = document.createElement("div");
        card.className = `roadmap-card ${topic.done ? "done" : ""}`;
        card.innerHTML = `
            <div>
                <h3>${topic.title}</h3>
                <p>${topic.desc}</p>
            </div>
            <span>${topic.done ? "✓ Ukończono" : "Kliknij, aby zaliczyć"}</span>
        `;
        card.addEventListener("click", () => toggleTopicCompletion(topic.id));
        list.appendChild(card);
    });

    const doneCount = state.roadmap.filter(t => t.done).length;
    const pct = Math.round((doneCount / state.roadmap.length) * 100);
    document.getElementById("roadmap-progress-text").textContent = `Ukończono: ${pct}%`;
}

// Postępy
function renderProgress() {
    const totalAnalyses = state.analyses.length;
    const totalErrors = state.analyses.reduce((sum, a) => sum + a.issuesCount, 0);
    const doneTopics = state.roadmap.filter(t => t.done).length;

    document.getElementById("stat-analyses").textContent = totalAnalyses;
    document.getElementById("stat-errors").textContent = totalErrors;
    document.getElementById("stat-topics").textContent = `${doneTopics}/${state.roadmap.length}`;
    document.getElementById("stat-last-active").textContent = state.lastActive;

    const historyList = document.getElementById("analysis-history");
    historyList.innerHTML = state.analyses.length
        ? state.analyses.map(a => `<li><span>${a.date} (${a.lang.toUpperCase()})</span><span>Błędów: ${a.issuesCount} | Ocena: ${a.score}/100</span></li>`).join("")
        : "<li>Brak jeszcze przeanalizowanych kodów.</li>";
}

// Inicjalizacja i event listenery
document.addEventListener("DOMContentLoaded", () => {
    loadFromStorage();
    renderChatHistory();
    renderRoadmap();
    updateProjectBanner();
    localStorage.removeItem("codementor_groq_key");
    document.getElementById("project-mode-toggle").checked = state.projectMode;

    document.querySelectorAll(".nav-btn").forEach(btn => {
        btn.addEventListener("click", () => showPage(btn.dataset.page));
    });

    document.getElementById("chat-form").addEventListener("submit", e => {
        e.preventDefault();
        const input = document.getElementById("chat-input");
        sendMessage(input.value);
        input.value = "";
    });

    document.getElementById("project-mode-toggle").addEventListener("change", e => {
        state.projectMode = e.target.checked;
        updateProjectBanner();
        saveToStorage();
    });

    document.getElementById("project-hint-btn").addEventListener("click", () => {
        const step = PROJECT_STEPS[state.projectStepIndex];
        if (step) {
            state.chatHistory.push({ sender: "mentor", text: `💡 Podpowiedź (${step.title}): ${step.hint}` });
            saveToStorage();
            renderChatHistory();
        }
    });

    document.getElementById("analyze-btn").addEventListener("click", () => {
        const code = document.getElementById("linter-input").value;
        const lang = document.getElementById("code-lang").value;
        if (code.trim()) analyzePastedCode(code, lang);
    });

    document.getElementById("code-file-input").addEventListener("change", async e => {
        const file = e.target.files[0];
        if (!file) return;
        document.getElementById("linter-input").value = await file.text();
        if (file.name.endsWith(".css")) document.getElementById("code-lang").value = "css";
        else if (file.name.endsWith(".html")) document.getElementById("code-lang").value = "html";
        else document.getElementById("code-lang").value = "js";
    });

    const modal = document.getElementById("mentor-modal");
    document.getElementById("open-help-modal").addEventListener("click", () => modal.classList.remove("hidden"));
    document.getElementById("close-modal").addEventListener("click", () => modal.classList.add("hidden"));
});
