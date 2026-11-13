/**
 * ============================================================================
 * server.js — Mili AI Voice & Chat REST API Server
 * ============================================================================
 * Production-ready backend for "Mili" (মিলি), accounts & customer relationship
 * assistant for retail building construction materials businesses.
 *
 * Endpoints:
 *   GET  /                  → Health check & endpoint catalogue
 *   GET  /api/status        → Live provider & database status
 *   GET  /api/customers     → Customer accounts list from database
 *   POST /api/chat          → Upgraded multi-turn chat with { reply, emotion, audio, audioFormat }
 *   POST /api/call/start    → Initiate outbound call with opening greeting & voice
 *   POST /api/call/respond  → Interactive ongoing call conversation turn
 *   POST /api/scan          → Trigger overdue debt collection scan
 *   POST /api/session/clear → Clear session history
 * ============================================================================
 */

require("dotenv").config();
const express = require("express");
const cors    = require("cors");
const path    = require("path");
const fs      = require("fs");
const crypto  = require("crypto");
const OpenAI  = require("openai");

const { generateSpeech, cleanTextForTTS } = require("./ttsService");
const { buildMiliSystemPrompt, buildCallOpeningPrompt, convertAmountToBengaliWords } = require("./mili-prompt");
const { SessionManager } = require("./session-manager");

const app  = express();
const PORT = process.env.PORT || 3000;

// ============================================================================
// 1. CORS & Middleware (Phase 2, Requirement 5)
// ============================================================================
app.use(cors({
  origin: "*",
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "x-session-id",
    "bypass-tunnel-reminder",
    "Bypass-Tunnel-Reminder",
    "ngrok-skip-browser-warning",
  ],
  exposedHeaders: ["Content-Length", "X-Session-Id"],
}));

// Pre-flight support across all routes
app.options("/{*path}", cors());

app.use(express.json({ limit: "4mb" }));
app.use(express.urlencoded({ extended: true }));

// Request logging middleware
app.use((req, _res, next) => {
  console.log(`\n📡 [API] ${req.method} ${req.path} — ${new Date().toLocaleTimeString()}`);
  if (req.body && typeof req.body === "object" && Object.keys(req.body).length) {
    const preview = JSON.stringify(req.body);
    console.log("   Body:", preview.length > 200 ? preview.slice(0, 200) + "..." : preview);
  }
  next();
});

// ============================================================================
// 2. Clients & In-Memory Stores
// ============================================================================

// NVIDIA NIM DeepSeek Client
const nvidiaClient = process.env.NVIDIA_API_KEY
  ? new OpenAI({
      baseURL: "https://integrate.api.nvidia.com/v1",
      apiKey: process.env.NVIDIA_API_KEY,
      timeout: 6000,
      maxRetries: 1,
    })
  : null;

// Chat session manager (keyed by sessionId)
const sessionManager = new SessionManager();

// Active phone call sessions store (keyed by callId)
const callSessions = new Map();

// Mock database path
const DB_PATH = path.resolve(__dirname, "mock_customers.json");

function readDB() {
  return JSON.parse(fs.readFileSync(DB_PATH, "utf-8"));
}

function writeDB(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), "utf-8");
}

// ============================================================================
// 3. Cognitive Brain & Reasoning Engine (Phase 2, Requirement 2)
// ============================================================================

/**
 * Intelligent Bengali debt recovery fallback engine.
 * Employs empathetic negotiation, dispute escalation to Chayan Sir, and reschedule handling.
 *
 * @param {string} userMessage 
 * @param {object} context 
 * @returns {{ reply: string, emotion: string }}
 */
