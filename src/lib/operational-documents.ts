export type ProjectCharterData = {
  projectName: string;
  businessCase: string;
  problemStatement: string;
  baselineMetric: string;
  targetMetric: string;
  scopeIn: string[];
  scopeOut: string[];
  team: { role: string; name: string }[];
  milestones: { phase: string; targetDate: string; deliverable: string }[];
  risks: { risk: string; mitigation: string }[];
};

export type A3Data = {
  title: string;
  background: string;
  currentCondition: string;
  problemStatement: string;
  targetCondition: string;
  rootCauseHypotheses: string[];
  countermeasures: { action: string; owner: string; deadline: string }[];
  followUpPlan: string;
};

export type CheckSheetData = {
  title: string;
  facility: string;
  shift: string;
  date: string;
  inspector: string;
  instructions: string;
  categories: { name: string; severity: "Minor" | "Major" | "Critical"; code: string }[];
};

export type DataCollectionTemplate = {
  objective: string;
  fileName: string;
  columns: {
    name: string;
    type: "Text" | "Number" | "Date" | "Category" | "Boolean";
    required: boolean;
    allowedValues?: string;
    description: string;
    example: string;
  }[];
  sampleCsv: string;
};

export type PresetGoal = {
  id: string;
  label: string;
  category: string;
  description: string;
  template: DataCollectionTemplate;
};

