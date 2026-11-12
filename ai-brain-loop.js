/**
 * ============================================================================
 * Project: "Mili" - Automated Kirana Debt Collection Voice Agent
 * Architecture:
 *   [Autonomous Outbound Scanner] ──► [Mock DB: Overdue Check]
 *   [Proactive Call Trigger]      ──► [TTS: outbound_greeting.wav]
 *   [Customer Response]           ──► [STT (Sarvam saaras:v3)]
 *   [Contextual Negotiation]      ──► [LLM (DeepSeek on NVIDIA NIM)]
 *   [Agent Voice Reply]           ──► [TTS: mili_response.wav]
 *   [Post-Call Intent Extraction] ──► [Silent DeepSeek LLM Analysis]
 *   [Database Update]             ──► [mock_customers.json]
 * ============================================================================
 */

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const OpenAI = require("openai");
const { SarvamAIClient } = require("sarvamai");
const {
  PromptGenerator,
  buildSystemPrompt,
  buildOutboundSystemPrompt,
  buildAnalyzerSystemPrompt,
  convertAmountToBengaliWords,
} = require("./mili-prompt");
const { SessionManager } = require("./session-manager");
const { LLMStreamer } = require("./llm-streamer");

// ============================================================================
// 1. Dynamic Customer and Kirana Store Context
// ============================================================================
const currentContext = {
  shopName: "মায়ের আশীর্বাদ স্টোর",
  customerName: "সুব্রত",
  dueAmount: 1500,
  items: "মুদি ও নিত্যপ্রয়োজনীয় জিনিস",
};

const DB_PATH = path.resolve(__dirname, "mock_customers.json");
const AGENT_AUDIO_OUTPUT = path.resolve(__dirname, "mili_response.wav");
const GREETING_AUDIO_OUTPUT = path.resolve(__dirname, "outbound_greeting.wav");

// Input audio resolution: CLI arg -> customer_uploaded.ogg -> customer_input.wav -> customer_input.ogg
function resolveInputAudioPath() {
  if (process.argv[2] && fs.existsSync(process.argv[2])) {
    return path.resolve(process.argv[2]);
  }
  const candidates = [
    path.resolve(__dirname, "customer_uploaded.ogg"),
    path.resolve(__dirname, "customer_input.wav"),
    path.resolve(__dirname, "customer_input.ogg"),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return candidates[0];
}

// Environment API Keys
const sarvamApiKey = process.env.SARVAM_API_KEY;
const nvidiaApiKey = process.env.NVIDIA_API_KEY;
const geminiApiKey = process.env.GEMINI_API_KEY;

if (!sarvamApiKey) {
  console.error("❌ SARVAM_API_KEY is missing in your .env file.");
  process.exit(1);
}

// Sarvam AI Client for STT
const sarvamClient = new SarvamAIClient({
  apiSubscriptionKey: sarvamApiKey,
});

// NVIDIA NIM Client for DeepSeek LLM
const nvidiaClient = nvidiaApiKey
  ? new OpenAI({
      baseURL: "https://integrate.api.nvidia.com/v1",
      apiKey: nvidiaApiKey,
      timeout: 10000,
      maxRetries: 1,
    })
  : null;

/**
 * Resilient DeepSeek caller with a strict timeout to prevent API hangs.
 */
async function callDeepSeekWithTimeout(createOptions, timeoutMs = 5000) {
  if (!nvidiaClient) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await nvidiaClient.chat.completions.create(createOptions, {
      signal: controller.signal,
    });
    clearTimeout(timer);
    return res;
  } catch (err) {
    clearTimeout(timer);
    throw err;
  }
}

// ============================================================================
// Step 1: Mock JSON Database Operations (mock_customers.json)
// ============================================================================
function readDatabase() {
  if (!fs.existsSync(DB_PATH)) {
    throw new Error(`Database file not found at ${DB_PATH}`);
  }
  const raw = fs.readFileSync(DB_PATH, "utf-8");
  return JSON.parse(raw);
}

function writeDatabase(data) {
  fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2), "utf-8");
}

function updateCustomer(customerId, updates) {
  const customers = readDatabase();
  const index = customers.findIndex((c) => c.id === customerId);
  if (index === -1) {
    console.warn(`⚠️ Customer with ID ${customerId} not found in database.`);
    return null;
  }
  customers[index] = { ...customers[index], ...updates };
  writeDatabase(customers);
  console.log(`💾 [DB] Customer #${customerId} updated in mock_customers.json:`, updates);
  return customers[index];
}

