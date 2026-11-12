/**
 * ============================================================================
 * Production-Grade LLM-to-TTS Pipeline
 * Architecture: [LLM Text Output] -> [Type Checking & Sanitization] -> [TTS API] -> [Buffer -> Disk]
 * ============================================================================
 */

require("dotenv").config();
const fs = require("fs");
const path = require("path");
const OpenAI = require("openai");

const TARGET_OUTPUT_FILE = "C:\\Users\\CHAYAN PURKAIT\\Desktop\\AI agent\\mili_response.wav";

// ============================================================================
// 1. Client Initializations
// ============================================================================
const nvidiaApiKey = process.env.NVIDIA_API_KEY;
const sarvamApiKey = process.env.SARVAM_API_KEY;

if (!sarvamApiKey) {
  console.error("❌ Fatal: SARVAM_API_KEY is not defined in .env");
  process.exit(1);
}

const nvidiaClient = nvidiaApiKey
  ? new OpenAI({
      baseURL: "https://integrate.api.nvidia.com/v1",
      apiKey: nvidiaApiKey,
      timeout: 60000,
      maxRetries: 2,
    })
  : null;

// ============================================================================
// 2. Strict LLM Generation & Output Extraction
// ============================================================================
/**
 * Calls DeepSeek on NVIDIA NIM and returns strictly verified string text.
 * @param {string} customerStatement - Transcribed customer speech.
 * @param {object} context - Store and customer details.
 * @returns {Promise<string>} - Extracted plain text string.
 */
async function generateLLMResponse(customerStatement, context) {
  console.log("\n================================================================");
  console.log("🧠 [LLM Pipeline] Requesting response from DeepSeek (NVIDIA NIM)...");
  console.log(`👤 Customer: ${context.customerName} | Store: ${context.shopName} | Due: ₹${context.dueAmount}`);
  console.log(`💬 Customer Said: "${customerStatement}"`);

  if (!nvidiaClient) {
    throw new Error("❌ NVIDIA_API_KEY is not configured in .env");
  }

  const systemPrompt = `You are Mili, a polite but firm digital collection assistant calling on behalf of ${context.shopName}. The customer's name is ${context.customerName} and they owe ${context.dueAmount} INR for ${context.items}. The customer just said: '${customerStatement}'. If the customer refuses to pay or asks for months of delay, remain calm, polite, and respectful, but firmly remind them of their debt and the long-standing trust with the local store, asking them not to spoil the relationship and clear the amount soon. Keep your response in natural, conversational Bengali, under 2 short sentences, suitable for a phone call. Output ONLY the spoken Bengali text without markdown, commentary, or quotes.`;

  // Strict Await on LLM API
  const completion = await nvidiaClient.chat.completions.create({
    model: "deepseek-ai/deepseek-v4.1-flash",
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: customerStatement },
    ],
    temperature: 0.6,
    max_tokens: 150,
  });

  // Requirement 1: Data Extraction & Type Checking
  if (!completion || !completion.choices || completion.choices.length === 0) {
    throw new Error("❌ LLM API returned an empty completion or no choices.");
  }

  const rawMessage = completion.choices[0]?.message?.content;

  // Type Checking
  console.log("🔍 [Type Check] Raw LLM Output typeof:", typeof rawMessage);
  console.log("📝 [Type Check] Raw LLM Output value:", JSON.stringify(rawMessage));

  if (typeof rawMessage !== "string") {
    throw new TypeError(
      `❌ Type Error: Expected LLM output to be 'string', but received '${typeof rawMessage}'`
    );
  }

  // Strip potential <think>...</think> reasoning blocks and extraneous quotes
  let cleanedText = rawMessage.replace(/<think>[\s\S]*?<\/think>/gi, "").trim();
  cleanedText = cleanedText.replace(/^["']|["']$/g, "").trim();

  if (cleanedText.length === 0) {
    throw new Error("❌ LLM output string is empty after sanitization.");
  }

  console.log("✅ [Type Check] Cleaned plain text extracted successfully:");
  console.log(`   Length: ${cleanedText.length} characters`);
  console.log(`   Value: "${cleanedText}"`);

  return cleanedText;
}

// ============================================================================
// 3. Strict TTS API Execution & Binary File Processing
// ============================================================================
/**
 * Converts verified string into speech via Sarvam AI and saves to disk synchronously.
 * @param {string} text - Strictly verified plain text string.
 * @param {string} destinationPath - Absolute destination path.
 * @returns {Promise<{ filePath: string, fileSize: number, bufferLength: number }>}
 */
async function convertTextToSpeech(text, destinationPath = TARGET_OUTPUT_FILE) {
  console.log("\n================================================================");
  console.log("🔊 [TTS Pipeline] Initiating Sarvam AI Text-to-Speech...");

  // Requirement 1 & 3: Type and parameter validation
  if (typeof text !== "string" || text.trim() === "") {
    throw new TypeError(`❌ TTS Validation Error: 'text' parameter must be a non-empty string. Received: ${typeof text}`);
  }

  const absolutePath = path.resolve(destinationPath);
  console.log(`📍 Destination File Path: ${absolutePath}`);

  // Payload specification adhering strictly to Sarvam AI v3 contract
  const ttsPayload = {
    text: text.trim(),
    language_code: "bn-IN",
    speaker: "roopa",
    model: "bulbul:v3",
  };

  console.log("📤 [TTS API Request Payload]:", JSON.stringify(ttsPayload, null, 2));

  let response;
  try {
    // Requirement 2: Strict await on API fetch
    response = await fetch("https://api.sarvam.ai/text-to-speech", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-subscription-key": sarvamApiKey,
      },
      body: JSON.stringify(ttsPayload),
    });
  } catch (networkError) {
    console.error("❌ [TTS Network Error]: Failed to reach Sarvam AI endpoint.");
    throw networkError;
  }

  console.log(`📡 [TTS API Response]: HTTP Status ${response.status} ${response.statusText}`);

  // Requirement 3: If API fails, log the complete error response data
  if (!response.ok) {
    const errorBodyText = await response.text();
    let errorJsonData = null;
    try {
      errorJsonData = JSON.parse(errorBodyText);
    } catch (_) {
      errorJsonData = errorBodyText;
    }

    console.error("❌ [TTS API Error Data]:", JSON.stringify(errorJsonData, null, 2));
    throw new Error(
      `❌ Sarvam AI TTS Request Failed [HTTP ${response.status}]: ${
        typeof errorJsonData === "object" ? JSON.stringify(errorJsonData) : errorJsonData
      }`
    );
  }

  // Requirement 4: Audio File Processing
  const responseData = await response.json();
  if (
    !responseData ||
    !responseData.audios ||
    !Array.isArray(responseData.audios) ||
    responseData.audios.length === 0
  ) {
    console.error("❌ [TTS Response Validation Failure]: Missing 'audios' array in payload:", responseData);
    throw new Error("❌ Sarvam AI returned HTTP 200 OK but 'audios' array was empty or missing.");
  }

  const base64Audio = responseData.audios[0];
  if (typeof base64Audio !== "string" || base64Audio.trim().length === 0) {
    throw new Error("❌ 'audios[0]' contains an invalid or empty Base64 string.");
  }

  console.log(`📦 [TTS Audio Payload]: Received Base64 string of length ${base64Audio.length} chars.`);

  // Binary Buffer Conversion
  const audioBuffer = Buffer.from(base64Audio, "base64");
  if (!audioBuffer || audioBuffer.length === 0) {
    throw new Error("❌ Buffer.from(base64) resulted in an empty 0-byte buffer.");
  }

  console.log(`💾 [TTS Buffer Decoded]: Successfully created binary Buffer of ${audioBuffer.length} bytes (${(audioBuffer.length / 1024).toFixed(2)} KB).`);

  // Ensure target directory exists
  const targetDir = path.dirname(absolutePath);
  if (!fs.existsSync(targetDir)) {
    fs.mkdirSync(targetDir, { recursive: true });
  }

  // Requirement 4: Save using fs.writeFileSync to the absolute path
  fs.writeFileSync(absolutePath, audioBuffer);

  // Immediate post-save file system verification
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`❌ File System Error: File was written but does not exist at "${absolutePath}"!`);
  }

  const diskStats = fs.statSync(absolutePath);
  if (diskStats.size !== audioBuffer.length) {
    throw new Error(
      `❌ Integrity Error: Size mismatch on disk. Expected ${audioBuffer.length} bytes, found ${diskStats.size} bytes.`
    );
  }

  console.log("✅ [TTS Success]: Audio file successfully written and verified on disk!");
  console.log(`📁 Verified File: ${absolutePath}`);
  console.log(`📊 Verified File Size: ${diskStats.size} bytes (${(diskStats.size / 1024).toFixed(2)} KB)`);
  console.log("================================================================\n");

  return {
    filePath: absolutePath,
    fileSize: diskStats.size,
    bufferLength: audioBuffer.length,
  };
}

