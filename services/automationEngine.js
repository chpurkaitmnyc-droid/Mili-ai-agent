/**
 * ============================================================================
 * services/automationEngine.js — Autonomous Follow-Up & Outcome Classifier
 * ============================================================================
 * Workflow:
 *   1. Calls excelService.analyzeCustomers() to find overdue customers
 *   2. For each overdue customer (Call_Status !== 'Completed'):
 *      - Generates personalized Bengali reminder tailored to Kirana & retail credit
 *      - Runs simulated customer reaction & Post-Call Outcome Classifier
 *      - Updates row in data/customers.xlsx with green/red styling
 *   3. Calls excelService.exportStructuredReport()
 *   4. Appends to data/automation_logs.json
 * ============================================================================
 */

const fs = require("fs");
const path = require("path");
const excelService = require("./excelService");
const { convertAmountToBengaliWords } = require("../number-to-words");

const DATA_DIR = path.resolve(__dirname, "..", "data");
const LOGS_FILE = path.join(DATA_DIR, "automation_logs.json");

function ensureLogsFile() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(LOGS_FILE)) {
    fs.writeFileSync(LOGS_FILE, JSON.stringify([], null, 2));
  }
}

function appendLog(entry) {
  try {
    ensureLogsFile();
    const logs = JSON.parse(fs.readFileSync(LOGS_FILE, "utf-8") || "[]");
    logs.unshift(entry);
    // Keep last 50 logs
    if (logs.length > 50) logs.length = 50;
    fs.writeFileSync(LOGS_FILE, JSON.stringify(logs, null, 2));
  } catch (e) {
    console.error("❌ [automationEngine] Failed to write log:", e.message);
  }
}

/**
 * Deterministic Post-Call Outcome Classifier.
 * Classifies customer's response into Positive vs Negative, extracts commitment date and summary.
 */
function classifyOutcome(customer, customerReply) {
  const reply = (customerReply || "").toLowerCase();
  const today = new Date();
  const addDays = (n) => {
    const d = new Date(today);
    d.setDate(d.getDate() + n);
    return d.toISOString().slice(0, 10);
  };

  // 1. Positive commitments
  if (
    reply.includes("কাল") ||
    reply.includes("দেব") ||
    reply.includes("দিব") ||
    reply.includes("পরিশোধ") ||
    reply.includes("পাঠিয়ে দিচ্ছি") ||
    reply.includes("পেমেন্ট") ||
    reply.includes("জমা") ||
    reply.includes("pay")
  ) {
    const commitmentDate = reply.includes("কাল") ? addDays(1) : addDays(3);
    return {
      replyType: "Positive",
      commitmentDate,
      summary: `Customer agreed to settle dues by ${commitmentDate}.`,
    };
  }

  // 2. Negative refusal / resistance / disputes
  if (
    reply.includes("দেব না") ||
    reply.includes("দিব না") ||
    reply.includes("টাকা নেই") ||
    reply.includes("পারব না") ||
    reply.includes("ভুল") ||
    reply.includes("চয়ন") ||
    reply.includes("discount") ||
    reply.includes("refuse")
  ) {
    return {
      replyType: "Negative",
      commitmentDate: "N/A",
      summary: "Customer resisted or requested owner escalation. Flagged for review.",
    };
  }

  // 3. Busy / Rescheduled
  if (reply.includes("busy") || reply.includes("ব্যস্ত") || reply.includes("পরে")) {
    return {
      replyType: "Positive",
      commitmentDate: addDays(2),
      summary: "Customer was busy, rescheduled reminder for 2 days later.",
    };
  }

  // Default
  return {
    replyType: "Positive",
    commitmentDate: addDays(4),
    summary: `Reminder delivered for ${customer.Due_Amount} INR. Follow-up logged.`,
  };
}

/**
 * Executes autonomous Kirana overdue follow-up workflow.
 *
 * @param {object} options
 * @param {boolean} [options.dryRun=false]
 * @returns {Promise<object>} Complete run summary
 */
async function runOverdueFollowupWorkflow(options = {}) {
  const { dryRun = false } = options;
  const startTime = Date.now();
  console.log(`\n🤖 [automationEngine] Starting Overdue Follow-up Workflow (dryRun: ${dryRun})...`);

  // Step 1: Analyze customers from Excel
  const analysis = await excelService.analyzeCustomers();
  const overduePending = analysis.overdueCustomers.filter(
    (c) => String(c.Call_Status).trim().toLowerCase() !== "completed"
  );

  console.log(`📋 [automationEngine] Overdue total: ₹${analysis.totalOverdueAmount} across ${analysis.overdueCount} customer(s).`);
  console.log(`📞 [automationEngine] Pending follow-up calls: ${overduePending.length}`);

  const processedCustomers = [];

  // Step 2 & 3: For each overdue customer, run reminder & outcome classification
  for (const customer of overduePending) {
    const amountWords = convertAmountToBengaliWords(customer.Due_Amount);

    // Mili's personalized opening reminder
    const miliReminder = `নমস্কার ${customer.Customer_Name}বাবু, আমি মায়ের আশীর্বাদ স্টোর থেকে মিলি বলছি। আপনার ${customer.Order_Details}-এর জন্য বকেয়া ${amountWords} (${customer.Due_Amount} টাকা) বাকি রয়েছে। আশা করি হিসাবটি দ্রুত পরিশোধ করে সহযোগিতা করবেন।`;

    // Simulated realistic customer interaction (in live phone calls, this comes from STT)
    let simulatedCustomerReply = "আমি কালকে টাকাটা দোকানে পাঠিয়ে দিচ্ছি।";
    if (customer.Due_Amount > 15000) {
      simulatedCustomerReply = "আমার এখন এত টাকা নেই, আমি এখনই সম্পূর্ণ টাকা দিতে পারব না।";
    } else if (customer.Customer_Name.includes("Subrata")) {
      simulatedCustomerReply = "দাদা একটু সময় দিন, সামনের সোমবারে দিয়ে দেব।";
    }

    // Outcome classification
    const outcome = classifyOutcome(customer, simulatedCustomerReply);

    console.log(`   👤 ${customer.Customer_Name} (₹${customer.Due_Amount}) -> Classified: [${outcome.replyType}] Commitment: ${outcome.commitmentDate}`);

    if (!dryRun) {
      // Step 4: Write outcome to Excel
      await excelService.updateCustomerOutcome(customer.Customer_ID, outcome);
    }

    processedCustomers.push({
      customerId: customer.Customer_ID,
      customerName: customer.Customer_Name,
      dueAmount: customer.Due_Amount,
      phone: customer.Phone,
      miliReminder,
      customerReply: simulatedCustomerReply,
      outcome,
    });
  }

  // Step 5: Export structured positive/negative report
  let reportStats = null;
  if (!dryRun) {
    reportStats = await excelService.exportStructuredReport();
  }

  const durationMs = Date.now() - startTime;
  const resultSummary = {
    workflow: "Overdue Followup",
    timestamp: new Date().toISOString(),
    dryRun,
    durationMs,
    totalOverdueCustomers: analysis.overdueCount,
    processedCount: processedCustomers.length,
    totalOverdueAmount: analysis.totalOverdueAmount,
    reportStats,
    processedCustomers,
  };

  // Step 6: Append to logs
  appendLog(resultSummary);
  console.log(`✅ [automationEngine] Workflow completed in ${durationMs}ms. Report generated.\n`);

  return resultSummary;
}

module.exports = {
  runOverdueFollowupWorkflow,
  classifyOutcome,
  LOGS_FILE,
};
