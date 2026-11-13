/**
 * ============================================================================
 * services/agentTools.js — Agentic ReAct Tool Calling Loop & Built-in Tools
 * ============================================================================
 * Implements:
 *   - Built-in Kirana & retail ledger recovery tools:
 *       1. analyze_excel_dues
 *       2. run_overdue_followup
 *       3. update_single_customer_excel
 *       4. export_excel_report
 *       5. set_daily_schedule
 *       6. mcp_tool_call
 *   - Dynamic injection of MCP tools from mcpManager
 *   - Model-Agnostic ReAct / Tool-Calling Loop (up to 5 iterations)
 * ============================================================================
 */

const excelService = require("./excelService");
const automationEngine = require("./automationEngine");
const { schedulerService } = require("./schedulerService");
const { mcpManager } = require("./mcpManager");
const { convertAmountToBengaliWords } = require("../number-to-words");

/**
 * Built-in agent tool definitions
 */
const BUILT_IN_TOOLS = [
  {
    name: "analyze_excel_dues",
    description: "Reads data/customers.xlsx and returns overdue customers, total pending balance, and credit breakdown.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "run_overdue_followup",
    description: "Executes the autonomous follow-up workflow on overdue customers, classifies Positive/Negative commitments, and updates data/customers.xlsx.",
    parameters: {
      type: "object",
      properties: {
        dryRun: { type: "boolean", description: "If true, simulates without saving to Excel." },
      },
    },
  },
  {
    name: "update_single_customer_excel",
    description: "Updates a specific customer's Reply_Type (Positive/Negative), Commitment_Date, and Mili_Summary in data/customers.xlsx.",
    parameters: {
      type: "object",
      properties: {
        customerIdOrName: { type: "string", description: "Customer ID (e.g. CUST-101) or customer name" },
        replyType: { type: "string", enum: ["Positive", "Negative"], description: "Customer response classification" },
        commitmentDate: { type: "string", description: "Promised payment date in YYYY-MM-DD or N/A" },
        summary: { type: "string", description: "Short outcome summary in Bengali or English" },
      },
      required: ["customerIdOrName", "replyType"],
    },
  },
  {
    name: "export_excel_report",
    description: "Generates the formatted data/Mili_Followup_Report.xlsx with separated Positive_Commitments and Negative_Escalations sheets.",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "set_daily_schedule",
    description: "Configures daily automatic start time (Asia/Kolkata) for Mili's Kirana recovery operations.",
    parameters: {
      type: "object",
      properties: {
        hour: { type: "number", description: "Hour of day in 24h format (0-23)" },
        minute: { type: "number", description: "Minute of hour (0-59)" },
        enabled: { type: "boolean", description: "Enable or disable schedule" },
      },
      required: ["hour", "minute"],
    },
  },
  {
    name: "mcp_tool_call",
    description: "Executes a tool on a connected MCP server for billing, invoicing, accounting, or database recovery tasks.",
    parameters: {
      type: "object",
      properties: {
        serverName: { type: "string", description: "Name of the connected MCP server" },
        toolName: { type: "string", description: "Name of the MCP tool to call" },
        args: { type: "object", description: "Arguments object for the tool" },
      },
      required: ["serverName", "toolName"],
    },
  },
];

/**
 * Executes a tool by name with provided arguments.
 */
