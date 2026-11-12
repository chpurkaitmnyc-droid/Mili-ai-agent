/**
 * ============================================================================
 * Robust Sarvam AI Text-to-Speech (TTS) Module & Verification Test
 * ============================================================================
 */

require("dotenv").config();
const fs = require("fs");
const path = require("path");

/**
 * Converts Bengali text to speech via Sarvam AI and writes it to disk with strict verification.
 *
 * @param {string} text - Bengali text to synthesize
 * @param {string} [outputPath] - Destination file path (defaults to mili_response.wav)
 * @returns {Promise<{ filePath: string, fileSize: number, bufferLength: number }>}
 */
async function speak(text, outputPath = path.resolve(__dirname, "mili_response.wav")) {
  const absoluteFilePath = path.resolve(outputPath);

  console.log("================================================================");
  console.log("🔊 [TTS] Initiating Text-to-Speech Synthesis...");
  console.log(`📝 [TTS] Target Text: "${text}"`);
  console.log(`📍 [TTS] Destination Absolute Path: ${absoluteFilePath}`);

  const apiKey = process.env.SARVAM_API_KEY;
  if (!apiKey || apiKey.trim() === "") {
    throw new Error("❌ SARVAM_API_KEY is not defined in process.env or .env file.");
  }

  // 1. Dispatch REST API call
  console.log("🌐 [TTS] Dispatching POST request to https://api.sarvam.ai/text-to-speech...");
  const response = await fetch("https://api.sarvam.ai/text-to-speech", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "api-subscription-key": apiKey,
    },
    body: JSON.stringify({
      text: text,
      language_code: "bn-IN",
      speaker: "roopa", // Valid speaker for bulbul:v3
      model: "bulbul:v3",
    }),
  });

  // 2. Strict HTTP Status Check
  console.log(`📡 [TTS] HTTP Status Code Received: ${response.status} ${response.statusText}`);

  if (!response.ok) {
    const errorBody = await response.text();
    let parsedMessage = errorBody;
    try {
      const errorJson = JSON.parse(errorBody);
      parsedMessage = errorJson.error?.message || errorJson.message || errorBody;
    } catch (_) {
      // Fallback to raw text
    }
    throw new Error(`❌ Sarvam AI TTS API Failed [HTTP ${response.status}]: ${parsedMessage}`);
  }

  // 3. Response Data Capture & Validation
  const responseData = await response.json();
  if (
    !responseData ||
    !responseData.audios ||
    !Array.isArray(responseData.audios) ||
    responseData.audios.length === 0
  ) {
    throw new Error(
      `❌ Sarvam AI returned HTTP 200, but 'audios' payload is missing or empty! Response: ${JSON.stringify(responseData)}`
    );
  }

  const base64Audio = responseData.audios[0];
  if (typeof base64Audio !== "string" || base64Audio.trim() === "") {
    throw new Error("❌ Received invalid or empty Base64 string from Sarvam AI audio payload.");
  }

  console.log(`📦 [TTS] Received Base64 Audio String: ${base64Audio.length} characters`);

  // 4. Base64 to Binary Buffer Conversion
  const audioBuffer = Buffer.from(base64Audio, "base64");
  if (!audioBuffer || audioBuffer.length === 0) {
    throw new Error("❌ Base64 decode resulted in a 0-byte Buffer.");
  }

  console.log(`💾 [TTS] Decoded Binary Audio Buffer Length: ${audioBuffer.length} bytes (${(audioBuffer.length / 1024).toFixed(2)} KB)`);

  // 5. Ensure parent directory exists
  const parentDir = path.dirname(absoluteFilePath);
  if (!fs.existsSync(parentDir)) {
    await fs.promises.mkdir(parentDir, { recursive: true });
  }

  // 6. Strict Await on File Write
  await fs.promises.writeFile(absoluteFilePath, audioBuffer);

  // 7. Post-Write Disk Verification
  if (!fs.existsSync(absoluteFilePath)) {
    throw new Error(`❌ Critical Verification Failure: File write completed but "${absoluteFilePath}" was NOT found on disk!`);
  }

  const fileStats = await fs.promises.stat(absoluteFilePath);
  if (fileStats.size !== audioBuffer.length) {
    throw new Error(`❌ Size Mismatch: Expected ${audioBuffer.length} bytes on disk, but found ${fileStats.size} bytes.`);
  }

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

// Self-test execution
if (require.main === module) {
  const sampleText =
    "সুব্রতবাবু, আপনি এভাবে রেগে যাবেন না, মায়ের আশীর্বাদ স্টোরের সাথে আপনার বহুদিনের সম্পর্ক। সামান্য ১৫০০ টাকার জন্য এই বিশ্বাসটা নষ্ট করবেন না, অনুরোধ করছি টাকাটা মিটিয়ে দিন।";

  speak(sampleText)
    .then((result) => {
      console.log("🎉 Test completed successfully with output:", result);
    })
    .catch((err) => {
      console.error("\n💥 Test Error Caught:", err.message);
      process.exit(1);
    });
}

module.exports = { speak };
