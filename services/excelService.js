/**
 * ============================================================================
 * services/excelService.js — Excel Automation & Credit Ledger Reporting Engine
 * ============================================================================
 * Manages:
 *   - data/customers.xlsx (Customer_Dues ledger sheet)
 *   - Auto-seed 6 sample Kirana & retail customers if file does not exist
 *   - analyzeCustomers(): Evaluates overdue balances based on today's date
 *   - updateCustomerOutcome(): Records call outcome with color-coded styling
 *   - exportStructuredReport(): Generates data/Mili_Followup_Report.xlsx
 * ============================================================================
 */

const ExcelJS = require("exceljs");
const path = require("path");
const fs = require("fs");

const DATA_DIR = path.resolve(__dirname, "..", "data");
const CUSTOMERS_FILE = path.join(DATA_DIR, "customers.xlsx");
const REPORT_FILE = path.join(DATA_DIR, "Mili_Followup_Report.xlsx");

// Ensure data directory exists
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}

// Columns definition for Customer_Dues
const COL_DEFS = [
  { header: "Customer_ID", key: "Customer_ID", width: 14 },
  { header: "Customer_Name", key: "Customer_Name", width: 20 },
  { header: "Phone", key: "Phone", width: 15 },
  { header: "Order_Details", key: "Order_Details", width: 32 },
  { header: "Due_Amount", key: "Due_Amount", width: 14 },
  { header: "Due_Date", key: "Due_Date", width: 14 },
  { header: "Due_Status", key: "Due_Status", width: 14 },
  { header: "Call_Status", key: "Call_Status", width: 14 },
  { header: "Reply_Type", key: "Reply_Type", width: 14 },
  { header: "Commitment_Date", key: "Commitment_Date", width: 18 },
  { header: "Mili_Summary", key: "Mili_Summary", width: 36 },
  { header: "Last_Updated", key: "Last_Updated", width: 22 },
];

// Mapping of 1-based column indices
const COL_INDEX = {
  Customer_ID: 1,
  Customer_Name: 2,
  Phone: 3,
  Order_Details: 4,
  Due_Amount: 5,
  Due_Date: 6,
  Due_Status: 7,
  Call_Status: 8,
  Reply_Type: 9,
  Commitment_Date: 10,
  Mili_Summary: 11,
  Last_Updated: 12,
};

/**
 * Format headers with professional Navy Blue fill and white text.
 */
function styleHeaderRow(row) {
  row.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: "FFFFFFFF" }, size: 11 };
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF1E3A8A" }, // Deep Navy
    };
    cell.alignment = { vertical: "middle", horizontal: "center" };
    cell.border = {
      top: { style: "thin", color: { argb: "FFCBD5E1" } },
      bottom: { style: "medium", color: { argb: "FF0F172A" } },
      left: { style: "thin", color: { argb: "FFCBD5E1" } },
      right: { style: "thin", color: { argb: "FFCBD5E1" } },
    };
  });
  row.height = 26;
}

/**
 * Auto-seeds initial 6 realistic Kirana & retail customers if workbook doesn't exist.
 */