async function executeAgentTool(toolName, args = {}) {
  console.log(`🛠️ [agentTools] Executing tool: "${toolName}" with args:`, args);

  switch (toolName) {
    case "analyze_excel_dues": {
      const analysis = await excelService.analyzeCustomers();
      return {
        totalCustomers: analysis.totalCustomers,
        overdueCount: analysis.overdueCount,
        totalOverdueAmount: analysis.totalOverdueAmount,
        totalOverdueAmountWords: convertAmountToBengaliWords(analysis.totalOverdueAmount),
        overdueList: analysis.overdueCustomers.map((c) => ({
          id: c.Customer_ID,
          name: c.Customer_Name,
          due: c.Due_Amount,
          dueDate: c.Due_Date,
          order: c.Order_Details,
          callStatus: c.Call_Status,
        })),
      };
    }

    case "run_overdue_followup": {
      const summary = await automationEngine.runOverdueFollowupWorkflow({
        dryRun: Boolean(args.dryRun),
      });
      return {
        success: true,
        processedCount: summary.processedCount,
        totalOverdueAmount: summary.totalOverdueAmount,
        reportPath: summary.reportStats?.reportFilePath || "data/Mili_Followup_Report.xlsx",
        positiveCount: summary.reportStats?.positiveCount || 0,
        negativeCount: summary.reportStats?.negativeCount || 0,
      };
    }

    case "update_single_customer_excel": {
      const updated = await excelService.updateCustomerOutcome(args.customerIdOrName, {
        replyType: args.replyType,
        commitmentDate: args.commitmentDate || "N/A",
        summary: args.summary || "Follow-up logged via Mili agent",
      });
      if (!updated) {
        return { success: false, message: `Customer '${args.customerIdOrName}' not found.` };
      }
      return { success: true, updatedCustomer: updated };
    }

    case "export_excel_report": {
      const report = await excelService.exportStructuredReport();
      return {
        success: true,
        reportPath: report.reportFilePath,
        positiveCount: report.positiveCount,
        negativeCount: report.negativeCount,
        totalPositiveAmount: report.totalPositiveAmount,
        totalNegativeAmount: report.totalNegativeAmount,
      };
    }

    case "set_daily_schedule": {
      const config = schedulerService.setDailySchedule(
        args.hour,
        args.minute,
        args.enabled !== false
      );
      return {
        success: true,
        timeLabel: config.timeLabel,
        cronExpression: config.cronExpression,
        enabled: config.enabled,
      };
    }

    case "mcp_tool_call": {
      const mcpResult = await mcpManager.executeTool(
        args.serverName,
        args.toolName,
        args.args || {}
      );
      return { success: true, mcpResult };
    }

    default: {
      // Check if it's a direct MCP tool name (e.g. serverName__toolName)
      const allMcp = mcpManager.getAllTools();
      const match = allMcp.find((t) => t.fullName === toolName || t.toolName === toolName);
      if (match) {
        const res = await mcpManager.executeTool(match.serverName, match.toolName, args);
        return { success: true, mcpResult: res };
      }
      throw new Error(`Unknown agent tool: "${toolName}"`);
    }
  }
}

/**
 * Builds the Agentic ReAct System Prompt with tool definitions.
 */
function buildAgenticSystemPrompt() {
  const mcpTools = mcpManager.getAllTools();
  const allTools = [
    ...BUILT_IN_TOOLS,
    ...mcpTools.map((t) => ({
      name: t.fullName,
      description: `[MCP: ${t.serverName}] ${t.description}`,
      parameters: t.inputSchema,
    })),
  ];

  const toolsDoc = allTools
    .map((t) => `- ${t.name}: ${t.description}\n  args: ${JSON.stringify(t.parameters?.properties || {})}`)
    .join("\n");

  return `You are Mili (মিলি), an autonomous AI accounts and debt recovery agent built EXCLUSIVELY for Kirana stores, grocery wholesalers, and retail merchants.
Your exclusive domain is: Kirana billing tracking, customer credit (বাকি) recovery, Excel khata ledger management, and store follow-up scheduling.

AVAILABLE AGENT TOOLS:
${toolsDoc}

TOOL CALLING PROTOCOL (STRICT JSON ONLY):
When the user asks you to inspect Excel data, check overdue balances, run follow-ups, update customer records, export reports, or set a daily schedule, you MUST call the appropriate tool.

To request a tool call, respond with STRICT JSON ONLY:
{
  "type": "tool_call",
  "tool": "<tool_name>",
  "args": { ... }
}

When you have the tool observation and are ready to answer the user, or if it is a general conversation within your credit recovery domain, respond with STRICT JSON ONLY:
{
  "type": "final",
  "reply": "<natural spoken Bengali response, 2-4 sentences max>",
  "emotion": "persuasive" | "empathetic" | "polite" | "reassuring" | "firm"
}

STRICT INSTRUCTION:
Do NOT produce markdown fences (\`\`\`json). Output raw valid JSON only.`;
}

/**
 * Fast deterministic intent matcher for ReAct tool actions.
 * Guarantees zero-hang execution even when remote LLMs throttle or timeout.
 */
