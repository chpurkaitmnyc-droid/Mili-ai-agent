/**
 * ============================================================================
 * "Mili" — Autonomous Proactive Outbound Collection Agent
 * ============================================================================
 *
 * Architecture:
 *   [Cron Scanner] ──► [Mock DB: find overdue]
 *                  ──► [Dynamic Prompt Injection]
 *                  ──► [LLM Greeting Generation] ──► [TTS: outbound_greeting.wav]
 *                  ──► [STT: await customer response]
 *                  ──► [LLM: contextual reply] ──► [TTS: mili_response.wav]
 *                  ──► [Post-Call Analyzer: transcript → structured JSON]
 *                  ──► [DB Update: status, notes, sentiment]
 *
 * This module does NOT modify existing ai-brain-loop.js or
 * streaming-voice-agent.js. It imports their exports and composes them.
 *
 * Usage:
 *   node outbound-agent.js              (starts autonomous scanner loop)
 *   node outbound-agent.js --once       (single scan, process one customer, exit)
 *   node outbound-agent.js --test 2     (force-call customer id=2, skip scanner)
 * ============================================================================
 */

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const OpenAI = require("openai");
const {
  buildOutboundSystemPrompt,
  buildAnalyzerSystemPrompt,
  convertAmountToBengaliWords,
} = require("./mili-prompt");

// ============================================================================
// Configuration
// ============================================================================
const DB_PATH = path.resolve(__dirname, "mock_customers.json");
const SHOP_NAME = "চায়ন স্যারের দোকান";
const SCAN_INTERVAL_MS = 60_000; // 60 seconds

const SARVAM_API_KEY = process.env.SARVAM_API_KEY;
const NVIDIA_API_KEY = process.env.NVIDIA_API_KEY;

if (!SARVAM_API_KEY) {
  console.error("SARVAM_API_KEY missing in .env");
  process.exit(1);
}

const nvidiaClient = NVIDIA_API_KEY
  ? new OpenAI({
      baseURL: "https://integrate.api.nvidia.com/v1",
      apiKey: NVIDIA_API_KEY,
      timeout: 15000,
      maxRetries: 1,
    })
  : null;

const OUTBOUND_DIR = path.resolve(__dirname, "outbound_calls");
if (!fs.existsSync(OUTBOUND_DIR)) {
  fs.mkdirSync(OUTBOUND_DIR, { recursive: true });
}

// ============================================================================
// Step 1: Mock Database CRUD Operations
// ============================================================================

function readDatabase() {
  const raw = fs.readFileSync(DB_PATH, "utf-8");
  return JSON.parse(raw);
}

function writeDatabase(customers) {
  fs.writeFileSync(DB_PATH, JSON.stringify(customers, null, 2), "utf-8");
}

function updateCustomer(customerId, updates) {
  const customers = readDatabase();
  const idx = customers.findIndex((c) => c.id === customerId);
  if (idx === -1) {
    console.error(`Customer ID ${customerId} not found in database.`);
    return null;
  }
  customers[idx] = { ...customers[idx], ...updates };
  writeDatabase(customers);
  console.log(`   [DB] Updated customer #${customerId}: ${JSON.stringify(updates)}`);
  return customers[idx];
}

// ============================================================================
// Step 2: Autonomous Scanner — checkDatabase()
// ============================================================================

/**
 * Scans mock_customers.json for the first overdue customer with status "pending".
 * Marks them as "calling" to prevent duplicate triggers.
 * @returns {object|null} The overdue customer record, or null if none found.
 */
function checkDatabase() {
  const customers = readDatabase();
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  const overdue = customers.find(
    (c) => c.status === "pending" && c.dueDate <= today
  );

  if (!overdue) {
    return null;
  }

  // Mark as "calling" to prevent re-trigger
  updateCustomer(overdue.id, { status: "calling" });
  return { ...overdue, status: "calling" };
}

// ============================================================================
// Step 3: Dynamic Outbound Context Builder
// ============================================================================

/**
 * Converts a customer DB record into the context object expected by
 * buildOutboundSystemPrompt().
 */
function buildCallContext(customer) {
  return {
    shopName: SHOP_NAME,
    customerName: customer.nameBn || customer.name,
    dueAmount: customer.dueAmount,
    items: customer.items || "বিভিন্ন সামগ্রী",
    dueDate: customer.dueDate,
  };
}

// ============================================================================
// Step 4: TTS — Synthesize Bengali text to .wav
// ============================================================================

