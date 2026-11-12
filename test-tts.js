require("dotenv").config();
const fs = require("fs");
const path = require("path");

const SARVAM_API_KEY = process.env.SARVAM_API_KEY;

if (!SARVAM_API_KEY || SARVAM_API_KEY.trim() === "" || SARVAM_API_KEY.includes("your_key_here")) {
  console.error("Error: SARVAM_API_KEY is missing or not set in .env file.");
  console.error("Please add your Sarvam API key to .env (SARVAM_API_KEY=your_actual_key) and try again.");
  process.exit(1);
}

const TEXT_PROMPT = "নমস্কার, আমি আপনার স্টোর থেকে বলছি। আপনার কিছু টাকা বকেয়া রয়েছে।";
const TARGET_LANGUAGE = "bn-IN";
const OUTPUT_PATH = path.join(__dirname, "test_reminder.wav");

async function generateTTSWithREST() {
  console.log("Using Sarvam REST API endpoint (https://api.sarvam.ai/text-to-speech)...");
  const response = await fetch("https://api.sarvam.ai/text-to-speech", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-subscription-key": SARVAM_API_KEY,
    },
    body: JSON.stringify({
      inputs: [TEXT_PROMPT],
      target_language_code: TARGET_LANGUAGE,
      speaker: "meera",
      pitch: 0,
      pace: 1.0,
      loudness: 1.5,
      speech_sample_rate: 8000,
      enable_preprocessing: true,
      model: "bulbul:v1",
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`REST API failed [HTTP ${response.status}]: ${errorText}`);
  }

  const data = await response.json();
  if (!data.audios || data.audios.length === 0) {
    throw new Error("No audio returned in REST API response");
  }

  return data.audios[0];
}

async function generateTTSWithSDK() {
  const { SarvamAIClient } = require("sarvamai");
  const client = new SarvamAIClient({
    apiSubscriptionKey: SARVAM_API_KEY,
  });

  console.log("Attempting Sarvam SDK call...");
  const response = await client.textToSpeech.convert({
    text: TEXT_PROMPT,
    language_code: TARGET_LANGUAGE,
  });

  const audios = response.audios || (response.data && response.data.audios);
  if (!audios || audios.length === 0) {
    throw new Error("No audio returned in SDK response");
  }

  return audios[0];
}

async function run() {
  console.log("Starting Sarvam AI Text-to-Speech test...");
  console.log(`Language: ${TARGET_LANGUAGE}`);
  console.log(`Text: "${TEXT_PROMPT}"`);

  let base64Audio;

  try {
    base64Audio = await generateTTSWithSDK();
    console.log("Audio generated successfully via Sarvam SDK.");
  } catch (sdkError) {
    console.warn(`Sarvam SDK call failed (${sdkError.message}).`);
    console.log("Automatically falling back to direct REST API endpoint...");
    base64Audio = await generateTTSWithREST();
    console.log("Audio generated successfully via REST API fallback.");
  }

  const audioBuffer = Buffer.from(base64Audio, "base64");
  fs.writeFileSync(OUTPUT_PATH, audioBuffer);

  console.log(`Audio successfully saved to: ${OUTPUT_PATH}`);
  console.log(`File size: ${(audioBuffer.length / 1024).toFixed(2)} KB`);
}

run().catch((err) => {
  console.error("TTS generation failed:", err.message);
  process.exit(1);
});
