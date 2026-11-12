/**
 * Generates a realistic customer input audio in Bengali for local loop testing.
 */
require("dotenv").config();
const fs = require("fs");
const path = require("path");

async function generateSampleCustomerInput() {
  const customerText = "হ্যাঁ দাদা, আমি সুব্রত বলছি। আগামী সোমবারের মধ্যে ১৫০০ টাকা মিটিয়ে দেব।";
  console.log(`Generating customer input audio: "${customerText}"`);

  const response = await fetch("https://api.sarvam.ai/text-to-speech", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-subscription-key": process.env.SARVAM_API_KEY,
    },
    body: JSON.stringify({
      inputs: [customerText],
      target_language_code: "bn-IN",
      speaker: "meera",
      pitch: 0,
      pace: 1.0,
      loudness: 1.5,
      speech_sample_rate: 8000,
      enable_preprocessing: true,
      model: "bulbul:v1",
    }),
  });

  const data = await response.json();
  const audioBuffer = Buffer.from(data.audios[0], "base64");
  const outputPath = path.join(__dirname, "customer_input.wav");
  fs.writeFileSync(outputPath, audioBuffer);
  console.log(`Saved sample customer input to: ${outputPath} (${(audioBuffer.length / 1024).toFixed(2)} KB)`);
}

generateSampleCustomerInput().catch(console.error);