export const PRESET_GOALS: PresetGoal[] = [
  {
    id: "warehouse-delays",
    label: "Warehouse Dispatch & Logistics Delays",
    category: "Supply Chain",
    description: "Track dispatch delay reasons, hub locations, and transit bottlenecks.",
    template: {
      objective: "Track dispatch delays across regional distribution hubs",
      fileName: "warehouse-dispatch-delays.csv",
      columns: [
        { name: "dispatch_id", type: "Text", required: true, description: "Unique shipment identifier", example: "DSP-2026-001" },
        { name: "hub_location", type: "Category", required: true, allowedValues: "North, South, East, West", description: "Fulfillment center branch", example: "North" },
        { name: "scheduled_time", type: "Date", required: true, description: "Scheduled dispatch time (YYYY-MM-DD HH:MM)", example: "2026-11-24 08:30" },
        { name: "actual_time", type: "Date", required: true, description: "Actual release timestamp", example: "2026-11-24 09:45" },
        { name: "delay_minutes", type: "Number", required: true, description: "Difference in minutes (calculated or logged)", example: "75" },
        { name: "delay_reason", type: "Category", required: true, allowedValues: "Inventory shortage, Carrier delay, Packaging damage, System outage, Staff shortage", description: "Primary delay classification", example: "Carrier delay" },
        { name: "carrier_name", type: "Category", required: false, allowedValues: "BlueDart, FedEx, DHL, LocalFleet", description: "Assigned delivery partner", example: "FedEx" },
        { name: "shift_supervisor", type: "Text", required: true, description: "Supervisor approving release", example: "M. Kumar" },
      ],
      sampleCsv: `dispatch_id,hub_location,scheduled_time,actual_time,delay_minutes,delay_reason,carrier_name,shift_supervisor
DSP-2026-001,North,2026-11-24 08:30,2026-11-24 09:45,75,Carrier delay,FedEx,M. Kumar
DSP-2026-002,North,2026-11-24 09:00,2026-11-24 09:12,12,Packaging damage,LocalFleet,M. Kumar
DSP-2026-003,South,2026-11-24 09:15,2026-11-24 10:30,75,Inventory shortage,DHL,R. Sharma
DSP-2026-004,East,2026-11-24 10:00,2026-11-24 10:05,5,Carrier delay,BlueDart,S. Patil
DSP-2026-005,West,2026-11-24 10:30,2026-11-24 12:10,100,System outage,FedEx,A. Singh`,
    },
  },
  {
    id: "product-defects",
    label: "Manufacturing & Assembly Defect Log",
    category: "Operations",
    description: "Capture production line non-conformities, defect categories, and root cause tags.",
    template: {
      objective: "Log production line assembly defects and scrap count",
      fileName: "assembly-defect-log.csv",
      columns: [
        { name: "unit_serial_no", type: "Text", required: true, description: "Barcoded item identifier", example: "SN-94812" },
        { name: "line_id", type: "Category", required: true, allowedValues: "Line-A, Line-B, Line-C", description: "Assembly station or line", example: "Line-A" },
        { name: "inspection_timestamp", type: "Date", required: true, description: "Inspection timestamp (YYYY-MM-DD HH:MM)", example: "2026-11-24 11:20" },
        { name: "defect_category", type: "Category", required: true, allowedValues: "Solder bridge, Misalignment, Scratch/Dent, Dimension out-of-spec, Missing component", description: "Standard failure mode classification", example: "Solder bridge" },
        { name: "severity", type: "Category", required: true, allowedValues: "Minor, Major, Critical", description: "Quality impact tier", example: "Major" },
        { name: "disposition", type: "Category", required: true, allowedValues: "Rework, Scrap, Return to vendor, Concession", description: "Material disposition", example: "Rework" },
        { name: "operator_id", type: "Text", required: true, description: "Operator badge number", example: "OP-401" },
      ],
      sampleCsv: `unit_serial_no,line_id,inspection_timestamp,defect_category,severity,disposition,operator_id
SN-94812,Line-A,2026-11-24 11:20,Solder bridge,Major,Rework,OP-401
SN-94813,Line-A,2026-11-24 11:45,Scratch/Dent,Minor,Concession,OP-401
SN-94814,Line-B,2026-11-24 12:10,Dimension out-of-spec,Critical,Scrap,OP-205
SN-94815,Line-C,2026-11-24 13:00,Missing component,Major,Rework,OP-312
SN-94816,Line-B,2026-11-24 14:15,Solder bridge,Major,Rework,OP-205`,
    },
  },
  {
    id: "ecommerce-returns",
    label: "E-Commerce Return Reasons & Restocking",
    category: "Retail / E-Commerce",
    description: "Audit return drivers, product condition, and refund cycle times.",
    template: {
      objective: "Capture customer return reasons and item restocking eligibility",
      fileName: "customer-returns-tracker.csv",
      columns: [
        { name: "return_order_id", type: "Text", required: true, description: "Original order or RMA number", example: "RMA-77401" },
        { name: "customer_id", type: "Text", required: true, description: "Customer account identifier", example: "CUST-8831" },
        { name: "product_category", type: "Category", required: true, allowedValues: "Apparel, Electronics, Home Goods, Footwear", description: "Merchandise category", example: "Footwear" },
        { name: "return_reason", type: "Category", required: true, allowedValues: "Sizing too small, Sizing too large, Damaged in transit, Not as described, Changed mind", description: "Customer-selected reason", example: "Sizing too small" },
        { name: "item_condition", type: "Category", required: true, allowedValues: "Unopened, Like new, Damaged, Used", description: "Physical condition upon warehouse receipt", example: "Like new" },
        { name: "restock_approved", type: "Boolean", required: true, allowedValues: "TRUE, FALSE", description: "Whether unit can be re-listed", example: "TRUE" },
        { name: "refund_amount", type: "Number", required: true, description: "Refund value in account currency", example: "120.00" },
      ],
      sampleCsv: `return_order_id,customer_id,product_category,return_reason,item_condition,restock_approved,refund_amount
RMA-77401,CUST-8831,Footwear,Sizing too small,Like new,TRUE,120.00
RMA-77402,CUST-9921,Apparel,Not as described,Unopened,TRUE,45.50
RMA-77403,CUST-4412,Electronics,Damaged in transit,Damaged,FALSE,299.00
RMA-77404,CUST-1032,Home Goods,Changed mind,Like new,TRUE,85.00
RMA-77405,CUST-5590,Footwear,Sizing too large,Like new,TRUE,140.00`,
    },
  },
  {
    id: "support-sla",
    label: "SaaS Support Ticket SLA & Escalation",
    category: "Customer Success",
    description: "Monitor ticket response SLAs, escalation tiers, and customer satisfaction.",
    template: {
      objective: "Track support ticket resolution times and escalation rates",
      fileName: "support-ticket-sla.csv",
      columns: [
        { name: "ticket_id", type: "Text", required: true, description: "Support ticket ID", example: "TCK-5521" },
        { name: "client_tier", type: "Category", required: true, allowedValues: "Enterprise, Pro, Starter, Free", description: "Account subscription plan", example: "Enterprise" },
        { name: "created_time", type: "Date", required: true, description: "Ticket creation timestamp", example: "2026-11-24 09:00" },
        { name: "first_reply_minutes", type: "Number", required: true, description: "Time to first human response in minutes", example: "14" },
        { name: "resolution_hours", type: "Number", required: true, description: "Total hours until resolution", example: "4.5" },
        { name: "issue_type", type: "Category", required: true, allowedValues: "Bug, Feature Request, Billing, Account Access, Integration", description: "Issue classification", example: "Integration" },
        { name: "escalated_to_eng", type: "Boolean", required: true, allowedValues: "TRUE, FALSE", description: "Whether engineering escalation was required", example: "FALSE" },
        { name: "csat_score", type: "Number", required: false, allowedValues: "1 to 5", description: "Customer satisfaction rating", example: "5" },
      ],
      sampleCsv: `ticket_id,client_tier,created_time,first_reply_minutes,resolution_hours,issue_type,escalated_to_eng,csat_score
TCK-5521,Enterprise,2026-11-24 09:00,14,4.5,Integration,FALSE,5
TCK-5522,Pro,2026-11-24 09:30,45,12.0,Bug,TRUE,3
TCK-5523,Starter,2026-11-24 10:15,120,24.0,Billing,FALSE,4
TCK-5524,Enterprise,2026-11-24 11:00,8,2.0,Account Access,FALSE,5
TCK-5525,Enterprise,2026-11-24 11:30,25,8.0,Integration,TRUE,4`,
    },
  },
];

