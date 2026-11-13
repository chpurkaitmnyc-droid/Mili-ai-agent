/**
 * ============================================================================
 * server.js — Mili AI Voice Agent REST API Server
 * ============================================================================
 * Exposes the Mili AI pipeline as a secure Express REST API.
 *
 * Endpoints:
 *   GET  /               → Health check
 *   GET  /api/status     → Service status + DB summary
 *   POST /api/chat       → Core multi-turn text chat with Mili
 *   POST /api/customers  → List or filter customers from mock DB
 *   POST /api/scan       → Trigger autonomous outbound scanner manually
 *
 * Usage:
 *   node server.js
 *
 * Then tunnel with:
 *   npx localtunnel --port 3000
 * ============================================================================
 */

require("dotenv").config();
const express  = require("express");
const cors     = require("cors");
const path     = require("path");
const fs       = require("fs");
const OpenAI   = require("openai");

const { PromptGenerator, buildSystemPrompt, buildOutboundSystemPrompt, convertAmountToBengaliWords } = require("./mili-prompt");
const { SessionManager } = require("./session-manager");

// ── App Setup ────────────────────────────────────────────────────────────────
const app  = express();
const PORT = process.env.PORT || 3000;

// ── CORS: allow requests from any origin (Hostinger, localhost, etc.) ────────
app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "OPTIONS"],
  allowedHeaders: ["Content-Type", "Authorization", "x-session-id"],
}));
app.options("/{*path}", cors()); // Pre-flight support for all routes (Express 5 syntax)

app.use(express.json({ limit: "2mb" }));
app.use(express.urlencoded({ extended: true }));

// ── Request Logger ───────────────────────────────────────────────────────────
app.use((req, _res, next) => {
  console.log(`\n📡 [API] ${req.method} ${req.path} — ${new Date().toLocaleTimeString()}`);
  if (req.body && typeof req.body === "object" && Object.keys(req.body).length) {
    console.log("   Body:", JSON.stringify(req.body).slice(0, 200));
  }
  next();
});

// ── NVIDIA NIM / DeepSeek Client ─────────────────────────────────────────────
const nvidiaClient = process.env.NVIDIA_API_KEY
  ? new OpenAI({
      baseURL: "https://integrate.api.nvidia.com/v1",
      apiKey: process.env.NVIDIA_API_KEY,
      timeout: 10000,
      maxRetries: 1,
    })
  : null;

// ── Session Store (in-memory, keyed by sessionId) ───────────────────────────
const sessionManager = new SessionManager();

// ── DB Path ──────────────────────────────────────────────────────────────────
const DB_PATH = path.resolve(__dirname, "mock_customers.json");

function readDB() {
  return JSON.parse(fs.readFileSync(DB_PATH, "utf-8"));
}

function writeDB(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), "utf-8");
}

// ── Core LLM Helper ──────────────────────────────────────────────────────────
/**
 * Calls DeepSeek with 5s timeout guard. Falls back to Gemini if configured.
 * @param {Array} messages - chat_history array
 * @param {number} [maxTokens=180]
 * @returns {Promise<string>} Raw LLM reply text
 */
async function callLLM(messages, maxTokens = 180) {
  // --- DeepSeek (NVIDIA NIM) ---
  if (nvidiaClient) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 5000);
    try {
      const res = await nvidiaClient.chat.completions.create(
        {
          model: "deepseek-ai/deepseek-v4.1-flash",
          messages,
          temperature: 0.6,
          max_tokens: maxTokens,
        },
        { signal: ctrl.signal }
      );
      clearTimeout(timer);
      let text = res.choices[0]?.message?.content || "";
      return text.replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/[*_#`]/g, "").trim();
    } catch (e) {
      clearTimeout(timer);
      console.warn(`⚠️ DeepSeek timeout/error: ${e.message}`);
    }
  }

  // --- Gemini fallback ---
  const geminiKey = process.env.GEMINI_API_KEY;
  if (geminiKey && !geminiKey.includes("your_gemini")) {
    try {
      const { GoogleGenAI } = require("@google/genai");
      const ai = new GoogleGenAI({ apiKey: geminiKey });
      const prompt = messages.map(m => `${m.role}: ${m.content}`).join("\n");
      const response = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: prompt,
      });
      let text = response.text ? response.text.trim() : "";
      return text.replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/[*_#`]/g, "").trim();
    } catch (e) {
      console.warn(`⚠️ Gemini fallback failed: ${e.message}`);
    }
  }

  // --- Intelligent Contextual Bengali Fallback Engine ---
  const lastUserMsg = [...messages].reverse().find(m => m.role === "user")?.content || "";
  const lower = lastUserMsg.toLowerCase();

  if (lower.includes("busy") || lastUserMsg.includes("ব্যস্ত") || lastUserMsg.includes("পরে")) {
    return "আচ্ছা ঠিক আছে, কখন ফোন করলে আপনার সুবিধা হবে বলুন?";
  }
  if (lower.includes("discount") || lastUserMsg.includes("কম") || lastUserMsg.includes("চয়ন") || lastUserMsg.includes("ভুল")) {
    return "আমি বিষয়টি চয়ন স্যারকে জানিয়ে রাখছি, উনি আপনার সাথে কথা বলে নেবেন।";
  }
  if (lastUserMsg.includes("কাল") || lastUserMsg.includes("দেব") || lower.includes("pay")) {
    return "ধন্যবাদ! কালকের মধ্যে টাকাটা মিটিয়ে দিলে খুব উপকার হয়।";
  }
  if (lastUserMsg.includes("নমস্কার") || lastUserMsg.includes("হ্যালো") || lower.includes("hi") || lower.includes("hello")) {
    return "নমস্কার! আমি মায়ের আশীর্বাদ স্টোর থেকে মিলি বলছি। কীভাবে আপনাকে সাহায্য করতে পারি?";
  }

  return "আচ্ছা, আমি আপনার বিষয়টি বুঝতে পারছি। আমাদের স্টোরের বকেয়া হিসাব সম্পর্কে বিস্তারিত জানতে চাইলে বলুন।";
}