async function synthesizeSpeech(text, outputPath) {
  const resolvedPath = path.resolve(outputPath);
  console.log(`   [TTS] Synthesizing: "${text.slice(0, 60)}..."`);

  const response = await fetch("https://api.sarvam.ai/text-to-speech", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-subscription-key": SARVAM_API_KEY,
    },
    body: JSON.stringify({
      text: text,
      language_code: "bn-IN",
      speaker: "roopa",
      model: "bulbul:v3",
    }),
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`TTS failed [HTTP ${response.status}]: ${errText}`);
  }

  const data = await response.json();
  const base64Audio = data.audios?.[0];
  if (!base64Audio || base64Audio.trim() === "") {
    throw new Error("TTS returned empty audio payload.");
  }

  const audioBuffer = Buffer.from(base64Audio, "base64");
  await fs.promises.writeFile(resolvedPath, audioBuffer);
  console.log(`   [TTS] Saved ${path.basename(resolvedPath)} (${(audioBuffer.length / 1024).toFixed(1)} KB)`);
  return resolvedPath;
}

// ============================================================================
// Step 4b: LLM Call (Non-Streaming) — for greeting generation & analysis
// ============================================================================

async function callLLM(systemPrompt, userMessage) {
  // Attempt 1: DeepSeek on NVIDIA NIM
  if (nvidiaClient) {
    try {
      const completion = await nvidiaClient.chat.completions.create({
        model: "deepseek-ai/deepseek-v4.1-flash",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userMessage },
        ],
        temperature: 0.6,
        max_tokens: 200,
      });

      let text = completion.choices[0]?.message?.content?.trim() || "";
      text = text.replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/[*_#`]/g, "").trim();
      if (text) return text;
    } catch (err) {
      console.warn(`   [LLM] DeepSeek unavailable (${err.message}). Using fallback.`);
    }
  }

  // Fallback: deterministic Bengali response based on context
  console.log("   [LLM] Using local fallback reasoning engine.");
  return null;
}

// ============================================================================
// Step 4c: Proactive Call Trigger — startOutboundCall(customer)
// ============================================================================

/**
 * Executes the full outbound call flow for a single customer:
 *   1. Generate dynamic greeting via LLM
 *   2. Synthesize greeting to audio (outbound_greeting.wav)
 *   3. Simulate STT listener for customer response
 *   4. Generate contextual LLM reply
 *   5. Synthesize reply to audio (mili_response.wav)
 *   6. Run post-call analyzer
 *   7. Update database
 *
 * @param {object} customer - Customer record from mock_customers.json
 * @returns {Promise<object>} Call result with transcript and analysis
 */