function analyzeAndGenerateHeuristic(userMessage, context = {}) {
  const customerName = context.customerName || "গ্রাহক";
  const dueAmount = Number(context.dueAmount) || 0;
  const amountWords = convertAmountToBengaliWords(dueAmount);
  const msg = (userMessage || "").toLowerCase();

  // 1. Hard refusal or inability to pay (Core debt-recovery intelligence)
  if (
    msg.includes("টাকা দেব না") ||
    msg.includes("টাকা দিব না") ||
    msg.includes("টাকা দিতে পারব না") ||
    msg.includes("টাকা নেই") ||
    msg.includes("টাকা নাই") ||
    msg.includes("দেবো না") ||
    msg.includes("দিব না") ||
    msg.includes("পারব না") ||
    msg.includes("দেবোনা") ||
    msg.includes("no money") ||
    msg.includes("cannot pay") ||
    msg.includes("won't pay")
  ) {
    return {
      reply: `${customerName}বাবু, আপনার অসুবিধার কথা আমি মন থেকে বুঝতে পারছি। তবে দেখুন, আমাদের স্টোরের সাথে আপনার দীর্ঘদিনের বিশ্বাসের সম্পর্ক, আর মালগুলো সম্পূর্ণ বিশ্বাসেই দেওয়া হয়েছিল। আপনি কি আজ অন্তত কিছুটা টাকা জমা দিয়ে বাকিটা সামনের সপ্তাহে দিতে পারেন? এতে হিসাবটাও চালু থাকবে।`,
      emotion: "persuasive",
    };
  }

  // 2. Billing dispute or discount request -> Escalate strictly to Chayan Sir
  if (
    msg.includes("discount") ||
    msg.includes("ডিসকাউন্ট") ||
    msg.includes("কম") ||
    msg.includes("ভুল") ||
    msg.includes("চয়ন") ||
    msg.includes("চয়ন") ||
    msg.includes("বেশি")
  ) {
    return {
      reply: `${customerName}বাবু, আপনার অভিযোগটি আমি গুরুত্ব সহকারে লিখে রাখলাম। আমি বিষয়টি সরাসরি চয়ন স্যারকে জানিয়ে রাখছি, উনি নিজে আপনার সাথে কথা বলে বিষয়টি মিটিয়ে নেবেন।`,
      emotion: "empathetic",
    };
  }

  // 3. Customer promises payment / commits to pay tomorrow or later
  if (
    msg.includes("কাল") ||
    msg.includes("দেব") ||
    msg.includes("দিব") ||
    msg.includes("pay") ||
    msg.includes("পরিশোধ") ||
    msg.includes("ক্লিয়ার") ||
    msg.includes("পাঠিয়ে দিচ্ছি")
  ) {
    return {
      reply: `অনেক ধন্যবাদ ${customerName}বাবু আপনার সদিচ্ছার জন্য। কথা অনুযায়ী আপনি কালকের মধ্যেই ${amountWords} পরিশোধ করে দিলে আমাদের দোকানের চালান মেটাতে খুব সুবিধা হয়।`,
      emotion: "reassuring",
    };
  }

  // 4. Customer is busy or asks to call back later
  if (
    msg.includes("busy") ||
    msg.includes("ব্যস্ত") ||
    msg.includes("পরে") ||
    msg.includes("গাড়ি") ||
    msg.includes("মিটিং") ||
    msg.includes("later")
  ) {
    return {
      reply: `আচ্ছা ঠিক আছে ${customerName}বাবু, আপনি এখন কাজে ব্যস্ত আছেন বুঝতে পারছি। কখন ফোন করলে আপনার কথা বলতে সুবিধা হবে একটু জানিয়ে দিন?`,
      emotion: "polite",
    };
  }

  // 5. Greeting / Initial conversation opener
  if (
    msg.includes("নমস্কার") ||
    msg.includes("হ্যালো") ||
    msg.includes("hi") ||
    msg.includes("hello") ||
    msg.includes("কে বলছেন")
  ) {
    return {
      reply: `নমস্কার ${customerName}বাবু! আমি মায়ের আশীর্বাদ স্টোর থেকে মিলি বলছি। আপনার বকেয়া ${amountWords}-এর হিসাব সংক্রান্ত বিষয়ে কথা বলতে ফোন করেছি।`,
      emotion: "polite",
    };
  }

  // Default empathetic response
  return {
    reply: `${customerName}বাবু, আমি আপনার কথা বুঝতে পারলাম। আমাদের বিল্ডিং ম্যাটেরিয়ালসের বকেয়া ${amountWords} পরিশোধের বিষয়ে আপনি কীভাবে এগোতে চাইছেন একটু জানালে ভালো হতো।`,
    emotion: "empathetic",
  };
}

