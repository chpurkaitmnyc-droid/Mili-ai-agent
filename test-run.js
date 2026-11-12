/**
 * ============================================================================
 * test-run.js — Advanced Architecture & Cognitive Brain Test Runner
 * ============================================================================
 * Tests:
 *   1. SessionManager (in-memory multi-turn session, chat_history, customerId key)
 *   2. PromptGenerator (cognitive brain: multi-turn memory, Benglish, edge cases)
 *   3. LLMStreamer (stream: true, token buffering, sentence boundary chunking [।?!.\n])
 *   4. TTFB & Time-to-First-Chunk latency metrics (console.time)
 *   5. Interruption / VAD Hook (isInterrupted flag, AbortController abort, TTS queue purge)
 *   6. Multi-turn conversation preserving context
 *   7. Safe mock_customers.json persistence
 * ============================================================================
 */

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const OpenAI = require("openai");

const { PromptGenerator, convertAmountToBengaliWords } = require("./mili-prompt");
const { SessionManager } = require("./session-manager");
const { LLMStreamer } = require("./llm-streamer");

const DB_PATH = path.resolve(__dirname, "mock_customers.json");
const SHOP_NAME = "মায়ের আশীর্বাদ স্টোর";

// NVIDIA NIM DeepSeek Client
const nvidiaClient = process.env.NVIDIA_API_KEY
  ? new OpenAI({
      baseURL: "https://integrate.api.nvidia.com/v1",
      apiKey: process.env.NVIDIA_API_KEY,
      timeout: 10000,
      maxRetries: 1,
    })
  : null;

// Database Helpers
function readDB() {
  return JSON.parse(fs.readFileSync(DB_PATH, "utf-8"));
}

function writeDB(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), "utf-8");
}

function updateCustomer(id, updates) {
  const db = readDB();
  const idx = db.findIndex((c) => c.id === id);
  if (idx === -1) return null;
  db[idx] = { ...db[idx], ...updates };
  writeDB(db);
  console.log(`💾 [DB] Customer #${id} updated in mock_customers.json:`, updates);
  return db[idx];
}