async function startOutboundCall(customer) {
  const callStartTime = Date.now();
  const context = buildCallContext(customer);
  const systemPrompt = buildOutboundSystemPrompt(context);
  const amountWords = convertAmountToBengaliWords(customer.dueAmount);

  const callDir = path.resolve(OUTBOUND_DIR, `call_${customer.id}_${Date.now()}`);
  fs.mkdirSync(callDir, { recursive: true });

  console.log("\n================================================================");
  console.log(`OUTBOUND CALL: ${customer.nameBn || customer.name} (ID: ${customer.id})`);
  console.log(`   Phone: ${customer.phone}`);
  console.log(`   Due: ${amountWords} | Due Date: ${customer.dueDate}`);
  console.log(`   Items: ${customer.items}`);
  console.log("================================================================");

  // ── Phase 1: Generate Proactive Greeting ──────────────────────────
  console.log("\n--- Phase 1: Generating Proactive Greeting ---");
  console.time("   [Metrics] Greeting Generation");

  let greetingText = await callLLM(
    systemPrompt,
    `Generate ONLY the opening greeting for this outbound call. Introduce yourself as Mili calling from ${SHOP_NAME} and mention the pending amount of ${amountWords}. One warm sentence in Bengali.`
  );

  // Fallback greeting if LLM is unavailable
  if (!greetingText) {
    greetingText = `নমস্কার ${context.customerName}, আমি মিলি বলছি ${SHOP_NAME} থেকে। আপনার ${amountWords} বকেয়া আছে, একটু জানাতে চাইছিলাম।`;
  }

  console.log(`   [LLM] Greeting: "${greetingText}"`);
  console.timeEnd("   [Metrics] Greeting Generation");

  // ── Phase 2: TTS — Greeting Audio ─────────────────────────────────
  console.log("\n--- Phase 2: Synthesizing Greeting Audio ---");
  console.time("   [Metrics] Greeting TTS");
  const greetingAudioPath = path.resolve(callDir, "outbound_greeting.wav");
  await synthesizeSpeech(greetingText, greetingAudioPath);
  // Also save a copy in root for easy testing
  await fs.promises.copyFile(greetingAudioPath, path.resolve(__dirname, "outbound_greeting.wav"));
  console.timeEnd("   [Metrics] Greeting TTS");

  console.log("\n   >>> PHONE RINGS... Customer picks up <<<");
  console.log(`   >>> PLAYING: outbound_greeting.wav <<<`);
  console.log(`   >>> Mili: "${greetingText}" <<<`);

  // ── Phase 3: STT — Await Customer Response ────────────────────────
  console.log("\n--- Phase 3: Listening for Customer Response (STT) ---");

  let customerTranscript = "";
  const customerAudioPath = resolveCustomerAudio();

  if (customerAudioPath) {
    console.log(`   [STT] Processing customer audio: ${path.basename(customerAudioPath)}`);
    try {
      const { listen } = require("./streaming-voice-agent");
      customerTranscript = await listen(customerAudioPath);
    } catch (sttErr) {
      console.warn(`   [STT] Error: ${sttErr.message}`);
    }
  }

  if (!customerTranscript) {
    // Simulate customer response for local testing
    customerTranscript = "হ্যাঁ দাদা, আমি জানি। আগামী সোমবারের মধ্যে টাকাটা দিয়ে দেব।";
    console.log(`   [STT] No audio file found. Using simulated customer response.`);
    console.log(`   [STT] Simulated: "${customerTranscript}"`);
  }

  // ── Phase 4: LLM — Contextual Reply ───────────────────────────────
  console.log("\n--- Phase 4: Generating Contextual Reply ---");
  console.time("   [Metrics] Reply Generation");

  let replyText = await callLLM(systemPrompt, customerTranscript);

  if (!replyText) {
    replyText = `ঠিক আছে ${context.customerName}, সোমবারের মধ্যে দিয়ে দেবেন। ধন্যবাদ আপনাকে।`;
  }

  console.log(`   [LLM] Mili's Reply: "${replyText}"`);
  console.timeEnd("   [Metrics] Reply Generation");

  // ── Phase 5: TTS — Reply Audio ────────────────────────────────────
  console.log("\n--- Phase 5: Synthesizing Reply Audio ---");
  console.time("   [Metrics] Reply TTS");
  const replyAudioPath = path.resolve(callDir, "mili_response.wav");
  await synthesizeSpeech(replyText, replyAudioPath);
  await fs.promises.copyFile(replyAudioPath, path.resolve(__dirname, "mili_response.wav"));
  console.timeEnd("   [Metrics] Reply TTS");

  console.log(`   >>> PLAYING: mili_response.wav <<<`);
  console.log(`   >>> Mili: "${replyText}" <<<`);

  // ── Build Full Transcript ─────────────────────────────────────────
  const fullTranscript = [
    `Mili: ${greetingText}`,
    `Customer: ${customerTranscript}`,
    `Mili: ${replyText}`,
  ].join("\n");

  // Save transcript to call directory
  await fs.promises.writeFile(
    path.resolve(callDir, "transcript.txt"),
    fullTranscript,
    "utf-8"
  );

  // ── Phase 6: Post-Call Analyzer ───────────────────────────────────
  console.log("\n--- Phase 6: Post-Call Analysis ---");
  const analysis = await analyzeCallOutcome(fullTranscript, customer);

  const callDuration = ((Date.now() - callStartTime) / 1000).toFixed(1);

  // ── Summary ───────────────────────────────────────────────────────
  console.log("\n================================================================");
  console.log("CALL COMPLETED");
  console.log("================================================================");
  console.log(`   Customer: ${customer.nameBn} (${customer.name}) | ID: ${customer.id}`);
  console.log(`   Duration: ${callDuration}s`);
  console.log(`   Greeting Audio: ${greetingAudioPath}`);
  console.log(`   Reply Audio: ${replyAudioPath}`);
  console.log(`   Transcript: ${path.resolve(callDir, "transcript.txt")}`);
  console.log(`   Analysis: ${JSON.stringify(analysis, null, 2)}`);
  console.log("================================================================\n");

  return {
    customerId: customer.id,
    callDir,
    transcript: fullTranscript,
    analysis,
    durationSeconds: parseFloat(callDuration),
  };
}

/**
 * Resolves the customer audio input file for STT.
 * Checks CLI arg, then well-known filenames in the project root.
 */
