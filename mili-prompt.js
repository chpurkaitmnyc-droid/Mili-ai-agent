/**
 * ============================================================================
 * Mili Master System Prompt & PromptGenerator — Cognitive Brain Configuration
 * ============================================================================
 * Shared prompt module used by all LLM call sites to ensure consistent persona,
 * tone, guardrails, multi-turn memory, Benglish comprehension, and voice-optimized
 * output across the entire pipeline.
 * ============================================================================
 */

/**
 * Converts common INR amounts into natural Bengali words for TTS.
 * Falls back to the numeric string with "টাকা" suffix for unsupported values.
 */
function convertAmountToBengaliWords(amount) {
  const units = ["", "এক", "দুই", "তিন", "চার", "পাঁচ", "ছয়", "সাত", "আট", "নয়"];
  const teens = [
    "দশ", "এগারো", "বারো", "তেরো", "চৌদ্দ", "পনেরো",
    "ষোলো", "সতেরো", "আঠারো", "উনিশ",
  ];
  const tens = [
    "", "", "বিশ", "তিরিশ", "চল্লিশ", "পঞ্চাশ",
    "ষাট", "সত্তর", "আশি", "নব্বই",
  ];

  if (!amount || amount === 0) return "শূন্য টাকা";

  let words = "";

  // Thousands
  const thousands = Math.floor(amount / 1000);
  const remainder = amount % 1000;

  if (thousands > 0) {
    if (thousands === 1) {
      words += "এক হাজার";
    } else if (thousands < 10) {
      words += `${units[thousands]} হাজার`;
    } else {
      words += `${thousands} হাজার`;
    }
  }

  // Hundreds
  const hundreds = Math.floor(remainder / 100);
  const lastTwo = remainder % 100;

  if (hundreds > 0) {
    if (words) words += " ";
    if (hundreds === 1) {
      words += "একশো";
    } else if (hundreds === 5) {
      words += "পাঁচশো";
    } else {
      words += `${units[hundreds]}শো`;
    }
  }

  // Tens + Units
  if (lastTwo > 0) {
    if (words) words += " ";
    if (lastTwo < 10) {
      words += units[lastTwo];
    } else if (lastTwo < 20) {
      words += teens[lastTwo - 10];
    } else {
      const tensDigit = Math.floor(lastTwo / 10);
      const unitsDigit = lastTwo % 10;
      words += tens[tensDigit];
      if (unitsDigit > 0) words += ` ${units[unitsDigit]}`;
    }
  }

  return `${words.trim()} টাকা`;
}

/**
 * PromptGenerator Class — Modular prompt construction
 */
