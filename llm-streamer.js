/**
 * ============================================================================
 * LLMStreamer — Low-Latency Streaming & Sentence-Level Chunking Engine
 * ============================================================================
 * Streams tokens from DeepSeek (or compatible LLM) with `stream: true`,
 * buffers tokens, and yields speech-ready sentence chunks upon hitting
 * punctuation delimiters: Bengali '।', '?', '!', '.', or newlines.
 *
 * Integrated with SessionManager:
 *   - Checks `session.isInterrupted` and aborts stream via AbortController.
 *   - Tracks performance metrics: TTFB (Time-To-First-Byte) & Time-To-First-Chunk.
 * ============================================================================
 */

class LLMStreamer {
  /**
   * @param {object} options
   * @param {object} [options.client] - OpenAI/NVIDIA NIM client instance
   * @param {string} [options.model="deepseek-ai/deepseek-v4.1-flash"]
   * @param {number} [options.timeoutMs=6000] - Abort timeout if remote API hangs
   */
  constructor(options = {}) {
    this.client = options.client || null;
    this.model = options.model || "deepseek-ai/deepseek-v4.1-flash";
    this.timeoutMs = options.timeoutMs || 6000;
    // Regex for sentence boundaries: Bengali dari (।), ?, !, ., or newlines
    this.boundaryRegex = /([.?!।\n]+)/;
  }

