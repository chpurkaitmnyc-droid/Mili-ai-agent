/**
 * ============================================================================
 * services/scopeGuard.js — Strict Domain & Niche Scope Gatekeeper
 * ============================================================================
 * EXCLUSIVE NICHE FOR MILI:
 *   - Retail & Kirana billing tracking
 *   - Khata & credit ledger management
 *   - Overdue payment recovery (বাকি আদায়)
 *   - Invoicing software & Excel sheet analysis
 *   - Outbound payment reminder phone calls
 *   - Store operation scheduling
 *
 * OUT-OF-SCOPE REJECTION:
 *   - Block general queries (coding, recipes, poems, news, politics, entertainment, etc.)
 *   - Firm, courteous Bengali boundary reminder explaining Mili's dedicated purpose.
 * ============================================================================
 */

// Core in-scope keywords (Bengali, English, and Benglish)
const IN_SCOPE_KEYWORDS = [
  // Bengali terms
  "বাকি", "টাকা", "বিল", "হিসাব", "খাতা", "পেমেন্ট", "আদায়", "আদায়", "দেনা", "খদ্দের", "গ্রাহক",
  "দোকান", "মুদি", "সিমেন্ট", "রড", "চালান", "ওভারডিউ", "পেন্ডিং", "কাস্টমার", "এক্সেল", "রিপোর্ট",
  "শিডিউল", "সময়", "কল", "ফোন", "ফলোআপ", "ডিসকাউন্ট", "পরিশোধ", "লিজার", "লেজার", "ইনভয়েস",
  "তপন", "রমেশ", "সুব্রত", "আনোয়ার", "বিকাশ", "সঞ্জয়", "চয়ন",

  // English & Benglish terms
  "due", "dues", "bill", "billing", "khata", "credit", "ledger", "payment", "overdue",
  "customer", "customers", "invoice", "invoicing", "excel", "sheet", "report", "call",
  "followup", "follow-up", "recovery", "kirana", "store", "shop", "balance", "amount",
  "settle", "schedule", "cron", "reminder", "mcp", "debt", "pending", "status", "baki",
  "taka", "hisab", "khoroch", "shob", "retail", "wholesale", "cement", "ration", "grocery"
];

// Explicit out-of-scope keywords to fast-reject
const EXPLICIT_OUT_OF_SCOPE_KEYWORDS = [
  "recipe", "ranna", "রান্না", "poem", "kobita", "কবিতা", "python", "javascript", "code",
  "coding", "function", "movie", "cinema", "গান", "song", "lyrics", "cricket", "football",
  "joke", "কৌতুক", "weather", "আবহাওয়া", "politics", "রাজনীতি", "love", "প্রেম", "astrology",
  "horoscope", "রাশিফল", "capital of", "president", "prime minister", "history of"
];

// Acceptable short greetings
const GREETINGS = [
  "hi", "hello", "hey", "নমস্কার", "হ্যালো", "কেমন আছো", "কেমন আছেন", "hi mili", "hello mili", "কে বলছেন"
];

/**
 * Standard polite, firm Bengali boundary rejection message.
 */
const SCOPE_BOUNDARY_MESSAGE =
  "আমি মিলি—বিশেষভাবে মুদি ও রিটেইল দোকানের বাকি হিসাব, খাতা পরিচালনা, ইনভয়েস ট্র্যাকিং এবং বকেয়া টাকা আদায়ের (Credit Recovery) জন্যই আমাকে তৈরি করা হয়েছে। দোকানের হিসাব বা বাকি আদায়ের বাইরে অন্য কোনো বিষয়ে আমি সাহায্য করতে পারি না। আপনার দোকানের খাতা বা বকেয়া তালিকা সম্পর্কে কিছু জানতে চান?";

/**
 * Validates whether the incoming query is within Mili's exclusive retail/khata recovery niche.
 *
 * @param {string} message - User query
 * @param {Array} [_history] - Conversation history
 * @returns {Promise<{ allowed: boolean, reason?: string, reply?: string }>}
 */
async function validateScope(message, _history = []) {
  if (!message || typeof message !== "string") {
    return { allowed: false, reply: SCOPE_BOUNDARY_MESSAGE };
  }

  const raw = message.trim();
  const lower = raw.toLowerCase();

  // 1. Allow basic short greetings
  const isGreeting = GREETINGS.some((g) => lower === g || lower === `${g}!` || lower === `${g}.` || lower.startsWith(g));
  if (isGreeting && raw.split(" ").length <= 4) {
    return { allowed: true, isGreeting: true };
  }

  // 2. Fast check: Check explicit out-of-scope triggers
  const hasOutKeyword = EXPLICIT_OUT_OF_SCOPE_KEYWORDS.some((kw) => lower.includes(kw));
  if (hasOutKeyword) {
    console.log(`🛡️ [scopeGuard] Blocked out-of-scope request (explicit match): "${raw.slice(0, 50)}"`);
    return {
      allowed: false,
      reason: "explicit_out_of_scope",
      reply: SCOPE_BOUNDARY_MESSAGE,
    };
  }

  // 3. Fast check: Check presence of Kirana/Khata/Credit domain keywords
  const hasInScopeKeyword = IN_SCOPE_KEYWORDS.some((kw) => lower.includes(kw));
  if (hasInScopeKeyword) {
    return { allowed: true };
  }

  // 4. If query is very long and has zero business/ledger keywords, reject
  if (raw.length > 25 && !hasInScopeKeyword) {
    console.log(`🛡️ [scopeGuard] Blocked out-of-scope request (no domain keyword): "${raw.slice(0, 50)}"`);
    return {
      allowed: false,
      reason: "no_domain_keyword",
      reply: SCOPE_BOUNDARY_MESSAGE,
    };
  }

  // Permissive for short follow-ups in an active conversation (e.g. "হ্যাঁ", "কত?", "কখন?")
  return { allowed: true };
}

module.exports = {
  validateScope,
  SCOPE_BOUNDARY_MESSAGE,
  IN_SCOPE_KEYWORDS,
};