// ============================================================================
// Step 2: Autonomous Scanner (The Cron Loop) — checkDatabase()
// ============================================================================
/**
 * Scans mock_customers.json for overdue pending customers.
 * Marks the customer as "calling" immediately to prevent duplicate simultaneous calls.
 * @returns {object|null} Customer record if found, or null.
 */
function checkDatabase() {
  const customers = readDatabase();
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD

  // Find the first customer where dueDate is passed (<= today) and status === 'pending'
  const overdueCustomer = customers.find(
    (c) => c.status === "pending" && c.dueDate <= today
  );

  if (!overdueCustomer) {
    return null;
  }

  // Prevent multiple calls to the same person by temporarily marking as "calling"
  console.log(`\n🔍 [Scanner] Found overdue customer: ${overdueCustomer.name} (ID: ${overdueCustomer.id})`);
  console.log(`   Due Date: ${overdueCustomer.dueDate} | Due Amount: ₹${overdueCustomer.dueAmount}`);
  updateCustomer(overdueCustomer.id, { status: "calling" });

  return { ...overdueCustomer, status: "calling" };
}

// ============================================================================
// 2. STT (Speech-to-Text) - listen()
// ============================================================================
/**
 * Transcribes Bengali audio input from the customer using Sarvam AI STT.
 * @param {string} audioFilePath - Path to customer audio file (.ogg or .wav).
 * @returns {Promise<string>} - Transcribed Bengali text.
 */
async function listen(audioFilePath) {
  const resolvedPath = path.resolve(audioFilePath);
  console.log(`\n🎤 [STT] Listening to customer audio: ${resolvedPath}...`);

  if (!fs.existsSync(resolvedPath)) {
    throw new Error(
      `Audio file "${path.basename(resolvedPath)}" not found in root directory!\n` +
      `👉 Please place your recorded Bengali audio in the project root.`
    );
  }

  try {
    const response = await sarvamClient.speechToText.transcribe({
      file: fs.createReadStream(resolvedPath),
      language_code: "bn-IN",
      model: "saaras:v3",
    });

    const transcript = response.transcript ? response.transcript.trim() : "";
    if (!transcript) {
      throw new Error("STT returned an empty transcript.");
    }

    console.log(`🎤 [STT] Customer Said: "${transcript}"`);
    return transcript;
  } catch (sdkError) {
    console.warn(`⚠️ SDK STT call encountered an issue (${sdkError.message}). Trying REST fallback...`);
    return await listenRESTFallback(resolvedPath);
  }
}

/**
 * Fallback STT via direct REST API call.
 */
async function listenRESTFallback(audioFilePath) {
  const fileBuffer = await fs.promises.readFile(audioFilePath);
  const ext = path.extname(audioFilePath).toLowerCase();
  const mimeType = ext === ".ogg" ? "audio/ogg" : "audio/wav";

  const formData = new FormData();
  formData.append("file", new Blob([fileBuffer], { type: mimeType }), path.basename(audioFilePath));
  formData.append("language_code", "bn-IN");
  formData.append("model", "saaras:v3");

  const response = await fetch("https://api.sarvam.ai/speech-to-text", {
    method: "POST",
    headers: {
      "api-subscription-key": sarvamApiKey,
    },
    body: formData,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`REST STT failed [HTTP ${response.status}]: ${errorText}`);
  }

  const data = await response.json();
  const transcript = data.transcript ? data.transcript.trim() : "";
  if (!transcript) {
    throw new Error("REST STT returned empty transcript.");
  }

  console.log(`🎤 [STT REST] Customer Said: "${transcript}"`);
  return transcript;
}

// ============================================================================
// 3. LLM (Reasoning & Conversation) - think()
// ============================================================================
/**
 * Processes transcribed Bengali text with dynamic Kirana store context using DeepSeek on NVIDIA NIM.
 * Uses the Master System Prompt for persona, tone, and guardrails.
 * @param {string} transcribedText - Customer's transcribed Bengali statement.
 * @param {object} context - Store, customer, and debt information.
 * @returns {Promise<string>} - Voice-optimized Bengali response (1-2 short spoken sentences).
 */