function resolveCustomerAudio() {
  // CLI: node outbound-agent.js --audio customer_reply.ogg
  const audioFlagIdx = process.argv.indexOf("--audio");
  if (audioFlagIdx !== -1 && process.argv[audioFlagIdx + 1]) {
    const p = path.resolve(process.argv[audioFlagIdx + 1]);
    if (fs.existsSync(p)) return p;
  }
  const candidates = [
    path.resolve(__dirname, "customer_uploaded.ogg"),
    path.resolve(__dirname, "customer_input.wav"),
    path.resolve(__dirname, "customer_input.ogg"),
  ];
  for (const c of candidates) {
    if (fs.existsSync(c)) return c;
  }
  return null;
}

// ============================================================================
// Step 5: Post-Call Analyzer — analyzeCallOutcome(transcript)
// ============================================================================

/**
 * Silent secondary LLM call to extract structured intent from the call transcript.
 * Writes the extracted data back into mock_customers.json.
 *
 * @param {string} transcript - Full call transcript text.
 * @param {object} customer - The customer record being processed.
 * @returns {Promise<object>} Parsed analysis JSON.
 */
async function analyzeCallOutcome(transcript, customer) {
  console.log("   [Analyzer] Running silent post-call intent extraction...");
  const analyzerPrompt = buildAnalyzerSystemPrompt();

  let analysisJson = null;

  const rawAnalysis = await callLLM(analyzerPrompt, transcript);

  if (rawAnalysis) {
    try {
      // Strip any accidental markdown code fences
      const cleaned = rawAnalysis
        .replace(/```json\s*/gi, "")
        .replace(/```\s*/gi, "")
        .trim();
      analysisJson = JSON.parse(cleaned);
      console.log("   [Analyzer] LLM Analysis Parsed Successfully.");
    } catch (parseErr) {
      console.warn(`   [Analyzer] JSON parse failed: ${parseErr.message}`);
      console.warn(`   [Analyzer] Raw response: "${rawAnalysis}"`);
    }
  }

  // Fallback: heuristic analysis from transcript keywords
  if (!analysisJson) {
    console.log("   [Analyzer] Using heuristic fallback analysis.");
    analysisJson = heuristicAnalysis(transcript);
  }

  // ── Write analysis back to database ───────────────────────────────
  const today = new Date().toISOString().slice(0, 10);
  const dbUpdates = {
    status: analysisJson.updatedStatus || "needs_followup",
    callAttempts: (customer.callAttempts || 0) + 1,
    lastCallDate: today,
    callNotes: analysisJson.summary || "Call completed, no summary available.",
  };

  // Add promised date if extracted
  if (analysisJson.promisedDate) {
    dbUpdates.promisedPaymentDate = analysisJson.promisedDate;
  }

  updateCustomer(customer.id, dbUpdates);
  console.log(`   [Analyzer] Database updated for customer #${customer.id}.`);

  // Save analysis JSON to call directory
  return analysisJson;
}

/**
 * Keyword-based fallback when LLM is unavailable for analysis.
 */
function heuristicAnalysis(transcript) {
  const lower = transcript.toLowerCase();
  const bengali = transcript;

  let sentiment = "neutral";
  let updatedStatus = "needs_followup";
  let promisedDate = null;
  let summary = "Call completed. Follow-up may be needed.";

  // Positive indicators
  if (
    bengali.includes("দিয়ে দেব") ||
    bengali.includes("দেব") ||
    bengali.includes("দিচ্ছি") ||
    bengali.includes("ঠিক আছে")
  ) {
    sentiment = "positive";
    updatedStatus = "promised_to_pay";
    summary = "Customer agreed to pay.";
  }

  // Date extraction: "সোমবার" (Monday)
  if (bengali.includes("সোমবার")) {
    const nextMonday = getNextDayOfWeek(1);
    promisedDate = nextMonday;
    summary += ` Promised by ${nextMonday} (Monday).`;
  }
  if (bengali.includes("আগামীকাল")) {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    promisedDate = tomorrow.toISOString().slice(0, 10);
    summary += ` Promised by tomorrow (${promisedDate}).`;
  }
  if (bengali.includes("পরশু")) {
    const dayAfter = new Date();
    dayAfter.setDate(dayAfter.getDate() + 2);
    promisedDate = dayAfter.toISOString().slice(0, 10);
    summary += ` Promised by day after tomorrow (${promisedDate}).`;
  }

  // Negative indicators
  if (
    bengali.includes("দেব না") ||
    bengali.includes("পারব না") ||
    bengali.includes("সম্ভব না") ||
    lower.includes("refuse")
  ) {
    sentiment = "negative";
    updatedStatus = "refused";
    summary = "Customer refused to pay.";
    promisedDate = null;
  }

  // Already paid
  if (bengali.includes("দিয়ে দিয়েছি") || bengali.includes("মিটিয়ে দিয়েছি")) {
    sentiment = "positive";
    updatedStatus = "cleared";
    summary = "Customer claims payment already made.";
  }

  return { sentiment, promisedDate, updatedStatus, summary };
}