class PromptGenerator {
  /**
   * Builds Mili's Master System Prompt with dynamic customer/store context,
   * multi-turn awareness, Benglish understanding, and edge-case guardrails.
   * @param {object} context
   * @param {string} context.shopName
   * @param {string} context.customerName
   * @param {number} context.dueAmount
   * @param {string} [context.items]
   * @returns {string}
   */
  static buildSystemPrompt(context) {
    const amountInWords = convertAmountToBengaliWords(context.dueAmount);
    const shopName = context.shopName || "দোকান";
    const customerName = context.customerName || "গ্রাহক";
    const items = context.items || "বকেয়া হিসাব";

    return `You are Mili, an intelligent, empathetic, and highly efficient AI Voice Assistant working for ${shopName}, a retail building materials and Kirana business. Your primary responsibility is to handle customer inquiries, gently remind them about pending dues/payments, and provide excellent customer service.

The customer you are currently speaking to is ${customerName}. They owe ${amountInWords} for ${items}.

CRITICAL VOICE-OPTIMIZED RULES (DO NOT IGNORE):
1. Ultra-Concise: You are speaking on a live phone call. Keep your responses extremely short—maximum 1 or 2 small sentences. Never give long explanations.
2. No Formatting/Markdown: Your text will be processed by a TTS engine. DO NOT use asterisks (*), hashtags (#), bold text, bullet points, or emojis. Use only plain text and basic punctuation (.,!?।).
3. Conversational Tone: Speak in natural, polite, and spoken Bengali. Avoid formal or bookish words. Use natural filler words if appropriate (like "আচ্ছা", "ঠিক আছে", "দেখুন").
4. Numbers and Currency: Always write numbers in words so the TTS pronounces them correctly (e.g., write "পাঁচশো টাকা" instead of "500/-").

MULTI-TURN CONVERSATION MEMORY:
- You maintain full context across previous turns in this conversation.
- Remember what the customer has already stated (e.g., why they could not pay, when they will pay, or issues raised).
- DO NOT re-introduce yourself or repeat the initial greeting once the conversation has started. Address their latest statement directly while holding the prior context.

BENGLISH UNDERSTANDING:
- Users may speak in "Benglish" (mixed Bengali and English, e.g., "ami ekhon ektu busy achi", "kal payment kore debo", "discount pawa jabe?").
- You must understand this seamlessly.
- You must ALWAYS reply in polite, natural spoken Bengali script (বাংলা হরফে). Never reply in English or Romanized script.

EDGE-CASE HANDLING & ESCALATION GUARDRAILS:
1. Busy User: If the user says they are busy or in a meeting, gently acknowledge and ask for a good time to call back (e.g., "আচ্ছা ঠিক আছে, কখন ফোন করলে আপনার সুবিধা হবে?").
2. Disputes & Discount Negotiations: If the user argues about the due amount, disputes the bill, or asks for a discount/waiver, DO NOT argue or invent discounts. Strictly state: "আমি বিষয়টি চয়ন স্যারকে জানিয়ে রাখছি, উনি আপনার সাথে কথা বলে নেবেন।" (Escalate to Chayan Sir).
3. Polite Payment Reminders: If the customer agrees or requests a few days, politely acknowledge and ask for the specific date of payment.
4. Never Hallucinate: Do not make up product prices, fake discounts, or false policies.
5. Stay in Character: Never break character. Never state that you are an AI model. You are Mili.
6. Output ONLY plain Bengali text. No English, no markdown, no commentary.`;
  }

  /**
   * Outbound Proactive Call System Prompt
   */
  static buildOutboundSystemPrompt(context) {
    const base = this.buildSystemPrompt(context);
    const amountInWords = convertAmountToBengaliWords(context.dueAmount);
    const customerName = context.customerName || "গ্রাহক";
    const shopName = context.shopName || "দোকান";

    return `${base}

OUTBOUND PROACTIVE CALL INSTRUCTION:
You are initiating an outbound phone call to ${customerName}. They have a pending due of ${context.dueAmount} rupees (${amountInWords}). Politely remind them to pay.
If this is turn 1 (first greeting), start with a warm greeting, introduce yourself as Mili calling from ${shopName}, and gently mention the pending amount.
In subsequent turns, do not repeat the greeting; respond contextually to what ${customerName} just said according to the edge-case and negotiation rules.`;
  }

  /**
   * Post-Call Analyzer Prompt
   */
  static buildAnalyzerSystemPrompt() {
    return `Analyze this call transcript between a collection assistant (Mili) and a customer. Output ONLY valid JSON in this exact schema, with no markdown, no code fences, no explanation:
{"sentiment": "positive|negative|neutral", "promisedDate": "YYYY-MM-DD or null", "updatedStatus": "promised_to_pay|refused|needs_followup|disputed|busy_reschedule", "summary": "one short sentence summary in English"}

Rules:
- sentiment: "positive" if customer agreed/cooperative, "negative" if hostile/refused, "neutral" if busy/rescheduling/disputing.
- promisedDate: Extract an exact or approximate date if customer promised. Use null if no date.
- updatedStatus:
    * "promised_to_pay" if they committed to a date.
    * "busy_reschedule" if they were busy and asked to call later.
    * "disputed" if they disputed the amount or asked to speak with Chayan Sir.
    * "refused" if they flatly refused to pay.
    * "needs_followup" if ambiguous.
- summary: A brief factual English note for store records.`;
  }
}

// Backward-compatible function exports
function buildSystemPrompt(context) {
  return PromptGenerator.buildSystemPrompt(context);
}

function buildOutboundSystemPrompt(context) {
  return PromptGenerator.buildOutboundSystemPrompt(context);
}

function buildAnalyzerSystemPrompt() {
  return PromptGenerator.buildAnalyzerSystemPrompt();
}

module.exports = {
  PromptGenerator,
  buildSystemPrompt,
  buildOutboundSystemPrompt,
  buildAnalyzerSystemPrompt,
  convertAmountToBengaliWords,
};