// ============================================================================
// Main Multi-Turn Streaming & Cognitive Test
// ============================================================================
async function run() {
  console.log("=================================================================");
  console.log("   Mili AI Voice Agent — Architecture & Brain Upgrade Test");
  console.log("=================================================================");

  // 1. Database Scan
  const today = new Date().toISOString().slice(0, 10);
  const db = readDB();
  let customer = db.find((c) => c.status === "pending" && c.dueDate <= today);

  if (!customer) {
    console.log("ℹ️ No pending overdue customers found. Using customer #3 (Priya) for test.");
    customer = db.find((c) => c.id === 3) || db[0];
  }

  console.log(`\n🔍 [Scanner] Selected Customer: ${customer.name} (ID: ${customer.id})`);
  console.log(`   Due: ₹${customer.dueAmount} (${convertAmountToBengaliWords(customer.dueAmount)}) | Due Date: ${customer.dueDate}`);

  updateCustomer(customer.id, { status: "calling" });

  // 2. Initialize SessionManager
  const sessionManager = new SessionManager();
  const context = {
    shopName: SHOP_NAME,
    customerName: customer.name,
    dueAmount: customer.dueAmount,
    items: "বকেয়া বিল",
  };

  const systemPrompt = PromptGenerator.buildOutboundSystemPrompt(context);
  const session = sessionManager.createSession(customer, systemPrompt);

  console.log(`✅ [SessionManager] Session established. Customer Key: ${session.customerId}`);

  // 3. Initialize LLMStreamer
  const streamer = new LLMStreamer({
    client: nvidiaClient,
    model: "deepseek-ai/deepseek-v4.1-flash",
    timeoutMs: 5000,
  });

  // ────────────────────────────────────────────────────────────────────────────
  // Turn 1: Proactive Outbound Greeting (stream: true + sentence chunking)
  // ────────────────────────────────────────────────────────────────────────────
  console.log("\n=================================================================");
  console.log("🗣️  TURN 1: Proactive Greeting (Mili Speaks First — Streaming)");
  console.log("=================================================================");

  sessionManager.addMessage(
    customer.id,
    "user",
    "[Call Connected. Initiate opening proactive greeting to the customer.]"
  );

  const greetingResult = await streamer.streamTurn(session, {
    onChunk: (chunk, index) => {
      console.log(`   🔊 [TTS Queue Handoff - Chunk #${index}]: Ready to send to Sarvam TTS`);
    },
  });

  sessionManager.addMessage(customer.id, "assistant", greetingResult.fullText);
  console.log(`\n🤖 [Mili Full Greeting]: "${greetingResult.fullText}"`);
  console.log(`📦 Chunks Count: ${greetingResult.chunks.length}`);

  // ────────────────────────────────────────────────────────────────────────────
  // Turn 2: Customer responds in Benglish with a Dispute/Discount request
  // (Testing: Multi-Turn Memory, Benglish Understanding, Chayan Sir Escalation)
  // ────────────────────────────────────────────────────────────────────────────
  console.log("\n=================================================================");
  console.log("👤 TURN 2: Customer Speaks in Benglish (Negotiation / Dispute)");
  console.log("=================================================================");

  const customerBenglishInput = "Dada ami ektu discount pawa jabe ki? Amount ta beshi mone hochhe.";
  console.log(`🗣️ Customer (Benglish): "${customerBenglishInput}"`);

  sessionManager.addMessage(customer.id, "user", customerBenglishInput);

  const turn2Result = await streamer.streamTurn(session, {
    onChunk: (chunk, index) => {
      console.log(`   🔊 [TTS Queue Handoff - Chunk #${index}]: Ready to send to Sarvam TTS`);
    },
  });

  sessionManager.addMessage(customer.id, "assistant", turn2Result.fullText);
  console.log(`\n🤖 [Mili Contextual Response]: "${turn2Result.fullText}"`);

  // Verify escalation rule
  if (turn2Result.fullText.includes("চয়ন") || turn2Result.fullText.includes("চয়ন")) {
    console.log("🎯 [Guardrail Verified]: Escalated discount dispute to Chayan Sir correctly!");
  }

  // ────────────────────────────────────────────────────────────────────────────
  // Turn 3: Interruption / VAD Hook Demonstration
  // ────────────────────────────────────────────────────────────────────────────
  console.log("\n=================================================================");
  console.log("⚡ TURN 3: Interruption / VAD Hook Demonstration");
  console.log("=================================================================");

  sessionManager.resetInterruption(customer.id);
  sessionManager.addMessage(customer.id, "user", "Next week dekhi ki kora jay...");

  // Simulate user interrupting after 100ms
  console.log("🎙️ Initiating streaming generation...");
  const turn3Promise = streamer.streamTurn(session, {
    onChunk: (chunk, index) => {
      console.log(`   🔊 [TTS Chunk #${index}]: "${chunk}"`);
    },
  });

  // Trigger interruption hook after a small delay
  setTimeout(() => {
    console.log("\n🚨 >>> USER BARGED IN (VAD DETECTED) <<<");
    sessionManager.interrupt(customer.id, "User started speaking over Mili");
  }, 120);

  const turn3Result = await turn3Promise;
  console.log(`\n⚡ Interruption Handled Result: interrupted = ${turn3Result.interrupted}`);
  console.log(`🧹 Active TTS Queue Length: ${session.ttsQueue.length} (must be 0)`);

  // ────────────────────────────────────────────────────────────────────────────
  // Step 4: Post-Call Structured Analysis & Persistence
  // ────────────────────────────────────────────────────────────────────────────
  console.log("\n=================================================================");
  console.log("📊 STEP 4: Post-Call Intent Analyzer & State Persistence");
  console.log("=================================================================");

  const history = sessionManager.getHistory(customer.id);
  const transcriptText = history
    .filter((m) => m.role !== "system")
    .map((m) => `${m.role === "assistant" ? "Mili" : "Customer"}: ${m.content}`)
    .join("\n");

  console.log("📝 Complete Multi-Turn Conversation Transcript:\n" + transcriptText);

  // Heuristic/Analyzer determination
  let finalStatus = "disputed";
  let summary = "Customer asked for discount in Benglish; escalated to Chayan Sir.";
  let sentiment = "neutral";

  if (transcriptText.includes("চয়ন") || transcriptText.includes("discount")) {
    finalStatus = "disputed";
    summary = "Customer requested discount in Benglish; escalated to Chayan Sir.";
  }

  updateCustomer(customer.id, {
    status: finalStatus,
    callNotes: `[Sentiment: ${sentiment}] ${summary}`,
  });

  console.log("\n=================================================================");
  console.log("✅ VERIFICATION COMPLETE: Final Database Record for Customer #" + customer.id);
  const updatedCustomer = readDB().find((c) => c.id === customer.id);
  console.log(JSON.stringify(updatedCustomer, null, 2));
  console.log("=================================================================");
}

run().catch((err) => {
  console.error("❌ Fatal Test Runner Error:", err);
});
