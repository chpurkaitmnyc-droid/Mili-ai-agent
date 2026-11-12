/**
 * ============================================================================
 * SessionManager — Multi-turn State & Interruption Management
 * ============================================================================
 * Maintains active conversational sessions keyed by customerId.
 * Responsibilities:
 *   1. Multi-turn chat_history preservation across turns
 *   2. Interruption / VAD hook handling (isInterrupted flag & AbortController)
 *   3. Asynchronous TTS queue tracking and cancellation
 * ============================================================================
 */

class SessionManager {
  constructor() {
    /** @type {Map<string|number, object>} */
    this.sessions = new Map();
  }

  /**
   * Initializes or retrieves a conversational session for a customer.
   * @param {object} customer - Customer database record (must have id)
   * @param {string} [systemPrompt] - Initial Master System Prompt to seed chat_history
   * @returns {object} Active session object
   */
  createSession(customer, systemPrompt = null) {
    const customerId = customer.id;
    if (!customerId) {
      throw new Error("Cannot create session: Customer object missing 'id'");
    }

    const session = {
      customerId,
      customer,
      chat_history: systemPrompt ? [{ role: "system", content: systemPrompt }] : [],
      isInterrupted: false,
      abortController: new AbortController(),
      ttsQueue: [],
      createdAt: Date.now(),
      lastActive: Date.now(),
    };

    this.sessions.set(customerId, session);
    console.log(`\n📋 [SessionManager] Session initiated for customer #${customerId} (${customer.name})`);
    return session;
  }

  /**
   * Retrieves an active session by customerId.
   * @param {string|number} customerId
   * @returns {object|null}
   */
  getSession(customerId) {
    return this.sessions.get(customerId) || null;
  }

  /**
   * Appends a message to the multi-turn chat history.
   * @param {string|number} customerId
   * @param {"user"|"assistant"|"system"} role
   * @param {string} content
   * @returns {Array<{role: string, content: string}>}
   */
  addMessage(customerId, role, content) {
    const session = this.getSession(customerId);
    if (!session) {
      throw new Error(`[SessionManager] No active session found for customerId: ${customerId}`);
    }
    const cleanContent = content ? content.trim() : "";
    session.chat_history.push({ role, content: cleanContent });
    session.lastActive = Date.now();
    return session.chat_history;
  }

  /**
   * Returns a copy of the chat history.
   * @param {string|number} customerId
   * @returns {Array<{role: string, content: string}>}
   */
  getHistory(customerId) {
    const session = this.getSession(customerId);
    return session ? [...session.chat_history] : [];
  }

  /**
   * Interruption / VAD Hook
   * Triggers an immediate abort of ongoing LLM generation and purges the pending TTS queue.
   * @param {string|number} customerId
   * @param {string} [reason="User voice detected"]
   * @returns {boolean}
   */
  interrupt(customerId, reason = "User voice detected (VAD)") {
    const session = this.getSession(customerId);
    if (!session) return false;

    console.log(`\n⚡ [VAD/Interruption] 🛑 INTERRUPT TRIGGERED for customer #${customerId}: ${reason}`);
    session.isInterrupted = true;

    // 1. Abort LLM stream via AbortController
    if (session.abortController && !session.abortController.signal.aborted) {
      session.abortController.abort(reason);
      console.log(`   [VAD/Interruption] AbortController signaled. LLM stream halted.`);
    }

    // 2. Clear pending TTS playback/synthesis queue
    const droppedCount = session.ttsQueue.length;
    session.ttsQueue = [];
    console.log(`   [VAD/Interruption] Cleared ${droppedCount} pending TTS audio chunk(s) from queue.`);

    return true;
  }

  /**
   * Resets the interruption flag and prepares a fresh AbortController for the next conversational turn.
   * @param {string|number} customerId
   */
  resetInterruption(customerId) {
    const session = this.getSession(customerId);
    if (!session) return;
    session.isInterrupted = false;
    session.abortController = new AbortController();
  }

  /**
   * Enqueues a TTS chunk into the session's active playback buffer.
   * @param {string|number} customerId
   * @param {object} chunk
   */
  enqueueTTSChunk(customerId, chunk) {
    const session = this.getSession(customerId);
    if (!session) return;
    if (session.isInterrupted) {
      console.log(`   [TTS Queue] Discarded chunk #${chunk.index || 0} because session is interrupted.`);
      return;
    }
    session.ttsQueue.push(chunk);
  }

  /**
   * Clears the TTS queue manually.
   * @param {string|number} customerId
   */
  clearTTSQueue(customerId) {
    const session = this.getSession(customerId);
    if (session) session.ttsQueue = [];
  }

  /**
   * Deletes a session upon call completion.
   * @param {string|number} customerId
   */
  endSession(customerId) {
    const deleted = this.sessions.delete(customerId);
    if (deleted) {
      console.log(`🔒 [SessionManager] Session closed for customer #${customerId}`);
    }
    return deleted;
  }
}

module.exports = { SessionManager };
