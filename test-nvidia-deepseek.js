/**
 * ============================================================================
 * Test Script: NVIDIA NIM Integration with DeepSeek in Node.js
 * Model: deepseek-ai/deepseek-v4.1-flash
 * Endpoint: https://integrate.api.nvidia.com/v1
 * ============================================================================
 */

require("dotenv").config();
const OpenAI = require("openai");

const apiKey = process.env.NVIDIA_API_KEY;

if (!apiKey || apiKey.trim() === "") {
  console.error("❌ Error: NVIDIA_API_KEY is not defined in your .env file.");
  process.exit(1);
}

// Initialize the OpenAI client pointing to NVIDIA NIM's API gateway
const nvidiaClient = new OpenAI({
  baseURL: "https://integrate.api.nvidia.com/v1",
  apiKey: apiKey,
});

async function testDeepSeekChat() {
  console.log("================================================================");
  console.log("🚀 Testing DeepSeek on NVIDIA NIM (Text / Chat Completion)");
  console.log("Model: deepseek-ai/deepseek-v4.1-flash");
  console.log("================================================================");

  try {
    const startTime = Date.now();
    const completion = await nvidiaClient.chat.completions.create({
      model: "deepseek-ai/deepseek-v4.1-flash",
      messages: [
        {
          role: "system",
          content:
            "You are Mili, a polite but firm debt collection assistant calling on behalf of a local Kirana store. Speak natural, conversational Bengali in under 2 short sentences.",
        },
        {
          role: "user",
          content: "দাদা, আমি সামনের সোমবারের মধ্যে ১৫০০ টাকা দিয়ে দেব।",
        },
      ],
      temperature: 0.6,
      max_tokens: 150,
    });

    const elapsed = Date.now() - startTime;
    const responseText = completion.choices[0].message.content;

    console.log(`⏱️ Latency: ${elapsed} ms`);
    console.log(`🤖 DeepSeek Response:\n"${responseText}"`);
    console.log(`📊 Token Usage:`, completion.usage);
    console.log("================================================================");
  } catch (error) {
    console.error("❌ DeepSeek API Error:", error.message);
  }
}

// Execute the test
testDeepSeekChat();