/**
 * Parses raw LLM text into a safe { reply, emotion } object.
 *
 * @param {string} raw 
 * @param {object} context 
 * @param {string} userMessage 
 * @returns {{ reply: string, emotion: string }}
 */
function parseLLMResponse(raw, context, userMessage) {
  if (!raw || typeof raw !== "string") {
    return analyzeAndGenerateHeuristic(userMessage, context);
  }

  try {
    const clean = raw
      .replace(/```json/gi, "")
      .replace(/```/gi, "")
      .trim();

    const parsed = JSON.parse(clean);
    if (parsed && parsed.reply) {
      return {
        reply: cleanTextForTTS(parsed.reply),
        emotion: parsed.emotion || "empathetic",
      };
    }
  } catch (_e) {
    // If not JSON, check if it contains text
    const textOnly = cleanTextForTTS(raw);
    if (textOnly && textOnly.length > 5) {
      return {
        reply: textOnly,
        emotion: "empathetic",
      };
    }
  }

  return analyzeAndGenerateHeuristic(userMessage, context);
}

/**
 * Generates an LLM response using DeepSeek (with timeout) or Gemini fallback,
 * backed by the deterministic heuristic engine.
 *
 * @param {Array} messages - Full conversation history
 * @param {object} context - Customer and store context
 * @param {string} userMessage - Latest user input
 * @returns {Promise<{ reply: string, emotion: string }>}
 */
async function generateMiliResponse(messages, context, userMessage) {
  // 1. Try DeepSeek (NVIDIA NIM)
  if (nvidiaClient) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);
    try {
      const completion = await nvidiaClient.chat.completions.create(
        {
          model: "deepseek-ai/deepseek-v4.1-flash",
          messages,
          temperature: 0.5,
          max_tokens: 220,
          response_format: { type: "json_object" },
        },
        { signal: ctrl.signal }
      );
      clearTimeout(timer);
      const rawText = completion.choices[0]?.message?.content || "";
      if (rawText) {
        return parseLLMResponse(rawText, context, userMessage);
      }
    } catch (err) {
      clearTimeout(timer);
      console.warn(`⚠️ [LLM] DeepSeek unavailable (${err.message}) — switching to fallback.`);
    }
  }

  // 2. Try Gemini fallback if configured
  const geminiKey = process.env.GEMINI_API_KEY;
  if (geminiKey && !geminiKey.includes("your_gemini") && geminiKey.trim()) {
    try {
      const { GoogleGenAI } = require("@google/genai");
      const ai = new GoogleGenAI({ apiKey: geminiKey });
      const prompt = messages.map(m => `${m.role}: ${m.content}`).join("\n");
      const result = await ai.models.generateContent({
        model: "gemini-2.5-flash",
        contents: prompt,
      });
      const text = result.text ? result.text.trim() : "";
      if (text) {
        return parseLLMResponse(text, context, userMessage);
      }
    } catch (e) {
      console.warn(`⚠️ [LLM] Gemini fallback failed (${e.message}).`);
    }
  }

  // 3. Guaranteed cognitive heuristic engine
  return analyzeAndGenerateHeuristic(userMessage, context);
}

// ============================================================================
// 4. Session Helper
// ============================================================================
function getOrCreateChatSession(sessionId, context) {
  let session = sessionManager.getSession(sessionId);
  if (!session) {
    const fakeCustomer = { id: sessionId, name: context.customerName || "গ্রাহক" };
    const systemPrompt = buildMiliSystemPrompt(context);
    session = sessionManager.createSession(fakeCustomer, systemPrompt);
  }
  return session;
}

// ============================================================================
// 5. REST Endpoints
// ============================================================================

// ── GET / — Health & Catalogue ──────────────────────────────────────────────
app.get("/", (_req, res) => {
  res.json({
    service:   "Mili (মিলি) Bengali AI Voice & Chat System",
    status:    "online",
    version:   "3.0.0",
    timestamp: new Date().toISOString(),
    endpoints: {
      "POST /api/chat":          "Multi-turn chat with { reply, emotion, audio, audioFormat }",
      "POST /api/call/start":    "Initiate outbound phone call session with greeting & voice",
      "POST /api/call/respond":  "Ongoing outbound call conversation turn",
      "GET  /api/status":        "Live system & database status",
      "GET  /api/customers":     "Customer database records",
      "POST /api/scan":          "Scan mock DB for overdue pending customers",
      "POST /api/session/clear": "Clear a chat session history",
    },
  });
});

