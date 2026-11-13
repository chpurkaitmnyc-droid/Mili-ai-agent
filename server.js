/**
 * ============================================================================
 * server.js — Mili AI Autonomous Agentic Backend & REST API
 * ============================================================================
 * Production-ready backend for "Mili" (মিলি), an autonomous agentic AI system
 * built exclusively for Kirana stores, grocery wholesalers, and retail merchants
 * to solve credit/khata management, billing tracking, invoicing analysis, and
 * overdue payment recovery (বাকি আদায়).
 *
 * Integrated Services:
 *   - Scope Gatekeeper (services/scopeGuard.js)
 *   - Excel Automation Engine (services/excelService.js)
 *   - Dynamic MCP Client Manager (services/mcpManager.js)
 *   - Autonomous Follow-up Engine (services/automationEngine.js)
 *   - Persistent Daily Cron Scheduler (services/schedulerService.js)
 *   - Agentic ReAct Tool-Calling Loop (services/agentTools.js)
 *   - Reusable Sarvam AI TTS (ttsService.js)
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
const { buildMiliSystemPrompt, convertAmountToBengaliWords } = require("./mili-prompt");
const { SessionManager } = require("./session-manager");

// Services
const excelService = require("./services/excelService");
const { mcpManager } = require("./services/mcpManager");
const automationEngine = require("./services/automationEngine");
const { schedulerService } = require("./services/schedulerService");
const { validateScope } = require("./services/scopeGuard");
const { runAgenticLoop } = require("./services/agentTools");

const app  = express();
const PORT = process.env.PORT || 3000;

// ============================================================================
// 1. CORS & Middleware
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

// Multi-turn chat session manager
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
// 3. Cognitive Brain & Reasoning Engine (for Calls & Standalone Chat)
// ============================================================================

function analyzeAndGenerateHeuristic(userMessage, context = {}) {
  const customerName = context.customerName || "গ্রাহক";
  const dueAmount = Number(context.dueAmount) || 0;
  const amountWords = convertAmountToBengaliWords(dueAmount);
  const msg = (userMessage || "").toLowerCase();

  // 1. Refusal to pay
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

  // 2. Disputes / Discounts
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

  // 3. Promises to pay
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

  // 4. Busy
  if (
    msg.includes("busy") ||
    msg.includes("ব্যস্ত") ||
    msg.includes("পরে") ||
    msg.includes("গাড়ি") ||
    msg.includes("মিটিং")
  ) {
    return {
      reply: `আচ্ছা ঠিক আছে ${customerName}বাবু, আপনি এখন কাজে ব্যস্ত আছেন বুঝতে পারছি। কখন ফোন করলে আপনার কথা বলতে সুবিধা হবে একটু জানিয়ে দিন?`,
      emotion: "polite",
    };
  }

  // 5. Greeting
  if (
    msg.includes("নমস্কার") ||
    msg.includes("হ্যালো") ||
    msg.includes("hi") ||
    msg.includes("hello")
  ) {
    return {
      reply: `নমস্কার ${customerName}বাবু! আমি মায়ের আশীর্বাদ স্টোর থেকে মিলি বলছি। আপনার বকেয়া ${amountWords}-এর হিসাব সংক্রান্ত বিষয়ে কথা বলতে ফোন করেছি।`,
      emotion: "polite",
    };
  }

  return {
    reply: `${customerName}বাবু, আমি আপনার কথা বুঝতে পারলাম। আমাদের বিল্ডিং ম্যাটেরিয়ালসের বকেয়া ${amountWords} পরিশোধের বিষয়ে আপনি কীভাবে এগোতে চাইছেন একটু জানালে ভালো হতো।`,
    emotion: "empathetic",
  };
}

async function generateMiliResponse(messages, context, userMessage) {
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
        },
        { signal: ctrl.signal }
      );
      clearTimeout(timer);
      const rawText = completion.choices[0]?.message?.content || "";
      if (rawText) {
        try {
          const parsed = JSON.parse(rawText.replace(/```json/gi, "").replace(/```/gi, "").trim());
          if (parsed && parsed.reply) {
            return {
              reply: cleanTextForTTS(parsed.reply),
              emotion: parsed.emotion || "empathetic",
            };
          }
        } catch (_e) {
          const textOnly = cleanTextForTTS(rawText);
          if (textOnly && textOnly.length > 5) {
            return { reply: textOnly, emotion: "empathetic" };
          }
        }
      }
    } catch (err) {
      clearTimeout(timer);
      console.warn(`⚠️ [LLM] DeepSeek call issue (${err.message}). Using cognitive fallback.`);
    }
  }

  return analyzeAndGenerateHeuristic(userMessage, context);
}

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
// 4. REST Endpoints
// ============================================================================

// ── GET / — System Health & Endpoint Catalogue ──────────────────────────────
app.get("/", (_req, res) => {
  res.json({
    service:   "Mili (মিলি) Autonomous Agentic AI System for Kirana & Retail Stores",
    niche:     "Billing Tracking, Khata Management, Overdue Payment Recovery (বাকি আদায়)",
    status:    "online",
    version:   "4.0.0",
    timestamp: new Date().toISOString(),
    endpoints: {
      chat:           "POST /api/chat (Autonomous agentic tool-calling loop + Sarvam TTS)",
      callStart:      "POST /api/call/start (Initiate phone call with voice)",
      callRespond:    "POST /api/call/respond (Ongoing phone call turn)",
      excelCustomers: "GET  /api/excel/customers (Customer ledger breakdown)",
      excelFollowup:  "POST /api/excel/run-followup (Autonomous follow-up trigger)",
      excelDownload:  "GET  /api/excel/download (Direct .xlsx ledger download)",
      mcpServers:     "GET  /api/mcp/servers (Connected MCP server status & tools)",
      mcpConnect:     "POST /api/mcp/connect (Connect external MCP server)",
      mcpDisconnect:  "POST /api/mcp/disconnect (Disconnect an MCP server)",
      schedulerStatus:"GET  /api/scheduler/status (Daily cron scheduler status)",
      schedulerSet:   "POST /api/scheduler/set (Configure daily automated recovery)",
      systemStatus:   "GET  /api/status (Provider & store health stats)",
      mockCustomers:  "GET  /api/customers (Legacy customer JSON list)",
      legacyScan:     "POST /api/scan (Legacy scan trigger)",
      clearSession:   "POST /api/session/clear (Clear session memory)",
    },
  });
});

// ── GET /api/status ──────────────────────────────────────────────────────────
app.get("/api/status", (_req, res) => {
  try {
    const db = readDB();
    res.json({
      status:               "online",
      agent_name:           "Mili (মিলি)",
      niche:                "Kirana, Retail, Grocery Wholesale Credit Recovery & Billing",
      tts_engine:           process.env.SARVAM_API_KEY ? "Sarvam AI (bulbul:v3 - roopa)" : "offline",
      llm_engine:           nvidiaClient ? "DeepSeek (NVIDIA NIM) + Cognitive Agent Loop" : "Cognitive Heuristic Engine",
      active_chat_sessions: sessionManager.sessions.size,
      active_call_sessions: callSessions.size,
      scheduler:            schedulerService.getStatus(),
      mcp_tools_active:     mcpManager.getAllTools().length,
      connected_mcp_servers:mcpManager.getServersStatus().filter((s) => s.connected).length,
      mock_db_customers:    db.length,
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

// ── POST /api/chat — Upgraded Agentic Tool-Calling Loop (Phase 4) ───────────
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

  const shouldGenerateAudio = (audio === false || tts === false) ? false : true;

  try {
    const context = {
      customerName,
      dueAmount: Number(dueAmount) || 0,
      shopName: "মায়ের আশীর্বাদ স্টোর",
      items: "মুদি, চাল, ডাল ও কনস্ট্রাকশন সামগ্রী",
    };

    const session = getOrCreateChatSession(sessionId, context);

    // ──────────────────────────────────────────────────────────────────────────
    // Step 0: Mandatory Scope Gatekeeper Check (Phase 4, Step 0)
    // ──────────────────────────────────────────────────────────────────────────
    const scopeCheck = await validateScope(message.trim(), session.chat_history);
    if (!scopeCheck.allowed) {
      console.log(`🛡️ [POST /api/chat] Gatekeeper blocked out-of-scope query for session: ${sessionId}`);
      const rejectReply = scopeCheck.reply;

      let rejectAudio = null;
      let rejectFormat = null;
      if (shouldGenerateAudio) {
        const audioRes = await generateSpeech(rejectReply);
        rejectAudio = audioRes.audio;
        rejectFormat = audioRes.audioFormat;
      }

      return res.json({
        reply: rejectReply,
        emotion: "firm",
        toolsUsed: [],
        outOfScope: true,
        audio: rejectAudio,
        audioFormat: rejectFormat,
        sessionId,
        timestamp: new Date().toISOString(),
      });
    }

    // Add user message to session memory
    sessionManager.addMessage(sessionId, "user", message.trim());

    // ──────────────────────────────────────────────────────────────────────────
    // Step 1: Agentic ReAct Tool-Calling Loop (Phase 4, Step 2 & 3)
    // ──────────────────────────────────────────────────────────────────────────
    console.time(`⏱️ [/api/chat] Agentic Loop (${sessionId})`);

    const agentResult = await runAgenticLoop(
      message.trim(),
      session.chat_history,
      context,
      async (workingMessages) => {
        if (!nvidiaClient) return null;
        const comp = await nvidiaClient.chat.completions.create({
          model: "deepseek-ai/deepseek-v4.1-flash",
          messages: workingMessages,
          temperature: 0.4,
          max_tokens: 250,
        });
        return comp.choices[0]?.message?.content || "";
      }
    );

    console.timeEnd(`⏱️ [/api/chat] Agentic Loop (${sessionId})`);

    const reply = agentResult.reply;
    const emotion = agentResult.emotion || "empathetic";
    const toolsUsed = agentResult.toolsUsed || [];

    // Save Mili's answer to session memory
    sessionManager.addMessage(sessionId, "assistant", reply);

    // ──────────────────────────────────────────────────────────────────────────
    // Step 2: Sarvam AI Voice Synthesis
    // ──────────────────────────────────────────────────────────────────────────
    let audioBase64 = null;
    let audioFormat = null;
    if (shouldGenerateAudio) {
      console.log(`🔊 [/api/chat] Generating Sarvam TTS for reply (${reply.length} chars)...`);
      const ttsResult = await generateSpeech(reply);
      audioBase64 = ttsResult.audio;
      audioFormat = ttsResult.audioFormat;
    }

    res.json({
      reply,
      emotion,
      toolsUsed,
      outOfScope: false,
      audio: audioBase64,
      audioFormat,
      sessionId,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    console.error("❌ [/api/chat] Handler Error:", err.message);
    res.status(500).json({
      error: "Error processing chat query",
      details: err.message,
    });
  }
});

// ── POST /api/call/start — Outbound Call Initiation ─────────────────────────
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
    items: "দোকানের বাকি ও বাকির হিসাব",
  };

  const greetingText = `নমস্কার ${customerName}বাবু, আমি মায়ের আশীর্বাদ স্টোর থেকে মিলি বলছি। কেমন আছেন? আপনার স্টোরের বকেয়া ${amountWords}-এর বিষয়ে একটু কথা বলতে ফোন করেছিলাম।`;
  const emotion = "polite";

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

// ── POST /api/call/respond — Interactive Ongoing Call Turn ──────────────────
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

  let callSession = callId ? callSessions.get(callId) : null;
  let activeCallId = callId;

  if (!callSession) {
    activeCallId = callId || `call_${Date.now()}_fallback`;
    const fallbackContext = {
      customerName,
      dueAmount: Number(dueAmount) || 0,
      shopName: "মায়ের আশীর্বাদ স্টোর",
      items: "দোকানের বাকি হিসাব",
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
    items: "দোকানের বাকি হিসাব",
  };

  callSession.history.push({ role: "user", content: message.trim() });

  console.time(`⏱️ [/api/call/respond] Latency (${activeCallId})`);
  const { reply, emotion } = await generateMiliResponse(callSession.history, context, message.trim());
  console.timeEnd(`⏱️ [/api/call/respond] Latency (${activeCallId})`);

  callSession.history.push({ role: "assistant", content: reply });

  let audioBase64 = null;
  let audioFormat = null;
  if (shouldGenerateAudio) {
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

// ============================================================================
// 5. PHASE 5: NEW API ROUTES
// ============================================================================

// ── GET /api/excel/customers — Analyzed Customer Rows & Stats ───────────────
app.get("/api/excel/customers", async (_req, res) => {
  try {
    const analysis = await excelService.analyzeCustomers();
    res.json({
      success: true,
      totalCustomers: analysis.totalCustomers,
      overdueCount: analysis.overdueCount,
      totalOverdueAmount: analysis.totalOverdueAmount,
      totalOverdueAmountWords: convertAmountToBengaliWords(analysis.totalOverdueAmount),
      overdueCustomers: analysis.overdueCustomers,
      allCustomers: analysis.allCustomers,
    });
  } catch (err) {
    console.error("❌ [/api/excel/customers] Error:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── POST /api/excel/run-followup — Manual Overdue Follow-up Trigger ──────────
app.post("/api/excel/run-followup", async (req, res) => {
  try {
    const dryRun = Boolean(req.body.dryRun);
    const summary = await automationEngine.runOverdueFollowupWorkflow({ dryRun });
    res.json({
      success: true,
      summary,
    });
  } catch (err) {
    console.error("❌ [/api/excel/run-followup] Error:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── GET /api/excel/download — Direct Download of customers.xlsx ─────────────
app.get("/api/excel/download", async (_req, res) => {
  try {
    await excelService.ensureCustomersExcel();
    if (!fs.existsSync(excelService.CUSTOMERS_FILE)) {
      return res.status(404).json({ error: "customers.xlsx not found" });
    }
    res.download(excelService.CUSTOMERS_FILE, "customers.xlsx");
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /api/mcp/servers — List Configured MCP Servers & Tools ──────────────
app.get("/api/mcp/servers", (_req, res) => {
  try {
    const servers = mcpManager.getServersStatus();
    const allTools = mcpManager.getAllTools();
    res.json({
      success: true,
      serversCount: servers.length,
      connectedCount: servers.filter((s) => s.connected).length,
      toolsCount: allTools.length,
      servers,
      tools: allTools,
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── POST /api/mcp/connect — Connect External MCP Server ──────────────────────
app.post("/api/mcp/connect", async (req, res) => {
  const { name, command, args, env, url } = req.body;
  if (!name || (!command && !url)) {
    return res.status(400).json({
      error: "Missing parameters. Required: { name, command (for stdio) OR url (for SSE) }",
    });
  }

  try {
    const result = await mcpManager.connectServer(name, { command, args, env, url });
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── POST /api/mcp/disconnect — Disconnect MCP Server ────────────────────────
app.post("/api/mcp/disconnect", async (req, res) => {
  const { name } = req.body;
  if (!name) return res.status(400).json({ error: "Missing 'name' in request body." });

  try {
    const result = await mcpManager.disconnectServer(name);
    res.json(result);
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── GET /api/scheduler/status — Daily Cron Scheduler Status & Logs ──────────
app.get("/api/scheduler/status", (_req, res) => {
  try {
    const status = schedulerService.getStatus();
    let logs = [];
    if (fs.existsSync(automationEngine.LOGS_FILE)) {
      logs = JSON.parse(fs.readFileSync(automationEngine.LOGS_FILE, "utf-8") || "[]");
    }
    res.json({
      success: true,
      scheduler: status,
      recentLogsCount: logs.length,
      recentLogs: logs.slice(0, 5),
    });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── POST /api/scheduler/set — Configure Daily Cron Schedule ─────────────────
app.post("/api/scheduler/set", (req, res) => {
  const { hour, minute, enabled = true } = req.body;
  if (hour === undefined || minute === undefined) {
    return res.status(400).json({
      error: "Missing parameters. Required: { hour (0-23), minute (0-59), enabled (optional boolean) }",
    });
  }

  try {
    const updatedConfig = schedulerService.setDailySchedule(hour, minute, enabled);
    res.json({
      success: true,
      scheduler: updatedConfig,
      message: `Daily Kirana follow-up schedule set to ${updatedConfig.timeLabel} (${updatedConfig.cronExpression}) [Active: ${updatedConfig.enabled}]`,
    });
  } catch (err) {
    res.status(400).json({ success: false, error: err.message });
  }
});

// ── POST /api/scan — Legacy Database Scanner ────────────────────────────────
app.post("/api/scan", (_req, res) => {
  try {
    const today = new Date().toISOString().slice(0, 10);
    const db = readDB();
    const overdue = db.find((c) => c.status === "pending" && c.dueDate <= today);

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
  if (sessionId) sessionManager.endSession(sessionId);
  if (callId) callSessions.delete(callId);
  res.json({ success: true, message: "Session / call history cleared." });
});

// ── 404 Catch-All ───────────────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({
    error: "Route not found",
    path: req.path,
    method: req.method,
  });
});

// ── Global Error Handler ────────────────────────────────────────────────────
app.use((err, _req, res, _next) => {
  console.error("❌ [Server] Unhandled Error:", err.message);
  res.status(500).json({ error: "Internal server error", details: err.message });
});

// ============================================================================
// 6. Server Launch & Background Task Initializer
// ============================================================================
if (require.main === module) {
  app.listen(PORT, async () => {
    console.log("=================================================================");
    console.log("   🎙️  Mili AI Autonomous Agentic Backend Server — ONLINE");
    console.log("=================================================================");
    console.log(`   Port:            ${PORT}`);
    console.log(`   Local URL:       http://localhost:${PORT}`);
    console.log(`   Health:          http://localhost:${PORT}/api/status`);
    console.log(`   Agent Chat:      POST http://localhost:${PORT}/api/chat`);
    console.log(`   Call Start:      POST http://localhost:${PORT}/api/call/start`);
    console.log(`   Excel Customers: GET  http://localhost:${PORT}/api/excel/customers`);
    console.log(`   Scheduler:       GET  http://localhost:${PORT}/api/scheduler/status`);
    console.log("=================================================================");

    // Auto-seed and check Excel
    await excelService.ensureCustomersExcel();

    // Auto-restore persisted scheduler
    schedulerService.initOnBoot();

    // Auto-connect persisted MCP servers in background
    mcpManager.autoConnectPersisted().catch((e) => {
      console.warn("⚠️ [Server] MCP auto-connect:", e.message);
    });
  });
}

module.exports = app;