async function think(transcribedText, context) {
  console.log("\n🧠 [LLM] Reasoning via DeepSeek (NVIDIA NIM)...");

  // Step 3: Dynamic System Prompt Injection
  const systemPrompt = context.isOutbound
    ? buildOutboundSystemPrompt(context)
    : buildSystemPrompt(context);

  const messages = [
    { role: "system", content: systemPrompt },
    { role: "user", content: transcribedText },
  ];

  if (nvidiaClient) {
    try {
      const completion = await callDeepSeekWithTimeout({
        model: "deepseek-ai/deepseek-v4.1-flash",
        messages,
        temperature: 0.6,
        max_tokens: 150,
      }, 5000);

      let replyText = completion?.choices[0]?.message?.content?.trim() || "";
      replyText = replyText.replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/[*_#`"]/g, "").trim();
      if (replyText) {
        console.log(`🧠 [LLM DeepSeek] Mili's Response: "${replyText}"`);
        return replyText;
      }
    } catch (deepseekError) {
      console.warn(`⚠️ DeepSeek call failed (${deepseekError.message}).`);
    }
  }

  // Fallback to Gemini if configured
  if (geminiApiKey && !geminiApiKey.includes("your_gemini_api_key")) {
    console.log("🔄 Falling back to Google Gemini...");
    const { GoogleGenAI } = require("@google/genai");
    const ai = new GoogleGenAI({ apiKey: geminiApiKey });
    const response = await ai.models.generateContent({
      model: "gemini-2.5-flash",
      contents: `${systemPrompt}\n\nCustomer: ${transcribedText}`,
    });
    let replyText = response.text ? response.text.trim() : "";
    replyText = replyText.replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/[*_#`"]/g, "").trim();
    console.log(`🧠 [LLM Gemini] Mili's Response: "${replyText}"`);
    return replyText;
  }

  // Local fallback engine (ensures call completes reliably)
  console.log("🔄 Using Dynamic Bengali Reasoning Engine fallback...");
  const amountWords = convertAmountToBengaliWords(context.dueAmount);
  return `সুব্রতবাবু, আপনার পরিস্থিতি বুঝতে পারছি। তবে আমাদের দোকানের ${amountWords} দ্রুত মিটিয়ে দিলে খুব উপকার হয়।`;
}

// ============================================================================
// 4. TTS (Text-to-Speech) - speak()
// ============================================================================
/**
 * Synthesizes Bengali text to audio speech using Sarvam AI with strict verification and error handling.
 * @param {string} llmResponseText - Text to be spoken in Bengali.
 * @param {string} [outputPath] - Destination absolute or relative path for output .wav file.
 * @returns {Promise<{ filePath: string, fileSize: number, bufferLength: number }>}
 */
async function speak(llmResponseText, outputPath = AGENT_AUDIO_OUTPUT) {
  const absoluteFilePath = path.resolve(outputPath);

  console.log("\n================================================================");
  console.log("🔊 [TTS] Initiating Text-to-Speech Synthesis...");
  console.log(`📝 [TTS] Target Text: "${llmResponseText}"`);
  console.log(`📍 [TTS] Destination Absolute Path: ${absoluteFilePath}`);

  if (!sarvamApiKey || sarvamApiKey.trim() === "") {
    throw new Error("❌ SARVAM_API_KEY is missing or empty.");
  }

  // 1. Dispatch REST API call
  const response = await fetch("https://api.sarvam.ai/text-to-speech", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-subscription-key": sarvamApiKey,
    },
    body: JSON.stringify({
      text: llmResponseText,
      language_code: "bn-IN",
      speaker: "roopa",
      model: "bulbul:v3",
    }),
  });

  console.log(`📡 [TTS] HTTP Status Code Received: ${response.status} ${response.statusText}`);

  if (!response.ok) {
    const errorBody = await response.text();
    let parsedMessage = errorBody;
    try {
      const errorJson = JSON.parse(errorBody);
      parsedMessage = errorJson.error?.message || errorJson.message || errorBody;
    } catch (_) {}
    throw new Error(`❌ Sarvam AI TTS API Failed [HTTP ${response.status}]: ${parsedMessage}`);
  }

  const responseData = await response.json();
  if (
    !responseData ||
    !responseData.audios ||
    !Array.isArray(responseData.audios) ||
    responseData.audios.length === 0
  ) {
    throw new Error(
      `❌ Sarvam AI returned HTTP 200, but 'audios' array is missing or empty! Response: ${JSON.stringify(responseData)}`
    );
  }

  const base64Audio = responseData.audios[0];
  if (typeof base64Audio !== "string" || base64Audio.trim() === "") {
    throw new Error("❌ Received invalid or empty Base64 string from Sarvam AI audio payload.");
  }

  const audioBuffer = Buffer.from(base64Audio, "base64");
  if (!audioBuffer || audioBuffer.length === 0) {
    throw new Error("❌ Base64 decode resulted in a 0-byte Buffer.");
  }

  const parentDir = path.dirname(absoluteFilePath);
  if (!fs.existsSync(parentDir)) {
    await fs.promises.mkdir(parentDir, { recursive: true });
  }

  await fs.promises.writeFile(absoluteFilePath, audioBuffer);

  if (!fs.existsSync(absoluteFilePath)) {
    throw new Error(`❌ Critical Verification Failure: File write completed but "${absoluteFilePath}" was NOT found on disk!`);
  }

  const fileStats = await fs.promises.stat(absoluteFilePath);
  console.log("✅ [TTS] Audio file successfully written and verified on disk!");
  console.log(`📁 [TTS] Verified File Path: ${absoluteFilePath}`);
  console.log(`📊 [TTS] Verified File Size: ${fileStats.size} bytes (${(fileStats.size / 1024).toFixed(2)} KB)`);
  console.log("================================================================");

  return {
    filePath: absoluteFilePath,
    fileSize: fileStats.size,
    bufferLength: audioBuffer.length,
  };
}