async function ensureCustomersExcel() {
  if (fs.existsSync(CUSTOMERS_FILE)) {
    return;
  }

  console.log("📊 [excelService] data/customers.xlsx not found. Auto-seeding initial 6 retail customers...");

  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Customer_Dues");
  sheet.columns = COL_DEFS;
  styleHeaderRow(sheet.getRow(1));

  // Dates relative to today
  const today = new Date();
  const pastDate = (days) => {
    const d = new Date(today);
    d.setDate(d.getDate() - days);
    return d.toISOString().slice(0, 10);
  };
  const futureDate = (days) => {
    const d = new Date(today);
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
  };

  const sampleCustomers = [
    {
      Customer_ID: "CUST-101",
      Customer_Name: "Ramesh Babu",
      Phone: "9876543210",
      Order_Details: "Monthly Kirana & Ration Pack",
      Due_Amount: 6000,
      Due_Date: pastDate(5),
      Due_Status: "Overdue",
      Call_Status: "Pending",
      Reply_Type: "Pending",
      Commitment_Date: "N/A",
      Mili_Summary: "Initial credit ledger record",
      Last_Updated: new Date().toISOString(),
    },
    {
      Customer_ID: "CUST-102",
      Customer_Name: "Subrata Mondal",
      Phone: "9876543211",
      Order_Details: "Wholesale Rice & Mustard Oil",
      Due_Amount: 14500,
      Due_Date: pastDate(12),
      Due_Status: "Overdue",
      Call_Status: "Pending",
      Reply_Type: "Pending",
      Commitment_Date: "N/A",
      Mili_Summary: "Second follow-up required",
      Last_Updated: new Date().toISOString(),
    },
    {
      Customer_ID: "CUST-103",
      Customer_Name: "Tapas Das",
      Phone: "9876543212",
      Order_Details: "50 Bags Cement & Hardware Items",
      Due_Amount: 3200,
      Due_Date: pastDate(3),
      Due_Status: "Overdue",
      Call_Status: "Pending",
      Reply_Type: "Pending",
      Commitment_Date: "N/A",
      Mili_Summary: "Awaiting store follow-up",
      Last_Updated: new Date().toISOString(),
    },
    {
      Customer_ID: "CUST-104",
      Customer_Name: "Anwar Hossain",
      Phone: "9876543213",
      Order_Details: "FMCG & Grocery Stock Boxes",
      Due_Amount: 22000,
      Due_Date: pastDate(18),
      Due_Status: "Overdue",
      Call_Status: "Pending",
      Reply_Type: "Pending",
      Commitment_Date: "N/A",
      Mili_Summary: "Large overdue balance",
      Last_Updated: new Date().toISOString(),
    },
    {
      Customer_ID: "CUST-105",
      Customer_Name: "Bikash Jana",
      Phone: "9876543214",
      Order_Details: "Retail Cosmetics & Bath Soap Batch",
      Due_Amount: 0,
      Due_Date: pastDate(1),
      Due_Status: "Paid",
      Call_Status: "Completed",
      Reply_Type: "Positive",
      Commitment_Date: pastDate(1),
      Mili_Summary: "Payment settled in cash",
      Last_Updated: new Date().toISOString(),
    },
    {
      Customer_ID: "CUST-106",
      Customer_Name: "Sanjoy Roy",
      Phone: "9876543215",
      Order_Details: "Bulk Pulses, Spices & Sugar",
      Due_Amount: 8500,
      Due_Date: futureDate(7),
      Due_Status: "Upcoming",
      Call_Status: "Pending",
      Reply_Type: "Pending",
      Commitment_Date: "N/A",
      Mili_Summary: "Scheduled for next week reminder",
      Last_Updated: new Date().toISOString(),
    },
  ];

  sampleCustomers.forEach((c) => sheet.addRow(c));
  await workbook.xlsx.writeFile(CUSTOMERS_FILE);
  console.log(`✅ [excelService] Initial customers workbook created at: ${CUSTOMERS_FILE}`);
}

/**
 * Safely extracts raw string/numeric value from cell.
 */
function getVal(row, colName) {
  const cell = row.getCell(COL_INDEX[colName]);
  if (!cell || cell.value === null || cell.value === undefined) return "";
  if (typeof cell.value === "object" && cell.value.text) return String(cell.value.text);
  return cell.value;
}

/**
 * Analyzes customers in data/customers.xlsx, auto-updates Due_Status,
 * saves updates, and returns overdue summary.
 */
