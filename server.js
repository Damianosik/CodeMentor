const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = __dirname;
const GROQ_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL = "llama-3.3-70b-versatile";
const MAX_BODY_BYTES = 20_000;
const MAX_MESSAGE_LENGTH = 8_000;
const RATE_LIMIT_WINDOW_MS = 60_000;
const RATE_LIMIT_MAX_REQUESTS = 10;

const PUBLIC_FILES = new Map([
    ["/", ["index.html", "text/html; charset=utf-8"]],
    ["/index.html", ["index.html", "text/html; charset=utf-8"]],
    ["/style.css", ["style.css", "text/css; charset=utf-8"]],
    ["/script.js", ["script.js", "text/javascript; charset=utf-8"]],
    ["/favicon.png", ["favicon.png", "image/png"]]
]);
const requestsByIp = new Map();

function loadEnvFile() {
    const envPath = path.join(ROOT, ".env");
    if (!fs.existsSync(envPath)) return;

    for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#")) continue;
        const separator = trimmed.indexOf("=");
        if (separator < 1) continue;

        const name = trimmed.slice(0, separator).trim();
        const value = trimmed.slice(separator + 1).trim().replace(/^(['"])(.*)\1$/, "$2");
        if (!process.env[name]) process.env[name] = value;
    }
}

function sendJson(res, status, data) {
    res.writeHead(status, {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff"
    });
    res.end(JSON.stringify(data));
}

function getClientIp(req) {
    const forwardedFor = req.headers["x-forwarded-for"];
    if (typeof forwardedFor === "string" && forwardedFor.length <= 256) {
        return forwardedFor.split(",")[0].trim();
    }
    return req.socket.remoteAddress || "unknown";
}

function isRateLimited(ip) {
    const now = Date.now();
    const recent = (requestsByIp.get(ip) || []).filter(time => now - time < RATE_LIMIT_WINDOW_MS);
    if (recent.length >= RATE_LIMIT_MAX_REQUESTS) {
        requestsByIp.set(ip, recent);
        return true;
    }
    recent.push(now);
    requestsByIp.set(ip, recent);

    if (requestsByIp.size > 2_000) {
        for (const [address, timestamps] of requestsByIp) {
            if (timestamps.every(time => now - time >= RATE_LIMIT_WINDOW_MS)) {
                requestsByIp.delete(address);
            }
        }
    }
    return false;
}

async function readJsonBody(req) {
    const chunks = [];
    let size = 0;

    for await (const chunk of req) {
        size += chunk.length;
        if (size > MAX_BODY_BYTES) {
            const error = new Error("Request body is too large.");
            error.statusCode = 413;
            throw error;
        }
        chunks.push(chunk);
    }

    try {
        return JSON.parse(Buffer.concat(chunks).toString("utf8"));
    } catch {
        const error = new Error("Invalid JSON.");
        error.statusCode = 400;
        throw error;
    }
}

function validateMessages(messages) {
    if (!Array.isArray(messages) || messages.length < 1 || messages.length > 12) {
        return false;
    }

    return messages.every(message =>
        message &&
        (message.role === "user" || message.role === "assistant") &&
        typeof message.content === "string" &&
        message.content.trim().length > 0 &&
        message.content.length <= MAX_MESSAGE_LENGTH
    ) && messages[messages.length - 1].role === "user";
}

async function handleChat(req, res) {
    if (req.headers["content-type"]?.split(";")[0].trim() !== "application/json") {
        return sendJson(res, 415, { error: "Wymagany jest format JSON." });
    }

    const ip = getClientIp(req);
    if (isRateLimited(ip)) {
        res.setHeader("Retry-After", "60");
        return sendJson(res, 429, { error: "Limit zapytań osiągnięty. Spróbuj ponownie za minutę." });
    }

    let body;
    try {
        body = await readJsonBody(req);
    } catch (error) {
        console.error("Invalid API request body:", error.message);
        return sendJson(res, error.statusCode || 400, {
            error: error.statusCode === 413 ? "Wysłane dane są za duże." : "Nieprawidłowe dane żądania."
        });
    }

    if (!validateMessages(body.messages) || typeof body.projectMode !== "boolean") {
        console.error("Invalid API request schema.");
        return sendJson(res, 400, { error: "Nieprawidłowy format wiadomości." });
    }

    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
        return sendJson(res, 503, { error: "AI nie jest jeszcze skonfigurowane na serwerze." });
    }

    const systemPrompt = body.projectMode
        ? "Jesteś cierpliwym mentorem programowania. Prowadź użytkownika krok po kroku przez budowę projektu w HTML, CSS i JavaScript. Dawaj jedno małe zadanie na raz, nie podawaj od razu całego gotowego rozwiązania, pomagaj zrozumieć kod. Odpowiadaj po polsku."
        : "Jesteś cierpliwym mentorem HTML, CSS i JavaScript. Odpowiadaj jasno i po polsku, wyjaśniaj pojęcia oraz pomagaj użytkownikowi uczyć się programowania.";

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 30_000);

    try {
        const groqResponse = await fetch(GROQ_ENDPOINT, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${apiKey}`
            },
            body: JSON.stringify({
                model: GROQ_MODEL,
                messages: [
                    { role: "system", content: systemPrompt },
                    ...body.messages
                ],
                max_tokens: 800
            }),
            signal: controller.signal
        });

        if (!groqResponse.ok) {
            console.error(`Groq API returned HTTP ${groqResponse.status}`);
            return sendJson(res, 502, { error: "Usługa AI chwilowo nie odpowiedziała. Spróbuj ponownie." });
        }

        const result = await groqResponse.json();
        const reply = result.choices?.[0]?.message?.content;
        if (typeof reply !== "string" || !reply.trim()) {
            console.error("Groq API response did not contain a reply.");
            return sendJson(res, 502, { error: "Usługa AI zwróciła nieprawidłową odpowiedź." });
        }

        return sendJson(res, 200, { reply });
    } catch (error) {
        const message = error.name === "AbortError"
            ? "Upłynął limit czasu odpowiedzi AI. Spróbuj ponownie."
            : "Nie udało się połączyć z usługą AI. Spróbuj ponownie.";
        console.error(message, error.message);
        return sendJson(res, 502, { error: message });
    } finally {
        clearTimeout(timeout);
    }
}

function setSecurityHeaders(res) {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
}

const server = http.createServer(async (req, res) => {
    setSecurityHeaders(res);
    const pathname = new URL(req.url, "http://localhost").pathname;

    if (pathname === "/healthz" && req.method === "GET") {
        return sendJson(res, 200, { status: "ok" });
    }

    if (pathname === "/api/chat") {
        if (req.method !== "POST") {
            res.setHeader("Allow", "POST");
            return sendJson(res, 405, { error: "Niedozwolona metoda." });
        }
        return handleChat(req, res);
    }

    if (req.method !== "GET" && req.method !== "HEAD") {
        res.setHeader("Allow", "GET, HEAD");
        res.writeHead(405);
        return res.end();
    }

    const file = PUBLIC_FILES.get(pathname);
    if (!file) {
        res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
        return res.end("Not Found");
    }

    fs.readFile(path.join(ROOT, file[0]), (error, content) => {
        if (error) {
            console.error(`Unable to read public file: ${file[0]}`, error.message);
            res.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
            return res.end("Internal Server Error");
        }
        res.writeHead(200, {
            "Content-Type": file[1],
            "Cache-Control": file[0] === "index.html" ? "no-cache" : "public, max-age=3600"
        });
        return res.end(req.method === "HEAD" ? undefined : content);
    });
});

loadEnvFile();
const PORT = Number(process.env.PORT) || 3000;
server.listen(PORT, "0.0.0.0", () => {
    console.log(`CodeMentor działa pod adresem: http://localhost:${PORT}`);
});

server.on("error", error => {
    console.error("Nie udało się uruchomić serwera:", error.message);
    process.exitCode = 1;
});