/**
 * Builds grounded operational documents from an active dataset or table findings.
 */
export function buildDocumentsFromDataset(params: {
  datasetName: string;
  rowCount: number;
  columns: string[];
  qualityScore?: number | null;
  issuesSummary?: string[];
}): {
  charter: ProjectCharterData;
  a3: A3Data;
  checkSheet: CheckSheetData;
  template: DataCollectionTemplate;
} {
  const { datasetName, rowCount, columns, qualityScore, issuesSummary = [] } = params;
  const colList = columns.slice(0, 10).join(", ");
  const metricCol = columns.find((c) => /(revenue|sales|amount|defect|error|delay|time|score|cost)/i.test(c)) ?? columns[0] ?? "Metric";
  const categoryCol = columns.find((c) => /(category|type|status|hub|line|department|region)/i.test(c)) ?? columns[1] ?? "Category";

  const baselineStr = qualityScore !== undefined && qualityScore !== null
    ? `Data Quality: ${qualityScore}/100 across ${rowCount.toLocaleString()} records`
    : `Current record baseline: ${rowCount.toLocaleString()} rows audited`;

  const charter: ProjectCharterData = {
    projectName: `Continuous Improvement: ${datasetName}`,
    businessCase: `Process data in "${datasetName}" reveals operational opportunities across ${rowCount.toLocaleString()} audited records. Standardizing data hygiene and operational tracking will directly prevent reporting drift and workflow delays.`,
    problemStatement: `Analysis of ${datasetName} indicates quality and distribution variance across key operational fields (${colList}). A reliable baseline and governance control are required to ensure continuous performance.`,
    baselineMetric: baselineStr,
    targetMetric: "Target: Achieve > 95/100 quality score and reduce operational exceptions by 30%",
    scopeIn: [
      `Audit and process governance for ${datasetName}`,
      `Tracking key dimensions: ${categoryCol} and ${metricCol}`,
      "Root cause validation with department process leads",
    ],
    scopeOut: [
      "Third-party upstream ERP platform migrations",
      "Unrelated business units not captured in dataset scope",
    ],
    team: [
      { role: "Project Sponsor", name: "Operations Director (To Confirm)" },
      { role: "Project Lead", name: "Process Excellence Lead" },
      { role: "Data Analyst", name: "Continuous Improvement Analyst" },
    ],
    milestones: [
      { phase: "Phase 1: Baseline & Root Cause Validation", targetDate: "Day 15", deliverable: "Verified anomaly audit report" },
      { phase: "Phase 2: Countermeasure Deployment", targetDate: "Day 30", deliverable: "Standardized check sheet & collection SOP" },
      { phase: "Phase 3: Control & Post-Implementation Review", targetDate: "Day 60", deliverable: "Before/After period comparison analysis" },
    ],
    risks: [
      { risk: "Floor compliance with collection protocol", mitigation: "Deploy simplified physical check sheet and weekly audit reviews" },
      { risk: "Inconsistent categorizations across shifts", mitigation: "Mandate predefined allowed categories in collection template" },
    ],
  };

  const a3: A3Data = {
    title: `A3 Problem Solving: ${datasetName} Process Optimization`,
    background: `Operational teams rely on ${datasetName} to monitor workflow efficiency. The dataset contains ${rowCount.toLocaleString()} records across ${columns.length} tracked attributes.`,
    currentCondition: `Current baseline reveals exceptions across tracked dimensions. ${issuesSummary.length > 0 ? `Flagged items include: ${issuesSummary.slice(0, 3).join("; ")}.` : "Variance in recording formats and potential outliers require systematic control."}`,
    problemStatement: `Over ${rowCount.toLocaleString()} records, process inconsistencies in "${categoryCol}" impact operational predictability and reporting fidelity.`,
    targetCondition: "Establish standard operational procedure, zero invalid categories, and under 5% deviation on target metric.",
    rootCauseHypotheses: [
      "Hypothesis 1: Incomplete input validation during initial floor data logging",
      "Hypothesis 2: Lack of standardized shift changeover check sheets",
      "Hypothesis 3: Ambiguous category taxonomy leading to multiple naming conventions",
    ],
    countermeasures: [
      { action: "Implement standardized DataSimplr CSV collection template", owner: "Data Lead", deadline: "Week 2" },
      { action: "Run weekly data quality audit on new batches", owner: "Quality Supervisor", deadline: "Ongoing" },
      { action: "Conduct 15-min shift huddle on category definitions", owner: "Shift Manager", deadline: "Week 3" },
    ],
    followUpPlan: "Review monthly period-over-period trend in DataSimplr and confirm sustainable reduction in anomalies.",
  };

  const checkSheet: CheckSheetData = {
    title: `Physical Inspection & Quality Check Sheet — ${datasetName}`,
    facility: "Primary Facility / Hub",
    shift: "Shift 1 / Shift 2",
    date: new Date().toISOString().split("T")[0]!,
    inspector: "Process Inspector Name",
    instructions: "Make a tally mark (||||) for each occurrence during the observation shift. Review critical items immediately with shift supervisor.",
    categories: [
      { name: `High deviation in ${metricCol}`, severity: "Major", code: "DEF-01" },
      { name: `Invalid or missing ${categoryCol}`, severity: "Minor", code: "DEF-02" },
      { name: "Missing mandatory identifier / timestamp", severity: "Critical", code: "DEF-03" },
      { name: "Unrecognized category or spelling mismatch", severity: "Minor", code: "DEF-04" },
      { name: "Duplicate record entry", severity: "Major", code: "DEF-05" },
    ],
  };

  const template: DataCollectionTemplate = {
    objective: `Standardized operational collection template for ${datasetName}`,
    fileName: `${datasetName.toLowerCase().replace(/[^a-z0-9]/g, "-")}-template.csv`,
    columns: columns.slice(0, 8).map((c) => ({
      name: c,
      type: /(date|time)/i.test(c) ? "Date" : /(price|amount|revenue|cost|count|qty|num)/i.test(c) ? "Number" : "Text",
      required: true,
      description: `Operational attribute for ${c}`,
      example: "Sample value",
    })),
    sampleCsv: `${columns.slice(0, 8).join(",")}\n${columns.slice(0, 8).map(() => "sample_val").join(",")}`,
  };

  return { charter, a3, checkSheet, template };
}