async function analyzeCustomers() {
  await ensureCustomersExcel();

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(CUSTOMERS_FILE);

  const sheet = workbook.getWorksheet("Customer_Dues") || workbook.worksheets[0];
  const todayStr = new Date().toISOString().slice(0, 10);

  const customers = [];
  const overdueCustomers = [];
  let totalOverdueAmount = 0;

  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return; // Skip headers

    const dueAmount = Number(getVal(row, "Due_Amount")) || 0;
    const dueDate = String(getVal(row, "Due_Date")).trim();
    let dueStatus = String(getVal(row, "Due_Status") || "Upcoming").trim();
    const callStatus = String(getVal(row, "Call_Status") || "Pending").trim();
    const replyType = String(getVal(row, "Reply_Type") || "Pending").trim();
    const commitmentDate = String(getVal(row, "Commitment_Date") || "N/A").trim();
    const miliSummary = String(getVal(row, "Mili_Summary") || "").trim();
    const lastUpdated = String(getVal(row, "Last_Updated") || "").trim();

    // Check overdue rule
    if (dueAmount > 0 && dueDate && dueDate <= todayStr) {
      dueStatus = "Overdue";
      row.getCell(COL_INDEX.Due_Status).value = "Overdue";
    } else if (dueAmount <= 0) {
      dueStatus = "Paid";
      row.getCell(COL_INDEX.Due_Status).value = "Paid";
    }

    const record = {
      Customer_ID: String(getVal(row, "Customer_ID")),
      Customer_Name: String(getVal(row, "Customer_Name")),
      Phone: String(getVal(row, "Phone")),
      Order_Details: String(getVal(row, "Order_Details")),
      Due_Amount: dueAmount,
      Due_Date: dueDate,
      Due_Status: dueStatus,
      Call_Status: callStatus,
      Reply_Type: replyType,
      Commitment_Date: commitmentDate,
      Mili_Summary: miliSummary,
      Last_Updated: lastUpdated,
    };

    customers.push(record);

    if (dueStatus === "Overdue") {
      totalOverdueAmount += dueAmount;
      overdueCustomers.push(record);
    }
  });

  await workbook.xlsx.writeFile(CUSTOMERS_FILE);

  return {
    totalCustomers: customers.length,
    overdueCount: overdueCustomers.length,
    totalOverdueAmount,
    overdueCustomers,
    allCustomers: customers,
  };
}

/**
 * Updates a customer's outcome in data/customers.xlsx with color styling:
 * - Positive -> Soft green fill #D1FAE5
 * - Negative -> Soft red fill #FEE2E2
 */
async function updateCustomerOutcome(customerIdOrName, outcome = {}) {
  await ensureCustomersExcel();

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(CUSTOMERS_FILE);

  const sheet = workbook.getWorksheet("Customer_Dues") || workbook.worksheets[0];
  const target = String(customerIdOrName || "").trim().toLowerCase();
  let updatedRecord = null;

  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;

    const id = String(getVal(row, "Customer_ID")).trim().toLowerCase();
    const name = String(getVal(row, "Customer_Name")).trim().toLowerCase();

    if (id === target || name === target || name.includes(target) || target.includes(name)) {
      const replyType = outcome.replyType || "Positive";
      const commitmentDate = outcome.commitmentDate || "N/A";
      const summary = outcome.summary || "Follow-up completed by Mili";

      row.getCell(COL_INDEX.Call_Status).value = "Completed";
      row.getCell(COL_INDEX.Reply_Type).value = replyType;
      row.getCell(COL_INDEX.Commitment_Date).value = commitmentDate;
      row.getCell(COL_INDEX.Mili_Summary).value = summary;
      row.getCell(COL_INDEX.Last_Updated).value = new Date().toISOString();

      // Apply cell styling based on outcome
      const isPositive = String(replyType).toLowerCase().includes("positive");
      const fillColor = isPositive ? "FFD1FAE5" : "FFFEE2E2"; // Soft Green vs Soft Red
      const fontColor = isPositive ? "FF065F46" : "FF991B1B";

      row.eachCell((cell) => {
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: fillColor },
        };
        cell.font = { color: { argb: fontColor } };
      });

      updatedRecord = {
        Customer_ID: getVal(row, "Customer_ID"),
        Customer_Name: getVal(row, "Customer_Name"),
        Due_Amount: Number(getVal(row, "Due_Amount")) || 0,
        Call_Status: "Completed",
        Reply_Type: replyType,
        Commitment_Date: commitmentDate,
        Mili_Summary: summary,
      };
    }
  });

  if (updatedRecord) {
    await workbook.xlsx.writeFile(CUSTOMERS_FILE);
    console.log(`✅ [excelService] Updated customer ${customerIdOrName} -> ${updatedRecord.Reply_Type}`);
  } else {
    console.warn(`⚠️ [excelService] Customer '${customerIdOrName}' not found in Excel.`);
  }

  return updatedRecord;
}