function detectIntentToolCall(userMessage) {
  const msg = (userMessage || "").toLowerCase();

  // 1. Analyze / check dues / who owes money
  if (
    msg.includes("কার বাকি") ||
    msg.includes("কত বাকি") ||
    msg.includes("বাকি আছে") ||
    msg.includes("বকেয়া তালিকা") ||
    msg.includes("বকেয়া তালিকা") ||
    msg.includes("ওভারডিউ") ||
    msg.includes("check dues") ||
    msg.includes("check overdue") ||
    msg.includes("analyze excel") ||
    msg.includes("excel check") ||
    msg.includes("কার কত বাকি") ||
    msg.includes("কে কে টাকা দেয়নি") ||
    msg.includes("খাতা দেখাও") ||
    msg.includes("তালিকা দেখাও")
  ) {
    return { tool: "analyze_excel_dues", args: {} };
  }

  // 2. Run follow-up calls / automate recovery
  if (
    msg.includes("ফলোআপ শুরু") ||
    msg.includes("কল করো") ||
    msg.includes("বাকি আদায় শুরু") ||
    msg.includes("বাকি আদায় শুরু") ||
    msg.includes("run followup") ||
    msg.includes("start followup") ||
    msg.includes("recovery শুরু") ||
    msg.includes("সবাইকে ফোন করো") ||
    msg.includes("অটোমেটিক কল")
  ) {
    return { tool: "run_overdue_followup", args: { dryRun: false } };
  }

  // 3. Export Excel report
  if (
    msg.includes("রিপোর্ট তৈরি") ||
    msg.includes("রিপোর্ট দাও") ||
    msg.includes("export report") ||
    msg.includes("generate report") ||
    msg.includes("excel report") ||
    msg.includes("ডাউনলোড রিপোর্ট")
  ) {
    return { tool: "export_excel_report", args: {} };
  }

  // 4. Set daily schedule (e.g., "সকাল ১০টায় শিডিউল করো", "set schedule to 10:30")
  if (msg.includes("শিডিউল") || msg.includes("schedule") || msg.includes("সময় সেট")) {
    let hour = 10;
    let minute = 0;
    const match = msg.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm|টায়|টায়)?/i);
    if (match) {
      let h = parseInt(match[1], 10);
      const m = match[2] ? parseInt(match[2], 10) : 0;
      const ampm = (match[3] || "").toLowerCase();
      if ((ampm === "pm" || ampm.includes("বিকাল") || ampm.includes("সন্ধ্যা")) && h < 12) h += 12;
      hour = h;
      minute = m;
    }
    return { tool: "set_daily_schedule", args: { hour, minute, enabled: true } };
  }

  return null;
}

/**
 * Runs the Multi-Step Agentic ReAct Tool-Calling Loop (up to 5 iterations).
 *
 * @param {string} userMessage - User query
 * @param {Array} history - Previous messages
 * @param {object} context - Customer/shop context
 * @param {function} llmCaller - Async function(messages) returning text
 * @returns {Promise<{ reply: string, emotion: string, toolsUsed: Array }>}
 */