// ============================================================================
// 4. End-to-End Orchestrator: Handoff Execution
// ============================================================================
async function executeLLMToTTSHandoff(customerStatement, context) {
  console.log("================================================================");
  console.log("🚀 Executing LLM ➡️ TTS Seamless Handoff Pipeline");
  console.log("================================================================");

  try {
    // Stage 1: Strict Await on LLM response & data extraction
    const plainTextOutput = await generateLLMResponse(customerStatement, context);

    // Explicit Type Check before handoff
    console.log("\n🔗 [Handoff Gatekeeper]: Verifying payload before triggering TTS...");
    console.log("   typeof:", typeof plainTextOutput);
    console.log("   value: ", plainTextOutput);

    if (typeof plainTextOutput !== "string") {
      throw new TypeError(`Handoff blocked: expected string, got ${typeof plainTextOutput}`);
    }

    // Stage 2: Strict Await on TTS & Synchronous Disk Save
    const ttsResult = await convertTextToSpeech(plainTextOutput, TARGET_OUTPUT_FILE);

    console.log("🎉 [Handoff Complete]: Pipeline successfully delivered speech output.");
    console.log(`🎧 Output File: ${ttsResult.filePath}`);
    console.log(`📁 Size on Disk: ${ttsResult.fileSize} bytes`);
    return ttsResult;
  } catch (pipelineError) {
    console.error("\n💥 [Pipeline Failure Caught]:", pipelineError.message);
    throw pipelineError;
  }
}

// Self-test with customer query
if (require.main === module) {
  const context = {
    shopName: "মায়ের আশীর্বাদ স্টোর",
    customerName: "সুব্রত",
    dueAmount: 1500,
    items: "মুদি ও নিত্যপ্রয়োজনীয় জিনিস",
  };

  const sampleCustomerText = "টাকাটা দিতে আমার কয়েক মাস সময় লাগবে। আমাকে সে সময়টা দেওয়া যাবে কি?";

  executeLLMToTTSHandoff(sampleCustomerText, context)
    .then((res) => {
      console.log("✅ Finished execution cleanly.");
    })
    .catch((err) => {
      console.error("❌ Execution terminated with error.");
      process.exit(1);
    });
}

module.exports = {
  generateLLMResponse,
  convertTextToSpeech,
  executeLLMToTTSHandoff,
};