/**
 * Generates data/Mili_Followup_Report.xlsx with separated
 * Positive_Commitments and Negative_Escalations sheets.
 */
async function exportStructuredReport() {
  await ensureCustomersExcel();

  const sourceWorkbook = new ExcelJS.Workbook();
  await sourceWorkbook.xlsx.readFile(CUSTOMERS_FILE);
  const srcSheet = sourceWorkbook.getWorksheet("Customer_Dues") || sourceWorkbook.worksheets[0];

  const reportWorkbook = new ExcelJS.Workbook();
  reportWorkbook.creator = "Mili Autonomous Agent";
  reportWorkbook.created = new Date();

  const positiveSheet = reportWorkbook.addWorksheet("Positive_Commitments");
  positiveSheet.columns = COL_DEFS;
  styleHeaderRow(positiveSheet.getRow(1));

  const negativeSheet = reportWorkbook.addWorksheet("Negative_Escalations");
  negativeSheet.columns = COL_DEFS;
  styleHeaderRow(negativeSheet.getRow(1));

  let positiveCount = 0;
  let negativeCount = 0;
  let totalPositiveAmount = 0;
  let totalNegativeAmount = 0;

  srcSheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;

    const replyType = String(getVal(row, "Reply_Type")).toLowerCase();
    const amount = Number(getVal(row, "Due_Amount")) || 0;

    const rowData = {
      Customer_ID: getVal(row, "Customer_ID"),
      Customer_Name: getVal(row, "Customer_Name"),
      Phone: getVal(row, "Phone"),
      Order_Details: getVal(row, "Order_Details"),
      Due_Amount: amount,
      Due_Date: getVal(row, "Due_Date"),
      Due_Status: getVal(row, "Due_Status"),
      Call_Status: getVal(row, "Call_Status"),
      Reply_Type: getVal(row, "Reply_Type"),
      Commitment_Date: getVal(row, "Commitment_Date"),
      Mili_Summary: getVal(row, "Mili_Summary"),
      Last_Updated: getVal(row, "Last_Updated"),
    };

    if (replyType.includes("positive")) {
      const newRow = positiveSheet.addRow(rowData);
      newRow.eachCell((c) => {
        c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFD1FAE5" } };
        c.font = { color: { argb: "FF065F46" } };
      });
      positiveCount++;
      totalPositiveAmount += amount;
    } else if (replyType.includes("negative")) {
      const newRow = negativeSheet.addRow(rowData);
      newRow.eachCell((c) => {
        c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFEE2E2" } };
        c.font = { color: { argb: "FF991B1B" } };
      });
      negativeCount++;
      totalNegativeAmount += amount;
    }
  });

  await reportWorkbook.xlsx.writeFile(REPORT_FILE);
  console.log(`📊 [excelService] Follow-up report exported to: ${REPORT_FILE}`);

  return {
    reportFilePath: REPORT_FILE,
    positiveCount,
    negativeCount,
    totalPositiveAmount,
    totalNegativeAmount,
    generatedAt: new Date().toISOString(),
  };
}

module.exports = {
  CUSTOMERS_FILE,
  REPORT_FILE,
  ensureCustomersExcel,
  analyzeCustomers,
  updateCustomerOutcome,
  exportStructuredReport,
};