async function runAgenticLoop(userMessage, history = [], context = {}, llmCaller = null) {
  const toolsUsed = [];
  const maxIterations = 5;

  // Step 1: Check fast deterministic intent
  const fastTool = detectIntentToolCall(userMessage);

  if (fastTool) {
    try {
      const toolObservation = await executeAgentTool(fastTool.tool, fastTool.args);
      toolsUsed.push({
        tool: fastTool.tool,
        args: fastTool.args,
        observation: toolObservation,
      });

      // Craft natural Bengali synthesis based on tool observation
      let naturalReply = "";
      let emotion = "persuasive";

      if (fastTool.tool === "analyze_excel_dues") {
        const top = toolObservation.overdueList
          .slice(0, 3)
          .map((c) => `${c.name} (₹${c.due})`)
          .join(", ");
        naturalReply = `দোকানের খাতা ঘেঁটে দেখলাম, মোট ${toolObservation.overdueCount} জন খদ্দেরের কাছে ${toolObservation.totalOverdueAmountWords} (${toolObservation.totalOverdueAmount} টাকা) ওভারডিউ বাকি রয়েছে। এর মধ্যে প্রধান বকেয়া রয়েছে: ${top}। আপনি চাইলে আমি এখনই স্বয়ংক্রিয়ভাবে এদের ফলো-আপ কল শুরু করতে পারি।`;
        emotion = "reassuring";
      } else if (fastTool.tool === "run_overdue_followup") {
        naturalReply = `দোকানের সব ওভারডিউ খদ্দেরদের স্বয়ংক্রিয় ফলো-আপ কল সম্পূর্ণ হয়েছে। মোট ${toolObservation.processedCount} জন খদ্দেরের সাথে কথা বলে ইতিবাচক প্রতিশ্রুতি পাওয়া গেছে ${toolObservation.positiveCount} জনের থেকে এবং বাকী খাতা এক্সেল শিটে আপডেট করা হয়েছে। বিস্তারিত ফলো-আপ রিপোর্ট তৈরি হয়ে গেছে।`;
        emotion = "persuasive";
      } else if (fastTool.tool === "export_excel_report") {
        naturalReply = `আপনার জন্য পজিটিভ পেমেন্ট ও নেগেটিভ এস্কেলেশন আলাদা করে সুন্দর একটি এক্সেল ফলো-আপ রিপোর্ট (Mili_Followup_Report.xlsx) তৈরি করে দিয়েছি। এতে দোকানের দেনা আদায়ের পুরো পরিসংখ্যান সংরক্ষিত আছে।`;
        emotion = "polite";
      } else if (fastTool.tool === "set_daily_schedule") {
        naturalReply = `আপনার দোকানের বাকি আদায়ের জন্য প্রতিদিন ${toolObservation.timeLabel} সময়ে স্বয়ংক্রিয় ফলো-আপ শিডিউল সফলভাবে সেট করা হয়েছে। নির্দিষ্ট সময়ে স্বয়ংক্রিয়ভাবে খাতা চেক করে কাজ শুরু হয়ে যাবে।`;
        emotion = "reassuring";
      }

      return {
        reply: naturalReply,
        emotion,
        toolsUsed,
      };
    } catch (err) {
      console.error(`❌ [agentTools] Fast tool execution error:`, err.message);
    }
  }

  // Step 2: If LLM is provided, attempt autonomous ReAct loop
  if (llmCaller && typeof llmCaller === "function") {
    const systemPrompt = buildAgenticSystemPrompt();
    const workingHistory = [
      { role: "system", content: systemPrompt },
      ...history,
      { role: "user", content: userMessage },
    ];

    for (let iter = 0; iter < maxIterations; iter++) {
      try {
        const rawResponse = await llmCaller(workingHistory);
        let parsed = null;

        try {
          const clean = (rawResponse || "")
            .replace(/```json/gi, "")
            .replace(/```/gi, "")
            .trim();
          parsed = JSON.parse(clean);
        } catch (_e) {
          // If not strict JSON, treat as final text
          if (rawResponse && rawResponse.length > 5) {
            return {
              reply: rawResponse.replace(/[*#_`]/g, "").trim(),
              emotion: "empathetic",
              toolsUsed,
            };
          }
        }

        if (parsed && parsed.type === "tool_call") {
          const obs = await executeAgentTool(parsed.tool, parsed.args || {});
          toolsUsed.push({ tool: parsed.tool, args: parsed.args, observation: obs });

          workingHistory.push({ role: "assistant", content: JSON.stringify(parsed) });
          workingHistory.push({
            role: "user",
            content: `TOOL_OBSERVATION for ${parsed.tool}:\n${JSON.stringify(obs)}\nNow produce the next step or final JSON.`,
          });
          continue; // Loop for next iteration
        }

        if (parsed && (parsed.type === "final" || parsed.reply)) {
          return {
            reply: parsed.reply,
            emotion: parsed.emotion || "empathetic",
            toolsUsed,
          };
        }
      } catch (loopErr) {
        console.warn(`⚠️ [agentTools] ReAct iteration ${iter + 1} issue:`, loopErr.message);
        break;
      }
    }
  }

  // Fallback to debt-recovery conversational synthesis
  const defaultReply = `${context.customerName || "খদ্দের"}বাবু, আপনার বিষয়টি আমি লিখে রাখলাম। আমাদের দোকানের বকেয়া খাতা ও হিসাব মেটানোর বিষয়ে আর কিছু জানতে চাইলে বলুন।`;
  return {
    reply: defaultReply,
    emotion: "empathetic",
    toolsUsed,
  };
}

module.exports = {
  BUILT_IN_TOOLS,
  executeAgentTool,
  runAgenticLoop,
  detectIntentToolCall,
};