// ── Optional Sarvam TTS Voice Synthesis ─────────────────────────────────────
const sarvamApiKey = process.env.SARVAM_API_KEY;

async function synthesizeVoiceBase64(text) {
  if (!sarvamApiKey) return null;
  try {
    const response = await fetch("https://api.sarvam.ai/text-to-speech", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-subscription-key": sarvamApiKey,
      },
      body: JSON.stringify({
        text,
        language_code: "bn-IN",
        speaker: "roopa",
        model: "bulbul:v3",
      }),
    });
    if (!response.ok) return null;
    const data = await response.json();
    return data.audios && data.audios[0] ? data.audios[0] : null;
  } catch (err) {
    console.warn("⚠️ TTS generation skipped/error:", err.message);
    return null;
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────────
/**
 * Cleans or creates a text-only session keyed by sessionId.
 * sessionId is a string from the frontend (e.g. "customer-3" or a UUID).
 */
function ensureSession(sessionId, context) {
  let session = sessionManager.getSession(sessionId);
  if (!session) {
    const fakeCustomer = { id: sessionId, name: context.customerName || "গ্রাহক" };
    const systemPrompt = PromptGenerator.buildOutboundSystemPrompt(context);
    session = sessionManager.createSession(fakeCustomer, systemPrompt);
  }
  return session;
}

// ============================================================================
// ROUTES
// ============================================================================

// ── GET / — Health Check ─────────────────────────────────────────────────────
app.get("/", (_req, res) => {
  res.json({
    service:   "Mili Bengali AI Voice Agent API",
    status:    "online",
    version:   "2.0.0",
    timestamp: new Date().toISOString(),
    endpoints: {
      "GET  /api/status":    "Service and DB status",
      "POST /api/chat":      "Multi-turn text chat with Mili",
      "GET  /api/customers": "List all customers from mock DB",
      "POST /api/scan":      "Manually trigger outbound scanner (dry run)",
    },
  });
});

// ── GET /api/status ───────────────────────────────────────────────────────────
app.get("/api/status", (_req, res) => {
  try {
    const db = readDB();
    const summary = {
      total:          db.length,
      pending:        db.filter(c => c.status === "pending").length,
      calling:        db.filter(c => c.status === "calling").length,
      promised_to_pay:db.filter(c => c.status === "promised_to_pay").length,
      disputed:       db.filter(c => c.status === "disputed").length,
      refused:        db.filter(c => c.status === "refused").length,
    };
    res.json({
      status:       "online",
      llm_provider: nvidiaClient ? "DeepSeek (NVIDIA NIM)" : (process.env.GEMINI_API_KEY ? "Gemini" : "fallback"),
      tts_provider: process.env.SARVAM_API_KEY ? "Sarvam AI bulbul:v3" : "not configured",
      stt_provider: process.env.SARVAM_API_KEY ? "Sarvam AI saaras:v3" : "not configured",
      active_sessions: sessionManager.sessions.size,
      database_summary: summary,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/customers ───────────────────────────────────────────────────────
app.get("/api/customers", (_req, res) => {
  try {
    const db = readDB();
    res.json({ customers: db });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/chat — Core Multi-Turn Text Chat Endpoint ─────────────────────
/**
 * Request body:
 * {
 *   "message":      "User's text input (Bengali or Benglish)",
 *   "sessionId":    "unique session key e.g. 'customer-3' or UUID",   [optional]
 *   "customerName": "Raju",                                            [optional]
 *   "dueAmount":    3500,                                              [optional]
 *   "shopName":     "মায়ের আশীর্বাদ স্টোর",                           [optional]
 *   "items":        "building materials"                               [optional]
 * }
 *
 * Response:
 * {
 *   "reply":     "Mili's Bengali response text",
 *   "sessionId": "echoed session ID",
 *   "turn":      3
 * }
 */
app.post("/api/chat", async (req, res) => {
  const {
    message,
    sessionId     = "default-session",
    customerName  = "গ্রাহক",
    dueAmount     = 0,
    shopName      = "মায়ের আশীর্বাদ স্টোর",
    items         = "বকেয়া বিল",
    generateAudio = false,
  } = req.body;

  if (!message || typeof message !== "string" || !message.trim()) {
    return res.status(400).json({
      error: "Missing or empty 'message' field in request body.",
      expected: { message: "<string>", sessionId: "<string (optional)>" },
    });
  }

  console.log(`💬 [/api/chat] session="${sessionId}" | text="${message}"`);
  console.log(`   typeof message: ${typeof message} | length: ${message.length}`);

  try {
    const context = {
      shopName,
      customerName,
      dueAmount: Number(dueAmount) || 0,
      items,
    };

    // Get or create session with injected system prompt
    const session = ensureSession(sessionId, context);

    // Add user message to session history
    sessionManager.addMessage(sessionId, "user", message.trim());

    // Run LLM with full multi-turn chat_history
    console.time(`⏱️ [/api/chat] LLM latency session=${sessionId}`);
    const replyText = await callLLM(session.chat_history, 180);
    console.timeEnd(`⏱️ [/api/chat] LLM latency session=${sessionId}`);

    // Add Mili's reply back to history (preserves multi-turn memory)
    sessionManager.addMessage(sessionId, "assistant", replyText);

    const turnCount = session.chat_history.filter(m => m.role === "user").length;

    console.log(`🤖 [/api/chat] Mili reply (turn ${turnCount}): "${replyText}"`);

    // Optional audio synthesis if requested by frontend
    let audioBase64 = null;
    if (generateAudio) {
      console.log("🔊 [/api/chat] Generating voice audio via Sarvam TTS...");
      audioBase64 = await synthesizeVoiceBase64(replyText);
    }

    res.json({
      reply:       replyText,
      audio:       audioBase64,
      audioFormat: audioBase64 ? "audio/wav" : null,
      sessionId:   sessionId,
      turn:        turnCount,
      timestamp:   new Date().toISOString(),
    });

  } catch (err) {
    console.error(`❌ [/api/chat] Error: ${err.message}`);
    res.status(500).json({
      error:   "Internal server error while processing your message.",
      details: err.message,
    });
  }
});

// ── POST /api/scan — Manual Outbound Scanner Trigger ────────────────────────
/**
 * Triggers a dry-run scan of mock_customers.json without consuming TTS credits.
 * Response: first overdue customer found, or null.
 */
app.post("/api/scan", (req, res) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const db    = readDB();
    const overdue = db.find(c => c.status === "pending" && c.dueDate <= today);

    if (!overdue) {
      return res.json({ found: false, message: "No overdue pending customers found." });
    }

    res.json({
      found:    true,
      customer: overdue,
      message:  `Overdue customer found: ${overdue.name}, ₹${overdue.dueAmount} due since ${overdue.dueDate}`,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/session/clear — Clear Session History ─────────────────────────
app.post("/api/session/clear", (req, res) => {
  const { sessionId } = req.body;
  if (!sessionId) return res.status(400).json({ error: "sessionId required" });
  sessionManager.endSession(sessionId);
  res.json({ success: true, message: `Session "${sessionId}" cleared.` });
});

// ── 404 Catch-All ─────────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({
    error:    "Route not found",
    path:     req.path,
    method:   req.method,
    available: ["GET /", "GET /api/status", "GET /api/customers", "POST /api/chat", "POST /api/scan", "POST /api/session/clear"],
  });
});

// ── Global Error Handler ──────────────────────────────────────────────────────
app.use((err, _req, res, _next) => {
  console.error("❌ [Server] Unhandled error:", err.message);
  res.status(500).json({ error: "Unhandled server error", details: err.message });
});

// ── Start Server ──────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log("=================================================================");
  console.log("   🎙️  Mili AI Agent REST API Server — ONLINE");
  console.log("=================================================================");
  console.log(`   Local URL:   http://localhost:${PORT}`);
  console.log(`   Health:      http://localhost:${PORT}/api/status`);
  console.log(`   Chat API:    POST http://localhost:${PORT}/api/chat`);
  console.log("=================================================================");
  console.log("   📡 For public HTTPS URL, run in a NEW terminal:");
  console.log(`   npx localtunnel --port ${PORT}`);
  console.log("=================================================================");
});

module.exports = app;