// ============================================================================
// Step 4: Proactive Call Trigger (Reverse Pipeline Start)
// ============================================================================
/**
 * Initiates a proactive outbound call:
 *   1. Generates dynamic greeting via LLM (Mili speaks first)
 *   2. Synthesizes greeting audio (outbound_greeting.wav)
 *   3. ONLY THEN activates the STT listener to await customer response
 *   4. Generates contextual reply via LLM & synthesizes mili_response.wav
 *   5. Calls Step 5 (Post-Call Analyzer) to extract intent & update database
 *
 * @param {object} customer - Customer object from mock_customers.json
 * @param {string} [inputAudioPath] - Optional override customer audio file for local testing
 * @returns {Promise<object>} Complete call record with transcript and analysis
 */
async function startOutboundCall(customer, inputAudioPath = null) {
  const shopName = currentContext.shopName;
  const customerName = customer.name;
  const dueAmount = customer.dueAmount;
  const amountWords = convertAmountToBengaliWords(dueAmount);

  console.log("\n================================================================");
  console.log(`📞 [Outbound Call Trigger] Initiating call to: ${customerName} (${customer.phone})`);
  console.log(`💰 Due Amount: ₹${dueAmount} (${amountWords}) | Due Date: ${customer.dueDate}`);
  console.log("================================================================");

  // 1. Dynamic Greeting Generation
  console.log("\n🗣️ [Step 4A] Generating Proactive Opening Greeting via LLM...");
  const greetingPrompt = `You are Mili, calling on behalf of ${shopName}. You are calling ${customerName} about a pending due of ${dueAmount} rupees. Politely greet them in one short, warm Bengali sentence introducing yourself and mentioning the due amount. Output ONLY plain Bengali text.`;

  let greetingText = "";
  if (nvidiaClient) {
    try {
      const greetingRes = await callDeepSeekWithTimeout({
        model: "deepseek-ai/deepseek-v4.1-flash",
        messages: [{ role: "system", content: greetingPrompt }],
        max_tokens: 80,
        temperature: 0.5,
      }, 5000);
      greetingText = greetingRes?.choices[0]?.message?.content?.trim() || "";
      greetingText = greetingText.replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/[*_#`"]/g, "").trim();
    } catch (e) {
      console.warn(`⚠️ DeepSeek greeting generation fallback (${e.message})`);
    }
  }

  if (!greetingText) {
    greetingText = `নমস্কার ${customerName} বাবু, আমি ${shopName} থেকে মিলি বলছি, আপনার ${amountWords} বকেয়া রয়েছে সেই বিষয়ে একটু কথা বলতে ফোন করেছি।`;
  }

  console.log(`🤖 [Mili Greeting]: "${greetingText}"`);

  // 2. Synthesize Proactive Greeting Audio FIRST (Reverse Pipeline Start)
  console.log("\n🔊 [Step 4B] Synthesizing outbound_greeting.wav before listening...");
  const greetingTtsResult = await speak(greetingText, GREETING_AUDIO_OUTPUT);
  console.log(`🎧 Outbound Greeting Audio Ready: ${greetingTtsResult.filePath}`);
  console.log(`📞 >>> PHONE RINGS... Customer picks up >>>`);
  console.log(`🔊 >>> PLAYING GREETING: "${greetingText}" >>>`);

  // 3. ONLY THEN activate STT Listener for customer's response
  console.log("\n🎤 [Step 4C] Customer is speaking... Activating STT listener...");
  const customerAudio = inputAudioPath || resolveInputAudioPath();
  const customerTranscript = await listen(customerAudio);

  // 4. Generate Contextual Follow-up Reply via LLM
  console.log("\n🧠 [Step 4D] Generating contextual negotiation reply...");
  const callContext = {
    shopName,
    customerName,
    dueAmount,
    items: "বকেয়া বিল",
    isOutbound: true,
  };
  const agentReply = await think(customerTranscript, callContext);

  // 5. Synthesize Agent Reply to Audio
  console.log("\n🔊 [Step 4E] Synthesizing follow-up agent audio: mili_response.wav...");
  const replyTtsResult = await speak(agentReply, AGENT_AUDIO_OUTPUT);

  // 6. Assemble Full Call Transcript
  const fullTranscript = `Agent: ${greetingText}\nCustomer: ${customerTranscript}\nAgent: ${agentReply}`;

  console.log("\n================================================================");
  console.log("📝 Complete Call Transcript:");
  console.log(fullTranscript);
  console.log("================================================================");

  // 7. Step 5: Post-Call Analyzer & Database Updater
  const analysisResult = await analyzeCallOutcome(fullTranscript, customer);

  return {
    customer,
    greeting: greetingText,
    customerTranscript,
    agentReply,
    fullTranscript,
    analysis: analysisResult,
  };
}

// ============================================================================
// Step 5: Post-Call Analyzer & Database Updater — analyzeCallOutcome()
// ============================================================================
/**
 * Initiates a completely silent, secondary API call to DeepSeek to analyze
 * the call transcript and update mock_customers.json.
 *
 * @param {string} transcript - Full text of the call conversation.
 * @param {object} customer - Customer record from database.
 * @returns {Promise<object>} Extracted structured analysis JSON.
 */
async function analyzeCallOutcome(transcript, customer) {
  console.log("\n🔍 [Step 5] Post-Call Analyzer — Initiating Silent Secondary LLM Call...");

  const analyzerSystemPrompt = buildAnalyzerSystemPrompt();

  const messages = [
    { role: "system", content: analyzerSystemPrompt },
    { role: "user", content: `Call Transcript:\n${transcript}` },
  ];

  let rawJsonOutput = "";

  if (nvidiaClient) {
    try {
      const completion = await callDeepSeekWithTimeout({
        model: "deepseek-ai/deepseek-v4.1-flash",
        messages,
        temperature: 0.1, // Low temperature for deterministic JSON output
        max_tokens: 150,
      }, 5000);
      rawJsonOutput = completion?.choices[0]?.message?.content?.trim() || "";
    } catch (err) {
      console.warn(`⚠️ DeepSeek analyzer call failed (${err.message}). Using fallback analyzer.`);
    }
  }

  // Clean and parse JSON
  let parsedAnalysis = null;
  if (rawJsonOutput) {
    try {
      const sanitized = rawJsonOutput
        .replace(/```json\s*/gi, "")
        .replace(/```\s*/gi, "")
        .trim();
      parsedAnalysis = JSON.parse(sanitized);
    } catch (e) {
      console.warn("⚠️ Failed to parse raw LLM JSON, falling back to heuristic parsing:", e.message);
    }
  }

  // Fallback heuristic extraction if API is offline
  if (!parsedAnalysis) {
    parsedAnalysis = heuristicCallAnalysis(transcript);
  }

  console.log("📊 [Analyzer] Extracted Structured JSON:", JSON.stringify(parsedAnalysis, null, 2));

  // Write extracted data back into mock_customers.json
  const updatedCustomer = updateCustomer(customer.id, {
    status: parsedAnalysis.updatedStatus || "promised_to_pay",
    callNotes: `[Sentiment: ${parsedAnalysis.sentiment}] ${parsedAnalysis.summary}${
      parsedAnalysis.promisedDate ? ` (Promised: ${parsedAnalysis.promisedDate})` : ""
    }`,
  });

  return parsedAnalysis;
}

/**
 * Heuristic fallback parser for intent extraction.
 */
function heuristicCallAnalysis(transcript) {
  const text = transcript.toLowerCase();
  let sentiment = "neutral";
  let updatedStatus = "promised_to_pay";
  let promisedDate = null;
  let summary = "Customer discussed pending dues.";

  if (transcript.includes("কয়েক মাস") || transcript.includes("সময় লাগবে")) {
    sentiment = "neutral";
    updatedStatus = "promised_to_pay";
    summary = "Customer requested additional time; negotiated for upcoming week payment.";
    const d = new Date();
    d.setDate(d.getDate() + 7);
    promisedDate = d.toISOString().slice(0, 10);
  } else if (transcript.includes("দেবো না") || transcript.includes("পারবো না")) {
    sentiment = "negative";
    updatedStatus = "refused";
    summary = "Customer refused payment.";
  } else if (transcript.includes("দিয়ে দিয়েছি") || transcript.includes("ক্লিয়ার")) {
    sentiment = "positive";
    updatedStatus = "cleared";
    summary = "Customer confirmed payment already cleared.";
  }

  return { sentiment, promisedDate, updatedStatus, summary };
}

// ============================================================================
// Step 2 (Cron Loop): Autonomous Scanner
// ============================================================================
let isScanning = false;

async function scanAndExecuteTurn() {
  if (isScanning) {
    console.log("⏳ [Scanner] Previous call still in progress. Skipping cycle.");
    return;
  }

  isScanning = true;
  try {
    const overdueCustomer = checkDatabase();
    if (overdueCustomer) {
      await startOutboundCall(overdueCustomer);
    } else {
      console.log(`⏰ [Scanner ${new Date().toLocaleTimeString()}] No overdue pending customers found in mock_customers.json.`);
    }
  } catch (err) {
    console.error("❌ [Scanner Error]:", err.message);
  } finally {
    isScanning = false;
  }
}

/**
 * Starts continuous autonomous scanner every intervalMs (default: 60s).
 */
function startAutonomousScanner(intervalMs = 60000) {
  console.log("================================================================");
  console.log(`🤖 Starting Autonomous Outbound Scanner (Interval: ${intervalMs / 1000}s)`);
  console.log("Press Ctrl+C to stop.");
  console.log("================================================================");

  // Run initial scan immediately
  scanAndExecuteTurn();

  // Schedule recurring scan
  const timer = setInterval(() => {
    scanAndExecuteTurn();
  }, intervalMs);

  process.on("SIGINT", () => {
    console.log("\n🛑 Stopping autonomous scanner...");
    clearInterval(timer);
    process.exit(0);
  });
}

// ============================================================================
// 6. Inbound Single Turn Execution (Original Behavior Preserved)
// ============================================================================
async function runInboundLoop() {
  const inputAudio = resolveInputAudioPath();

  console.log("================================================================");
  console.log("🤖 'Mili' Voice Agent - Single Inbound Conversational Turn");
  console.log(`🏪 Store: ${currentContext.shopName} | 👤 Customer: ${currentContext.customerName}`);
  console.log(`💰 Due: ₹${currentContext.dueAmount} for ${currentContext.items}`);
  console.log(`🎧 Input Audio Source: ${path.basename(inputAudio)}`);
  console.log("================================================================");

  try {
    const transcribedText = await listen(inputAudio);
    const llmReply = await think(transcribedText, currentContext);
    const ttsResult = await speak(llmReply, AGENT_AUDIO_OUTPUT);

    console.log("\n================================================================");
    console.log("✅ Inbound Turn Completed Successfully!");
    console.log(`🎧 Output Audio File: ${ttsResult.filePath}`);
    console.log(`📁 Audio File Size: ${(ttsResult.fileSize / 1024).toFixed(2)} KB`);
    console.log("================================================================");
  } catch (error) {
    console.error("\n❌ Conversational Loop Error:", error.message);
  }
}

// ============================================================================
// 7. Main Entry Point
// ============================================================================
async function main() {
  const args = process.argv.slice(2);

  if (args.includes("--inbound")) {
    // Run original inbound loop
    await runInboundLoop();
  } else if (args.includes("--scan") || args.includes("--cron")) {
    // Run continuous 60s autonomous scanner
    startAutonomousScanner(60000);
  } else {
    // Default: Run single autonomous outbound cycle (scan database, call first overdue customer, analyze & update DB)
    console.log("🚀 Running Single Outbound Autonomous Turn...");
    await scanAndExecuteTurn();
  }
}

module.exports = {
  SessionManager,
  LLMStreamer,
  PromptGenerator,
  currentContext,
  readDatabase,
  writeDatabase,
  updateCustomer,
  checkDatabase,
  listen,
  think,
  speak,
  startOutboundCall,
  analyzeCallOutcome,
  startAutonomousScanner,
  runInboundLoop,
  main,
};

if (require.main === module) {
  main();
}