  /**
   * Streams a conversational turn for an active session with real-time sentence chunking.
   *
   * @param {object} session - Session from SessionManager
   * @param {object} [callbacks] - Event hooks
   * @param {function(string, number): void} [callbacks.onChunk] - Dispatched immediately when a sentence is ready
   * @param {function(string): void} [callbacks.onToken] - Raw token hook
   * @param {function(number): void} [callbacks.onTTFB] - Time-to-first-byte in ms
   * @returns {Promise<{ fullText: string, chunks: string[], interrupted: boolean }>}
   */
  async streamTurn(session, callbacks = {}) {
    const { onChunk, onToken, onTTFB } = callbacks;
    const customerId = session.customerId;

    const timerLabelTTFB = `⏱️ [Latency] Customer #${customerId} TTFB (First Token)`;
    const timerLabelFirstChunk = `⏱️ [Latency] Customer #${customerId} Time-To-First-Chunk`;

    console.time(timerLabelTTFB);
    console.time(timerLabelFirstChunk);

    let firstTokenReceived = false;
    let firstChunkEmitted = false;
    let fullText = "";
    let tokenBuffer = "";
    const emittedChunks = [];

    // Ensure session has an active AbortController
    if (!session.abortController || session.abortController.signal.aborted) {
      session.abortController = new AbortController();
    }
    const signal = session.abortController.signal;

    // Local safety timeout to prevent indefinite hangs
    const safetyTimer = setTimeout(() => {
      if (!firstTokenReceived && !signal.aborted) {
        console.warn(`⚠️ [LLMStreamer] API stream timed out after ${this.timeoutMs}ms. Aborting.`);
        session.abortController.abort("API timeout");
      }
    }, this.timeoutMs);

    try {
      if (!this.client) {
        throw new Error("No OpenAI/NVIDIA client provided to LLMStreamer.");
      }

      console.log(`\n🌊 [LLMStreamer] Opening stream (model: ${this.model})...`);

      const responseStream = await this.client.chat.completions.create(
        {
          model: this.model,
          messages: session.chat_history,
          stream: true,
          temperature: 0.6,
          max_tokens: 180,
        },
        { signal }
      );

      for await (const chunk of responseStream) {
        // Interruption / VAD Check
        if (session.isInterrupted || signal.aborted) {
          console.log(`⚡ [LLMStreamer] Interruption detected mid-stream. Halting token loop.`);
          break;
        }

        const delta = chunk.choices[0]?.delta?.content || "";
        if (!delta) continue;

        // Strip thinking tokens if present
        const sanitizedDelta = delta.replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/[*_#`]/g, "");
        if (!sanitizedDelta) continue;

        // Metric: TTFB (First Token)
        if (!firstTokenReceived) {
          firstTokenReceived = true;
          clearTimeout(safetyTimer);
          console.timeEnd(timerLabelTTFB);
          if (onTTFB) onTTFB(Date.now() - session.lastActive);
        }

        if (onToken) onToken(sanitizedDelta);

        fullText += sanitizedDelta;
        tokenBuffer += sanitizedDelta;

        // Sentence Chunking Logic
        // Check if tokenBuffer contains any boundary delimiter
        let match;
        while ((match = this.boundaryRegex.exec(tokenBuffer)) !== null) {
          const splitIndex = match.index + match[0].length;
          const completeSentence = tokenBuffer.slice(0, splitIndex).trim();
          tokenBuffer = tokenBuffer.slice(splitIndex);

          if (completeSentence.length > 0) {
            emittedChunks.push(completeSentence);
            const chunkIndex = emittedChunks.length;

            if (!firstChunkEmitted) {
              firstChunkEmitted = true;
              console.timeEnd(timerLabelFirstChunk);
            }

            console.log(`   📦 [Chunk #${chunkIndex} Ready for TTS]: "${completeSentence}"`);

            // Register with session TTS queue placeholder
            session.ttsQueue.push({ index: chunkIndex, text: completeSentence, status: "ready_for_tts" });

            if (onChunk) {
              onChunk(completeSentence, chunkIndex);
            }
          }
        }
      }

      clearTimeout(safetyTimer);

      // Flush remaining buffered text if not interrupted
      if (!session.isInterrupted && tokenBuffer.trim().length > 0) {
        const trailingChunk = tokenBuffer.trim();
        emittedChunks.push(trailingChunk);
        const chunkIndex = emittedChunks.length;

        if (!firstChunkEmitted) {
          firstChunkEmitted = true;
          console.timeEnd(timerLabelFirstChunk);
        }

        console.log(`   📦 [Chunk #${chunkIndex} (Flush)]: "${trailingChunk}"`);
        session.ttsQueue.push({ index: chunkIndex, text: trailingChunk, status: "ready_for_tts" });

        if (onChunk) {
          onChunk(trailingChunk, chunkIndex);
        }
      }

      if (!firstTokenReceived) {
        try { console.timeEnd(timerLabelTTFB); } catch (_) {}
      }
      if (!firstChunkEmitted) {
        try { console.timeEnd(timerLabelFirstChunk); } catch (_) {}
      }

      return {
        fullText: fullText.trim(),
        chunks: emittedChunks,
        interrupted: session.isInterrupted || signal.aborted,
      };
    } catch (err) {
      clearTimeout(safetyTimer);
      try { console.timeEnd(timerLabelTTFB); } catch (_) {}
      try { console.timeEnd(timerLabelFirstChunk); } catch (_) {}

      // Check if this was a user barge-in interruption
      if (session.isInterrupted) {
        console.log(`⚡ [LLMStreamer] Stream aborted gracefully due to user interruption (VAD).`);
        return {
          fullText: fullText.trim(),
          chunks: emittedChunks,
          interrupted: true,
        };
      }

      console.warn(`⚠️ [LLMStreamer] Live streaming error or timeout (${err.message}) — executing resilient fallback chunker...`);

      // Fallback chunking generator to ensure conversational pipeline never crashes when API throttles
      return await this.fallbackStreamingTurn(session, callbacks);
    }
  }

  /**
   * Resilient fallback chunker that generates contextual Bengali response and chunks it.
   */
  async fallbackStreamingTurn(session, callbacks = {}) {
    const { onChunk } = callbacks;
    const customer = session.customer;
    const name = customer.name || "গ্রাহক";
    const lastUserMsg = [...session.chat_history].reverse().find(m => m.role === "user")?.content || "";

    let fallbackText = "";

    // Contextual Bengali reasoning
    if (lastUserMsg.includes("Call Connected") || lastUserMsg.includes("greeting")) {
      fallbackText = `নমস্কার ${name} বাবু, আমি মায়ের আশীর্বাদ স্টোর থেকে মিলি বলছি। আপনার বকেয়া টাকা পরিশোধের বিষয়ে একটু কথা বলতে ফোন করেছি।`;
    } else if (lastUserMsg.toLowerCase().includes("busy") || lastUserMsg.includes("ব্যস্ত") || lastUserMsg.includes("পরে")) {
      fallbackText = `আচ্ছা ঠিক আছে ${name} বাবু, কখন ফোন করলে আপনার সুবিধা হবে বলুন?`;
    } else if (lastUserMsg.toLowerCase().includes("discount") || lastUserMsg.includes("কম") || lastUserMsg.includes("চয়ন") || lastUserMsg.includes("ভুল")) {
      fallbackText = `আমি বিষয়টি চয়ন স্যারকে জানিয়ে রাখছি, উনি আপনার সাথে কথা বলে নেবেন।`;
    } else if (lastUserMsg.includes("কাল") || lastUserMsg.includes("দেব") || lastUserMsg.includes("pay")) {
      fallbackText = `ধন্যবাদ ${name} বাবু। কালকের মধ্যে টাকাটা ক্লিয়ার করে দিলে খুব সুবিধা হয়।`;
    } else {
      fallbackText = `আচ্ছা ${name} বাবু, আপনার কথা আমি বুঝতে পারছি। দোকান থেকে বকেয়া টাকাটা তাড়াতাড়ি দিয়ে দিলে খুব ভালো হয়।`;
    }

    // Split fallback into chunks by punctuation
    const rawChunks = fallbackText.split(/([.?!।]+)/).filter(Boolean);
    const chunks = [];
    for (let i = 0; i < rawChunks.length; i += 2) {
      const sentence = (rawChunks[i] + (rawChunks[i + 1] || "")).trim();
      if (sentence) chunks.push(sentence);
    }

    console.log(`🔄 [LLMStreamer Fallback] Yielding ${chunks.length} sentence chunk(s)...`);
    for (let i = 0; i < chunks.length; i++) {
      if (session.isInterrupted) {
        console.log(`⚡ [LLMStreamer Fallback] Aborted at chunk #${i + 1} due to interruption.`);
        return { fullText: chunks.slice(0, i).join(" "), chunks: chunks.slice(0, i), interrupted: true };
      }
      const chunk = chunks[i];
      console.log(`   📦 [Fallback Chunk #${i + 1} Ready for TTS]: "${chunk}"`);
      session.ttsQueue.push({ index: i + 1, text: chunk, status: "ready_for_tts" });
      if (onChunk) onChunk(chunk, i + 1);
    }

    return {
      fullText: fallbackText,
      chunks,
      interrupted: false,
    };
  }
}

module.exports = { LLMStreamer };
