/**
 * ============================================================================
 * ttsService.js — Reusable Sarvam AI Text-to-Speech (TTS) Service
 * ============================================================================
 * Features:
 *   - Strips markdown formatting (*, #, -, _, `, ~) for natural acoustic rendering
 *   - Synthesizes Bengali (bn-IN) voice using Sarvam AI 'bulbul:v3' (speaker: 'roopa')
 *   - Returns { audio: "<base64_string>", audioFormat: "wav" }
 *   - Error resilient: logs error and returns { audio: null, audioFormat: null }
 *     without crashing the server.
 * ============================================================================
 */

require("dotenv").config();

/**
 * Strips markdown symbols, asterisks, hashtags, bullets, and backticks.
 * @param {string} text 
 * @returns {string} Plain text optimized for TTS
 */
function cleanTextForTTS(text) {
  if (!text || typeof text !== "string") return "";
  return text
    .replace(/<think>[\s\S]*?<\/think>/gi, "")
    .replace(/[*#_~`>]/g, "")
    .replace(/^\s*[-•+]\s+/gm, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Generates Bengali voice audio using Sarvam AI Text-to-Speech.
 *
 * @param {string} text - Bengali text to synthesize
 * @returns {Promise<{ audio: string|null, audioFormat: string|null }>}
 */
async function generateSpeech(text) {
  const apiKey = process.env.SARVAM_API_KEY;

  if (!apiKey || apiKey.trim() === "" || apiKey.includes("your_key")) {
    console.warn("⚠️ [ttsService] SARVAM_API_KEY is missing or invalid in .env.");
    return { audio: null, audioFormat: null };
  }

  const cleanText = cleanTextForTTS(text);
  if (!cleanText) {
    console.warn("⚠️ [ttsService] generateSpeech received empty text.");
    return { audio: null, audioFormat: null };
  }

  try {
    const response = await fetch("https://api.sarvam.ai/text-to-speech", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "api-subscription-key": apiKey,
      },
      body: JSON.stringify({
        text: cleanText,
        language_code: "bn-IN",
        speaker: "roopa",
        model: "bulbul:v3",
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`❌ [ttsService] Sarvam TTS HTTP ${response.status}:`, errorText);
      return { audio: null, audioFormat: null };
    }

    const data = await response.json();
    if (!data.audios || !Array.isArray(data.audios) || data.audios.length === 0) {
      console.error("❌ [ttsService] No audio array returned from Sarvam AI:", data);
      return { audio: null, audioFormat: null };
    }

    const base64Audio = data.audios[0];
    if (typeof base64Audio !== "string" || !base64Audio.trim()) {
      console.error("❌ [ttsService] Empty audio string received from Sarvam AI.");
      return { audio: null, audioFormat: null };
    }

    return {
      audio: base64Audio,
      audioFormat: "wav",
    };
  } catch (err) {
    console.error("❌ [ttsService] TTS Generation Exception:", err.message);
    return { audio: null, audioFormat: null };
  }
}

module.exports = {
  generateSpeech,
  cleanTextForTTS,
};