// ── GET /api/status ──────────────────────────────────────────────────────────
app.get("/api/status", (_req, res) => {
  try {
    const db = readDB();
    const summary = {
      total:           db.length,
      pending:         db.filter(c => c.status === "pending").length,
      calling:         db.filter(c => c.status === "calling").length,
      promised_to_pay: db.filter(c => c.status === "promised_to_pay").length,
      disputed:        db.filter(c => c.status === "disputed").length,
      refused:         db.filter(c => c.status === "refused").length,
    };
    res.json({
      status:           "online",
      agent_name:       "Mili (মিলি)",
      business:         "মায়ের আশীর্বাদ স্টোর (Building Materials & Kirana)",
      tts_engine:       process.env.SARVAM_API_KEY ? "Sarvam AI (bulbul:v3 - roopa)" : "offline",
      llm_engine:       nvidiaClient ? "DeepSeek (NVIDIA NIM) + Cognitive Fallback" : "Cognitive Heuristic Engine",
      active_chat_sessions: sessionManager.sessions.size,
      active_call_sessions: callSessions.size,
      database_summary: summary,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/customers ──────────────────────────────────────────────────────
app.get("/api/customers", (_req, res) => {
  try {
    const db = readDB();
    res.json({ customers: db });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/chat — Upgraded Multi-Turn Chat (Phase 2, Requirement 3) ───────
/**
 * Request:
 * {
 *   "message":      "User's input text",
 *   "customerName": "Raju",             [optional]
 *   "dueAmount":    6000,               [optional]
 *   "sessionId":    "session-101",      [optional, defaults to 'default-session']
 *   "audio":        true,               [optional, default true unless explicitly false]
 *   "tts":          true                [optional, synonym for audio]
 * }
 *
 * Response:
 * {
 *   "reply":       "...",
 *   "emotion":     "persuasive" | "empathetic" | "polite" | "reassuring" | "firm",
 *   "audio":       "<base64_string>" | null,
 *   "audioFormat": "wav" | null,
 *   "sessionId":   "session-101",
 *   "timestamp":   "2026-11-13T..."
 * }
 */
app.post("/api/chat", async (req, res) => {
  const {
    message,
    customerName  = "গ্রাহক",
    dueAmount     = 0,
    sessionId     = "default-session",
    audio,
    tts,
  } = req.body;

  if (!message || typeof message !== "string" || !message.trim()) {
    return res.status(400).json({
      error: "Missing or invalid 'message' in request body.",
      expected: { message: "<string>", sessionId: "<string (optional)>" },
    });
  }

  // Audio generation defaults to true unless explicitly passed as false
  const shouldGenerateAudio = (audio === false || tts === false) ? false : true;

  try {
    const context = {
      customerName,
      dueAmount: Number(dueAmount) || 0,
      shopName: "মায়ের আশীর্বাদ স্টোর",
      items: "সিমেন্ট, রড ও বিল্ডিং ম্যাটেরিয়ালস",
    };

    const session = getOrCreateChatSession(sessionId, context);
    sessionManager.addMessage(sessionId, "user", message.trim());

    // Generate response with emotion tag
    console.time(`⏱️ [/api/chat] Latency (${sessionId})`);
    const { reply, emotion } = await generateMiliResponse(session.chat_history, context, message.trim());
    console.timeEnd(`⏱️ [/api/chat] Latency (${sessionId})`);

    // Store in history
    sessionManager.addMessage(sessionId, "assistant", reply);

    // Generate Sarvam AI TTS audio
    let audioBase64 = null;
    let audioFormat = null;
    if (shouldGenerateAudio) {
      console.log(`🔊 [/api/chat] Generating Sarvam TTS for: "${reply.slice(0, 50)}..."`);
      const ttsResult = await generateSpeech(reply);
      audioBase64 = ttsResult.audio;
      audioFormat = ttsResult.audioFormat;
    }

    res.json({
      reply,
      emotion,
      audio: audioBase64,
      audioFormat,
      sessionId,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error("❌ [/api/chat] Handler error:", err.message);
    res.status(500).json({
      error: "Error processing chat message",
      details: err.message,
    });
  }
});

// ── POST /api/call/start — Initiate Outbound Call (Phase 2, Requirement 4) ───
/**
 * Request:
 * {
 *   "customerName": "সুব্রত",
 *   "dueAmount":    1500,
 *   "phone":        "9876543210", [optional]
 *   "audio":        true,         [optional, default true]
 *   "tts":          true          [optional, default true]
 * }
 *
 * Response:
 * {
 *   "callId":       "call_1731478...",
 *   "status":       "connected",
 *   "customerName": "সুব্রত",
 *   "dueAmount":    1500,
 *   "reply":        "নমস্কার সুব্রতবাবু...",
 *   "emotion":      "polite",
 *   "audio":        "<base64_string>",
 *   "audioFormat":  "wav"
 * }
 */
app.post("/api/call/start", async (req, res) => {
  const {
    customerName = "গ্রাহক",
    dueAmount    = 0,
    phone        = "",
    audio,
    tts,
  } = req.body;

  const shouldGenerateAudio = (audio === false || tts === false) ? false : true;
  const callId = `call_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;

  const numDue = Number(dueAmount) || 0;
  const amountWords = convertAmountToBengaliWords(numDue);

  const context = {
    customerName,
    dueAmount: numDue,
    phone,
    shopName: "মায়ের আশীর্বাদ স্টোর",
    items: "বিল্ডিং ম্যাটেরিয়ালস ও সিমেন্ট",
  };

  // Generate opening phone greeting
  const greetingText = `নমস্কার ${customerName}বাবু, আমি মায়ের আশীর্বাদ স্টোর থেকে মিলি বলছি। কেমন আছেন? আপনার স্টোরের বকেয়া ${amountWords}-এর বিষয়ে একটু কথা বলতে ফোন করেছিলাম।`;
  const emotion = "polite";

  // Initialize call session in callSessions Map
  const systemPrompt = buildMiliSystemPrompt(context);
  const callHistory = [
    { role: "system", content: systemPrompt },
    { role: "assistant", content: greetingText },
  ];

  callSessions.set(callId, {
    callId,
    customerName,
    dueAmount: numDue,
    phone,
    history: callHistory,
    startedAt: Date.now(),
  });

  console.log(`📞 [Call Started] CallId: ${callId} | Customer: ${customerName} | Due: ₹${numDue}`);

  // Generate voice audio for call start
  let audioBase64 = null;
  let audioFormat = null;
  if (shouldGenerateAudio) {
    const ttsRes = await generateSpeech(greetingText);
    audioBase64 = ttsRes.audio;
    audioFormat = ttsRes.audioFormat;
  }

  res.json({
    callId,
    status: "connected",
    customerName,
    dueAmount: numDue,
    reply: greetingText,
    emotion,
    audio: audioBase64,
    audioFormat,
  });
});

// ── POST /api/call/respond — Interactive Call Turn (Phase 2, Requirement 4) ──
/**
 * Request:
 * {
 *   "callId":       "call_1731478...", [optional]
 *   "message":      "User's spoken response",
 *   "customerName": "সুব্রত",          [optional fallback]
 *   "dueAmount":    1500,              [optional fallback]
 *   "audio":        true,              [optional, default true]
 *   "tts":          true               [optional, default true]
 * }
 *
 * Response:
 * {
 *   "callId":      "call_...",
 *   "reply":       "...",
 *   "emotion":     "...",
 *   "audio":       "<base64_string>",
 *   "audioFormat": "wav"
 * }
 */
app.post("/api/call/respond", async (req, res) => {
  const {
    callId,
    message,
    customerName = "গ্রাহক",
    dueAmount    = 0,
    audio,
    tts,
  } = req.body;

  if (!message || typeof message !== "string" || !message.trim()) {
    return res.status(400).json({
      error: "Missing or invalid 'message' in request body.",
      expected: { message: "<string>", callId: "<string (optional)>" },
    });
  }

  const shouldGenerateAudio = (audio === false || tts === false) ? false : true;

  // Retrieve active call or create a fallback call context
  let callSession = callId ? callSessions.get(callId) : null;
  let activeCallId = callId;

  if (!callSession) {
    activeCallId = callId || `call_${Date.now()}_fallback`;
    const fallbackContext = {
      customerName,
      dueAmount: Number(dueAmount) || 0,
      shopName: "মায়ের আশীর্বাদ স্টোর",
      items: "বিল্ডিং ম্যাটেরিয়ালস",
    };
    callSession = {
      callId: activeCallId,
      customerName,
      dueAmount: Number(dueAmount) || 0,
      history: [
        { role: "system", content: buildMiliSystemPrompt(fallbackContext) },
      ],
      startedAt: Date.now(),
    };
    callSessions.set(activeCallId, callSession);
  }

  const context = {
    customerName: callSession.customerName || customerName,
    dueAmount: Number(callSession.dueAmount) || Number(dueAmount) || 0,
    shopName: "মায়ের আশীর্বাদ স্টোর",
    items: "বিল্ডিং ম্যাটেরিয়ালস",
  };

  callSession.history.push({ role: "user", content: message.trim() });

  console.time(`⏱️ [/api/call/respond] Latency (${activeCallId})`);
  const { reply, emotion } = await generateMiliResponse(callSession.history, context, message.trim());
  console.timeEnd(`⏱️ [/api/call/respond] Latency (${activeCallId})`);

  callSession.history.push({ role: "assistant", content: reply });

  // Generate voice audio for phone turn
  let audioBase64 = null;
  let audioFormat = null;
  if (shouldGenerateAudio) {
    console.log(`🔊 [/api/call/respond] Generating Sarvam TTS for: "${reply.slice(0, 50)}..."`);
    const ttsRes = await generateSpeech(reply);
    audioBase64 = ttsRes.audio;
    audioFormat = ttsRes.audioFormat;
  }

  res.json({
    callId: activeCallId,
    reply,
    emotion,
    audio: audioBase64,
    audioFormat,
  });
});

// ── POST /api/scan — Overdue Scanner ────────────────────────────────────────
app.post("/api/scan", (_req, res) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const db = readDB();
    const overdue = db.find(c => c.status === "pending" && c.dueDate <= today);

    if (!overdue) {
      return res.json({ found: false, message: "No overdue pending customers found in database." });
    }

    res.json({
      found: true,
      customer: overdue,
      message: `Overdue customer: ${overdue.name}, ₹${overdue.dueAmount} due since ${overdue.dueDate}`,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/session/clear — Clear Session History ─────────────────────────
app.post("/api/session/clear", (req, res) => {
  const { sessionId, callId } = req.body;
  if (sessionId) {
    sessionManager.endSession(sessionId);
  }
  if (callId) {
    callSessions.delete(callId);
  }
  res.json({ success: true, message: "Session / call history cleared." });
});

// ── 404 Catch-All ───────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({
    error: "Route not found",
    path: req.path,
    method: req.method,
    available_endpoints: [
      "GET  /",
      "GET  /api/status",
      "GET  /api/customers",
      "POST /api/chat",
      "POST /api/call/start",
      "POST /api/call/respond",
      "POST /api/scan",
      "POST /api/session/clear",
    ],
  });
});

// ── Global Error Handler ────────────────────────────────────────────────────
app.use((err, _req, res, _next) => {
  console.error("❌ [Server] Unhandled Error:", err.message);
  res.status(500).json({ error: "Internal server error", details: err.message });
});

// ============================================================================
// 6. Server Launch
// ============================================================================
if (require.main === module) {
  app.listen(PORT, () => {
    console.log("=================================================================");
    console.log("   🎙️  Mili AI Voice & Chat Systems Server — ONLINE");
    console.log("=================================================================");
    console.log(`   Port:        ${PORT}`);
    console.log(`   Local URL:   http://localhost:${PORT}`);
    console.log(`   Health:      http://localhost:${PORT}/api/status`);
    console.log(`   Chat:        POST http://localhost:${PORT}/api/chat`);
    console.log(`   Call Start:  POST http://localhost:${PORT}/api/call/start`);
    console.log(`   Call Turn:   POST http://localhost:${PORT}/api/call/respond`);
    console.log("=================================================================");
  });
}

module.exports = app;