function getNextDayOfWeek(dayOfWeek) {
  const today = new Date();
  const diff = (dayOfWeek - today.getDay() + 7) % 7 || 7;
  const next = new Date(today);
  next.setDate(today.getDate() + diff);
  return next.toISOString().slice(0, 10);
}

// ============================================================================
// Autonomous Scanner Loop (The Cron)
// ============================================================================

let scannerRunning = false;

async function scanAndCall() {
  if (scannerRunning) {
    console.log("[Scanner] Previous call still in progress. Skipping this scan.");
    return;
  }

  const now = new Date().toLocaleTimeString("en-IN", { hour12: true });
  console.log(`\n[Scanner] ${now} — Checking database for overdue customers...`);

  const customer = checkDatabase();

  if (!customer) {
    console.log("[Scanner] No overdue pending customers found. Waiting for next scan...");
    return;
  }

  console.log(`[Scanner] OVERDUE FOUND: ${customer.nameBn} (ID: ${customer.id}), Due: ${customer.dueDate}`);

  scannerRunning = true;
  try {
    await startOutboundCall(customer);
  } catch (err) {
    console.error(`[Scanner] Call failed for customer #${customer.id}:`, err.message);
    // Revert status back to pending so it can be retried
    updateCustomer(customer.id, { status: "pending" });
  } finally {
    scannerRunning = false;
  }
}

// ============================================================================
// CLI Entry Point
// ============================================================================

async function main() {
  console.log("================================================================");
  console.log("   Mili — Autonomous Proactive Outbound Collection Agent");
  console.log(`   Shop: ${SHOP_NAME}`);
  console.log(`   Database: ${DB_PATH}`);
  console.log(`   LLM: DeepSeek v4.1-flash on NVIDIA NIM`);
  console.log(`   TTS: Sarvam AI bulbul:v3 (bn-IN, roopa)`);
  console.log("================================================================\n");

  const args = process.argv.slice(2);

  // Mode: --test <id> — force-call a specific customer
  if (args.includes("--test")) {
    const testId = parseInt(args[args.indexOf("--test") + 1], 10);
    if (isNaN(testId)) {
      console.error("Usage: node outbound-agent.js --test <customer_id>");
      process.exit(1);
    }
    const customers = readDatabase();
    const customer = customers.find((c) => c.id === testId);
    if (!customer) {
      console.error(`Customer ID ${testId} not found.`);
      process.exit(1);
    }
    console.log(`[Test Mode] Force-calling customer #${testId}: ${customer.nameBn}`);
    updateCustomer(testId, { status: "calling" });
    await startOutboundCall(customer);
    return;
  }

  // Mode: --once — single scan, process one, exit
  if (args.includes("--once")) {
    console.log("[Mode: Single Scan]");
    await scanAndCall();
    console.log("[Done] Single scan completed. Exiting.");
    return;
  }

  // Mode: default — continuous autonomous scanner
  console.log(`[Mode: Autonomous Loop] Scanning every ${SCAN_INTERVAL_MS / 1000} seconds.`);
  console.log("[Press Ctrl+C to stop]\n");

  // Initial scan immediately
  await scanAndCall();

  // Recurring scans
  const intervalId = setInterval(async () => {
    await scanAndCall();
  }, SCAN_INTERVAL_MS);

  // Graceful shutdown
  process.on("SIGINT", () => {
    console.log("\n[Scanner] Shutting down gracefully...");
    clearInterval(intervalId);
    process.exit(0);
  });
}

module.exports = {
  readDatabase,
  writeDatabase,
  updateCustomer,
  checkDatabase,
  buildCallContext,
  startOutboundCall,
  analyzeCallOutcome,
  synthesizeSpeech,
  callLLM,
  scanAndCall,
};

if (require.main === module) {
  main().catch((err) => {
    console.error("Fatal:", err);
    process.exit(1);
  });
}
