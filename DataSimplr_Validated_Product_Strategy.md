# DataSimplr — Validated Product Strategy & Development Roadmap

**Document type:** Product strategy, problem statement, capability roadmap, and architecture principles  
**Product:** DataSimplr  
**Status:** Validated working strategy  
**Audience:** Product owner, Claude Code, Antigravity, Grok Build, Lovable, and engineering collaborators

---

## 1. Executive Summary

**DataSimplr helps business users turn messy spreadsheets into trustworthy analysis and practical action.**

It connects four activities that are often separated across spreadsheets, data-cleaning tools, notebooks, and document templates:

1. **Prepare data** — identify actual tables, profile columns, detect quality problems, and safely clean records.
2. **Understand data** — run statistical and analytical operations without requiring users to write code.
3. **Ask questions** — let users ask questions in plain English while deterministic tools perform the calculations.
4. **Turn findings into action** — create executive briefs, project charters, check sheets, A3 drafts, and data-collection templates from verified findings.

### Recommended positioning

> **Clean your data. Ask better questions. Turn findings into action.**

DataSimplr should feel approachable to a business user while retaining enough transparency and analytical depth for an experienced analyst.

### Product principle

> **AI interprets the question; the data engine performs the calculation; the user can inspect how the result was produced.**

The product must not claim that an LLM independently calculates or verifies data. Numerical results should come from deterministic, testable operations against the selected dataset and version.

---

## 2. Validation of the Original Proposal

The original strategy has a strong product direction. The following refinements are necessary before using it as public positioning or as an engineering specification.

| Original claim or idea | Validation | Recommended wording or action |
|---|---|---|
| “Zero data leaving your machine” | **Not accurate for the current saved-workspace model.** Original and finalized dataset files are persisted in Lovable Cloud-managed storage. | Say supported analysis can run in the browser after a file is loaded. Disclose cloud storage and any data sent to an AI provider. |
| “Zero-hallucination AI” | **Too absolute.** Deterministic calculations reduce arithmetic errors, but AI explanations can still be incomplete or incorrect. | Use “calculation-grounded AI” or “verifiable analysis.” Show the operation, dataset version, filters, and result. |
| “Spreadsheets freeze above 50K–100K rows” | Depends on workbook complexity, formulas, device memory, spreadsheet product, and browser. It is too broad as a universal fact. | Describe spreadsheet performance limits as a pain point, not a fixed row threshold. Benchmark DataSimplr against actual files. |
| “Instant analysis in seconds” | Not a safe promise for every file or operation. Upload, parsing, profiling, and complex analysis have different costs. | Use staged progress and publish measured performance ranges only after testing. |
| “No signup, instant quality scores and executive takeaways” | Possible for a client-side trial experience, but not the same as a saved, cross-device workspace. | Separate a temporary local “Try DataSimplr” mode from authenticated, cloud-persisted “My Datasets.” |
| “All heavy calculations run through Pyodide” | Pyodide is useful for browser Python, but should not automatically be the engine for every large-data operation. Browser memory and responsiveness remain constraints. | Use the most suitable engine per operation. Evaluate DuckDB-Wasm/Arrow for large tabular scans and aggregations; retain Pyodide for user Python and selected analytical workflows. |
| “HIPAA, GDPR, and SOC 2 privacy proposition” | These are legal, contractual, and/or assurance obligations—not automatic properties of browser computation or Supabase. | Do not claim HIPAA support, GDPR compliance, or SOC 2 certification without the required legal review, contractual arrangements, controls, and independent assurance. |
| “AI discovers root causes” | Data can show patterns and associations; it does not by itself prove operational root cause. | Label AI-generated root causes as hypotheses requiring validation. |
| “Regression identifies churn predictors” | Regression alone does not define a valid churn model. Outcome type, feature design, validation, leakage controls, and model evaluation matter. | Describe this as an advanced predictive-analysis workflow only when implemented and validated. |
| “P-values, R-squared, and feature importance” | These should not be advertised unless the relevant statistical methods, assumptions, diagnostics, and interpretations are actually implemented. | Expose only validated metrics, with short explanations and limitations. |

### Current product/architecture baseline

Based on the project audits and implementation reports supplied so far, DataSimplr currently uses:

- TanStack Start and React
- Lovable Cloud-managed backend services built around PostgreSQL, authentication, and storage
- Supabase-style database and Storage security/RLS patterns
- Cloudflare Workers in the application architecture
- Pyodide/WASM for browser-based PythonLab
- Existing analysis functions in `src/lib/analysis.ts`
- Persistent datasets and dataset versions
- Data-quality and cleaning workspace functionality
- Cleaning logs and finalization

**Important:** Lovable Cloud is the managed backend in this project. Do not describe it as a separately owned Supabase project unless the deployment configuration is later changed and verified.

Phase 1 and Phase 2 have been reported as deployed. The 541,909-row large-dataset limitation remains a key engineering benchmark and must be addressed before making broad large-data claims.

---

## 3. Core Problem Statement

> Business operators, product teams, founders, and operations professionals have valuable data in spreadsheets, but extracting trustworthy insight and converting it into action often requires manual spreadsheet work or specialist data skills.

### Key pain points

#### 3.1 Spreadsheet friction

- Files downloaded from marketplaces, ERP tools, accounting systems, advertising platforms, and internal reports are often structurally messy.
- Report titles, notes, merged cells, repeated headers, subtotals, blank rows, and multiple tables can confuse analysis tools.
- Large files may load slowly or overwhelm browser memory when converted into large JavaScript object collections.
- Statistical analysis and repeatable cleaning often require manual formulas or specialist tools.

Avoid claiming that all spreadsheet products fail at a particular row count. The practical issue is that performance and analytical capability vary with file shape, formulas, features, and device resources.

#### 3.2 The notebook barrier

- Python and R provide powerful analysis capabilities, but users may not know how to install packages, write code, or troubleshoot environments.
- Analysts need a guided route from a question to a reproducible calculation.
- Users who do know Python should still have access to PythonLab rather than being restricted to simplified wizards.

#### 3.3 Trust, privacy, and AI accuracy

- Users need to understand where their files are stored, where calculations run, and what information is sent to an AI provider.
- LLMs should not be relied on as the calculator for large datasets.
- Answers need to be traceable to the dataset version, columns, filters, aggregation, and execution method.
- Sensitive data needs appropriate access control, retention, deletion, and vendor review.

#### 3.4 The execution gap

- Finding an anomaly or performance decline does not automatically create an improvement project.
- Teams need structured ways to define a problem, establish a baseline, collect additional evidence, assign actions, and measure results.
- Before data collection begins, teams need useful templates with well-defined fields, formats, and validation rules.

---

## 4. Product Vision and Value Proposition

### Product vision

**DataSimplr is an approachable data preparation, analysis, and execution workspace for people who need reliable answers from business data.**

It should combine the simplicity of asking a question with the discipline of a reproducible analytical workflow.

### Core pillars

#### Pillar 1 — Data preparation and quality

- Detect the actual tabular region in downloaded files.
- Identify headers and distinguish data from report metadata.
- Detect blank rows/columns, repeated headers, notes, totals, and possible multiple tables.
- Profile columns and types.
- Find missing values, duplicates, inconsistent categories, invalid values, and potential outliers.
- Preview corrections before applying them.
- Preserve the original file and record every applied transformation.
- Produce a finalized, versioned dataset.

#### Pillar 2 — Deterministic analysis

- Use tested calculations for descriptive statistics, groupings, trends, correlations, and supported models.
- Separate exact full-dataset calculations from sample-based analysis.
- Explain model assumptions and limitations.
- Store the analysis method and the dataset version used.

#### Pillar 3 — AI-assisted interpretation

- Accept questions in everyday language.
- Convert questions into a constrained analysis plan.
- Validate the plan against available sheets, columns, types, and permissions.
- Execute calculations using the data engine.
- Return compact, verified results to the AI for explanation.
- Let users inspect the operation behind each answer.

#### Pillar 4 — From insights to action

- Generate executive briefs and operational documents from verified results.
- Distinguish observed facts from possible explanations and recommendations.
- Provide editable, reusable output templates.
- Support export to Markdown, CSV/XLSX, and PDF where implemented.

---

## 5. Privacy and Processing Model — Make the Promise Accurate

Privacy should be a product strength, but DataSimplr must accurately describe its data flows.

### 5.1 Current saved-workspace model

Based on the implementation reports:

1. A user uploads a file to DataSimplr.
2. The original and finalized dataset files are stored in the application's private Lovable Cloud-managed Storage.
3. Dataset metadata, ownership, versions, and cleaning records are stored in the managed PostgreSQL backend.
4. Supported browser-side analysis may load data into the user's browser for computation.
5. AI features may send a question and selected metadata, summaries, samples, or computed results to the configured model service, depending on the implementation.

Therefore, do **not** claim that no data ever leaves the user's machine.

### 5.2 Recommended future processing modes

**Saved Workspace Mode**

- User signs in.
- Files are stored in the user's private DataSimplr workspace.
- User can retrieve files across sessions and devices.
- Browser-side processing can be used for supported analysis.
- AI data-sharing behavior is disclosed clearly.

**Local Trial Mode — future capability**

- User selects a file and processes it in the browser.
- No permanent dataset is saved to the account unless the user opts in.
- No raw rows are sent to an AI service by default.
- AI assistance, if offered, must disclose exactly what summary or sample information is transmitted.
- The user is told that the temporary session may be lost when the tab closes.

Do not present Local Trial Mode as implemented until it is built and tested.

### 5.3 Security and compliance guardrails

- Use private storage and authenticated access controls.
- Enforce dataset ownership on every read, write, download, and analysis request.
- Never expose service-role or secret keys in browser code.
- Provide deletion and retention behavior that matches the actual backend.
- Document subprocessors and AI-provider data flows.
- Avoid collecting more personal information than needed.
- Do not market HIPAA support until the relevant service providers, contractual BAA requirements, risk analysis, and safeguards have been reviewed. HHS states that cloud providers handling ePHI on behalf of a covered entity/business associate generally require a HIPAA-compliant BAA and compliance with applicable HIPAA Rules.
- Do not claim GDPR compliance merely because data can be processed in a browser. Controller/processor roles, contracts, lawful basis, rights handling, retention, security, and international transfers must be assessed.
- Do not claim SOC 2 certification without the applicable independent examination/report and scope.

**Customer-facing wording to use for now:**

> DataSimplr uses access-controlled workspace storage and browser-based analysis for supported workflows. Review the product's privacy notice for details about file storage, AI processing, retention, and deletion.

This wording should be finalized only after the live data flows and vendor terms have been checked.

---

## 6. Target Personas and Initial Market Focus

The personas are useful, but the first release should avoid trying to serve every market equally.

### Persona A — SMB founder / business operator

**Profile:** Founder, e-commerce owner, agency lead, or small-business manager.

**Typical workflow:** Exports sales, orders, advertising, payments, or customer data.

**Need:** Quickly understand what changed, where performance is strongest/weakest, and what action to take.

**High-value features:**

- First-read upload summary
- Ask Your Data
- Period-over-period comparison
- Executive brief
- Exportable charts and reports

### Persona B — Operations / continuous-improvement lead

**Profile:** Operations manager, quality lead, process excellence professional, logistics manager.

**Typical workflow:** Reviews defect, delivery, cycle-time, audit, service, and process-performance data.

**Need:** Identify gaps, establish a baseline, structure an improvement effort, and collect better data.

**High-value features:**

- Data quality and cleaning
- Trend and segment analysis
- Outlier review
- Project charter generator
- Check-sheet generator
- A3 draft and action tracker

### Persona C — Citizen analyst / junior analyst

**Profile:** Marketing manager, product analyst, finance analyst, or operations analyst.

**Typical workflow:** Runs recurring analysis and prepares results for stakeholders.

**Need:** Statistical tools without spending time building every analysis from scratch.

**High-value features:**

- Guided statistical analysis
- Correlation and regression
- Segmentation
- PythonLab
- Reproducible analysis history
- Interactive chart and pivot builder

Only expose advanced statistical outputs when the method and assumptions are implemented and documented.

### Persona D — Privacy-conscious professional

**Profile:** Professional handling customer, employee, financial, or proprietary business records.

**Need:** Understand where data is stored, who can access it, and what is shared with AI providers.

**High-value features:**

- Clear data-flow disclosure
- Private workspace storage
- Ownership and access controls
- Configurable AI data minimization
- Retention and deletion controls
- Future local-only mode

Do not target regulated healthcare or financial data with compliance claims until the necessary controls and contractual requirements have been independently reviewed.

### Recommended initial beachhead

Prioritize **SMB business operators and operational/continuous-improvement professionals**.

They have clear spreadsheet pain, repeatable use cases, and direct value from cleaning, analysis, and operational document generation. Broader enterprise and regulated-industry positioning can follow after security and compliance maturity.

---

## 7. Core User Journey

DataSimplr should provide one coherent journey:

```text
Upload or select a saved dataset
           ↓
Inspect workbook / detect tables
           ↓
Profile data and identify quality issues
           ↓
Review and apply cleaning actions
           ↓
Finalize and version the dataset
           ↓
Ask questions / run analysis / use PythonLab
           ↓
Save reproducible analysis
           ↓
Create an executive or operational artifact
           ↓
Export or securely share
```

The user must be able to return to a saved dataset later and continue working without uploading it again.

### Dataset as the central product object

Each saved dataset should retain:

- Owner and dataset identity
- Original file reference
- Finalized file/version references
- File type, size, row count, and column count
- Sheet/table identity
- Schema signature
- Structural-detection result
- Quality report
- Cleaning history
- Analysis sessions and saved results
- Created/updated dates

Every analysis must identify the dataset version and sheet/table used.

---

## 8. Data Preparation and Cleaning Strategy

This should remain a major differentiator.

### 8.1 Structural and raw-table detection

Before statistical quality checks, detect the actual data region.

Potential non-data content includes:

- Report titles and company names
- Generated dates and filter parameters
- Merged title cells
- Blank separator rows/columns
- Notes and footnotes
- Repeated headers
- Totals and subtotals
- Pagination artifacts
- Multiple unrelated tables on one worksheet

The system should show:

- Candidate table region
- Detected header row
- Excluded row/column ranges
- Reasons for exclusions
- Confidence or ambiguity
- Before/after preview

Do not automatically merge separate tables.

Do not remove a row solely because it contains the word “Total”; use position, structure, and surrounding values.

### 8.2 Quality detection

Include:

- Missing-value count and percentage
- Exact duplicate rows
- Duplicate identifiers
- Potential near-duplicates
- Type inconsistencies
- Invalid dates and numeric values
- Category inconsistency
- Empty and constant columns
- Potential outliers using more than one suitable method
- User-defined business-rule violations

### 8.3 Safe cleaning

For each proposed fix, show:

- Issue description
- Affected rows and column
- Count of affected records
- Current value(s)
- Suggested transformation
- Reason
- Preview
- Apply / Ignore / Customize actions

Examples:

- Trim whitespace
- Standardize date formats
- Normalize known casing differences
- Map confirmed equivalent categories
- Remove confirmed duplicates
- Impute missing values using a chosen method
- Cap or replace outliers only with explicit approval
- Exclude non-data structural rows

An outlier is not automatically an error. A missing value should not automatically become zero. A similar-looking category should not automatically be merged if its meaning is ambiguous.

### 8.4 Cleaning history and reproducibility

Record each operation, including structural exclusions:

- Dataset/version ID
- Operation
- Row/column reference
- Original and new value or exclusion range
- Reason
- User approval
- Timestamp

Provide version restore and undo where supported. Preserve the original upload.

---

## 9. Large Dataset Strategy

The 541,909-row `ecommerce-recommendation.csv` benchmark exposed a real constraint. Large-dataset support must be designed and measured, not promised by row count alone.

### 9.1 Key principle

**Do not make the browser hold and render every record as a JavaScript object just to profile or query a dataset.**

The system should distinguish:

- File upload and persistence
- Schema and structure detection
- Analytical query execution
- Preview rendering
- Statistical/model operations
- AI explanation

These have different resource requirements.

### 9.2 Candidate technology

Evaluate **DuckDB-Wasm** and **Apache Arrow** for large tabular analysis.

- DuckDB-Wasm can run analytical SQL in the browser and read formats including CSV and Parquet.
- Arrow provides a columnar representation useful for analytical data processing and interchange.
- Pyodide remains useful for PythonLab and selected Python workloads; it should not automatically be the only engine for large-file aggregation.

Do not assume DuckDB-Wasm can process unlimited data. Browser memory limits, threading configuration, file access path, and operation shape matter. DuckDB's own documentation describes WebAssembly memory constraints and recommends streaming results and reading only required columns/rows where possible.

### 9.3 Recommended execution paths

```text
                     Dataset
                        │
              ┌─────────┴─────────┐
              │                   │
        Standard path        Large-data path
        existing engine      DuckDB-Wasm/Arrow
              │                   │
              └─────────┬─────────┘
                        ↓
                Common result contract
                        ↓
          Analyzer / Chat / Charts / PythonLab
```

Use the current engine for datasets it handles well. Route larger or more expensive operations through the optimized path after profiling and benchmarking.

### 9.4 Large-data requirements

- Use pagination or virtualization for previews.
- Do not materialize a full query result when only a summary is required.
- Use column projection and filters.
- Stream or page large results.
- Avoid repeated parsing of the same file.
- Run long computations away from the main UI thread where supported.
- Show progress and allow cancellation where technically feasible.
- Make resource limits configurable.
- Return compact results to AI services.
- Do not send the full 541,909-row file to an LLM.

### 9.5 Sampling policy

Use exact full-dataset calculations whenever practical.

For algorithms that require sampling or are too expensive to run over all rows:

- State that sampling was used.
- Show sample size and method.
- Do not present a sample-based result as a full-data result.
- Allow users to choose or inspect the sample where appropriate.

### 9.6 Benchmark before marketing

Benchmark representative files at progressively larger sizes, including:

- 100K rows
- 250K rows
- 500K rows
- 541,909 rows
- 750K rows
- 1M rows

Measure file size, upload time, load/parse time, profile time, quality-scan time, query time, browser responsiveness, failures, and memory observations.

Test realistic column widths and high-cardinality text fields, not only narrow numeric tables.

Test supported browsers and at least one lower-memory device.

Do not publish “unlimited data” or “tested up to one million rows” until the exact capability has passed repeatable tests.

### 9.7 XLSX versus CSV

Start with large CSV support. XLSX has extra complexity:

- multiple sheets
- formatting
- merged cells
- formulas
- hidden rows/columns
- workbook relationships
- multiple tables

Support large XLSX only after the ingestion and multi-sheet behavior have been benchmarked separately.

---

## 10. Ask Your Data — Plain-English Analysis

This should be a flagship capability.

### User experience

The user asks:

- Which region fell behind last quarter?
- What are the top five products by revenue?
- Which country generated the most sales?
- Did returns increase month over month?
- Are there unusual transactions?

The user does not need to know SQL, group-by syntax, or Python.

### Execution architecture

```text
User question
     ↓
AI planning layer
     ↓
Constrained structured analysis plan
     ↓
Validate against dataset schema and permissions
     ↓
Deterministic DataSimplr engine
     ↓
Verified result
     ↓
AI explanation
```

### Rules

- The AI proposes the operation; it does not invent the calculation.
- Validate every requested column against the selected sheet/table.
- Validate metric and aggregation compatibility.
- Validate the authenticated user's access to the dataset/version.
- Use the selected finalized version unless the user explicitly chooses another.
- Record the plan, filters, dataset version, sheet, and result metadata.
- If the request is ambiguous, ask a concise clarification.
- If a field is absent, say so rather than inventing it.

### Transparent plan chip

Show a compact, understandable description of the operation, for example:

`Group by Region · Sum Revenue · Q3 vs Q2`

Advanced users may inspect or edit the plan. Casual users can ignore it.

### Follow-up questions

Maintain the active dataset and analysis context across follow-up messages.

Example:

1. “Which region fell behind?”
2. “What product contributed most to that decline?”
3. “Show the monthly trend for that product.”

Each question should create a validated operation against the same dataset context.

---

## 11. Cleaning Copilot

The Cleaning Copilot should complement—not replace—the deterministic quality engine.

### Workflow

```text
Quality engine detects issue
          ↓
AI receives issue metadata and safe sample
          ↓
AI proposes countable transformation
          ↓
DataSimplr validates transformation
          ↓
User previews and approves
          ↓
Data engine applies transformation
          ↓
Cleaning log records the change
```

Examples:

- “Standardize 2,431 dates to YYYY-MM-DD.”
- “Trim leading/trailing spaces in 84 customer names.”
- “Map these three confirmed status spellings to Active.”
- “Fill missing values in this numeric field using the median.”
- “Review 17 unusually high unit prices.”

The AI must not directly rewrite the file or silently change records.

---

## 12. First-Read Coach

The first-read experience should remove the blank-page problem.

After a file has been profiled, show a concise summary such as:

> This appears to be an order-level sales dataset with 24,532 records, 18 columns, and dates covering January through August. We found three data-quality issues worth reviewing.

Then suggest three useful questions based on the actual schema and available analytical operations:

- Which category generated the most revenue?
- How did monthly sales change?
- Which records need review?

Each question should run through the same validated analysis-plan system used by Ask Your Data.

Do not invent business context from column names alone. Label inferred table descriptions as suggestions when confidence is limited.

---

## 13. Executive Brief Generator

Turn an analysis into a concise, shareable output.

### Recommended structure

1. **Headline / verdict** — one sentence supported by the results.
2. **Key findings** — three to five findings, each led by a verified metric.
3. **What changed** — comparison with a defined baseline or period.
4. **What may explain it** — clearly labelled observations or hypotheses.
5. **Recommended next step** — an action linked to the evidence.
6. **Method and scope** — dataset, version, date range, filters, exclusions, and whether sampling was used.

### Output options

- Printable report
- PDF
- Markdown
- Shareable read-only report, once access controls are implemented

### Accuracy rules

- Use only verified metrics supplied by the analysis engine.
- Do not invent causes.
- Distinguish fact, observation, hypothesis, and recommendation.
- Make the reporting period and denominator explicit.
- Show the source dataset and version.
- Provide charts only when they help explain the finding.

---

## 14. Operational Document and Template Generation

This is a useful differentiator, particularly for operations and continuous-improvement users.

Offer two modes.

### Mode 1 — Context-aware generation from findings

#### Project charter

Use verified analysis results to populate:

- Problem statement
- Business case
- Baseline metric
- Target metric (user-confirmed)
- Scope and exclusions
- Stakeholders/owners
- Timeline and assumptions
- Risks and open questions

Do not invent target improvements or financial benefits. Ask users to confirm targets and ownership.

#### Inspection / defect check sheet

Generate:

- Defect categories
- Location / shift / date fields
- Count fields
- Clear instructions
- Optional severity field
- Printable layout

Ensure categories are based on supplied data or explicitly user-defined assumptions.

#### A3 problem-solving draft

Structure:

- Background
- Current condition
- Problem statement
- Evidence
- Potential causes
- Root-cause validation plan
- Countermeasure options
- Follow-up measures

**Important:** AI-generated 5 Whys and root-cause statements are hypotheses, not proven causes. Require user validation and evidence before marking a cause as confirmed.

#### SOP / checklist draft

Generate a practical procedure from user requirements and verified process information. Label unverified steps and assumptions.

### Mode 2 — Proactive generation before data exists

The user describes a goal, for example:

> Track warehouse dispatch delays across four distribution hubs.

Generate:

1. A field check sheet.
2. A starter CSV/XLSX data-collection template.
3. Column names and descriptions.
4. Expected data types.
5. Required/optional indicators.
6. Allowed values and validation rules.
7. Example rows clearly labelled as samples.
8. A short data dictionary explaining how to fill it in.

The goal is to improve the quality of data collected from the beginning.

---

## 15. Period-over-Period Comparison

Allow users to compare two saved files or two periods from one dataset.

Examples:

- Q2 sales versus Q3 sales
- Last month versus this month
- Before-cleaning versus after-cleaning
- Campaign A versus Campaign B

### Required workflow

1. Inspect both datasets.
2. Compare schemas.
3. Identify matching dimensions and metrics.
4. Suggest column mappings if names differ.
5. Confirm date ranges and filters.
6. Check units, currency, timezone, and granularity where relevant.
7. Identify records that appear only in one dataset.
8. Compute differences and percentage changes deterministically.
9. Explain which segments contributed to the change.

Do not compare incompatible metrics without warning. Keep both source datasets unchanged.

---

## 16. Conversational Chart and Pivot Builder

Let users request charts in natural language:

- “Show monthly revenue by region.”
- “Compare return rates across product categories.”
- “Plot advertising spend against conversions.”
- “Show the top ten customers by lifetime value.”

The system should:

1. Convert the request into a validated chart/aggregation plan.
2. Execute the calculation against the selected dataset.
3. Choose a suitable chart type.
4. Render a usable chart with labels, units, filters, and source metadata.
5. Let users change dimensions, measures, and chart type.
6. Export the chart or include it in an executive brief.

Charts must not imply a relationship or causal conclusion that the underlying analysis does not support.

---

## 17. Historical Analysis Memory

Build this after saved datasets and analyses are stable.

Store compact, structured digests—not entire datasets or unrestricted chat transcripts.

A digest may contain:

- Analysis question
- Dataset ID and version
- Sheet/table
- Schema signature
- Date range
- Filters and operation
- Headline metrics
- Created date
- Link to the saved analysis

When the user asks for a historical comparison:

1. Find relevant prior analyses using dataset identity/schema and time period.
2. Retrieve only the small number of relevant digests.
3. Show the source analysis and dataset version.
4. Allow the user to open the original result.
5. Recompute from the source dataset when an exact new calculation is required.

Memory must respect ownership, deletion, retention, and workspace boundaries.

---

## 18. Sharing and Growth Features

### Secure read-only reports

A shareable report must be:

- Private by default
- Explicitly shared by the dataset owner
- Read-only
- Revocable
- Optionally password-protected
- Optionally time-limited
- Redacted where appropriate
- Independent of access to the underlying raw dataset unless explicitly granted

Do not expose original rows, private storage paths, or hidden metadata through a report link.

### Sample gallery

Provide ready-to-use sample datasets and walkthroughs:

- E-commerce sales
- SaaS churn
- Marketing performance
- Six Sigma defect tracking
- Customer segmentation
- Delivery performance

Each sample should include suggested questions and expected example outputs.

### “Calculated with DataSimplr” attribution

Use subtle branding on exported reports and templates. Allow paid or enterprise plans to configure branding later, if commercially appropriate.

---

## 19. Recommended Product Roadmap

The roadmap below reflects the actual product state and the known large-dataset constraint.

| Phase | Initiative | Priority | Outcome |
|---|---|---:|---|
| 1 | Persistent datasets | Reported complete | Users can save and retrieve original datasets across sessions. |
| 2 | Data quality, cleaning, versioning | Reported complete | Users can inspect, clean, finalize, and retrieve versioned datasets. |
| 3 | Large Dataset Engine | **Critical next** | Reliable processing and measured support for the 541,909-row benchmark. |
| 4 | Ask Your Data | **Very high** | Natural-language questions executed by deterministic tools. |
| 5 | Cleaning Copilot + First-Read Coach | High | Faster onboarding and guided, approved cleaning actions. |
| 6 | Executive Brief + Chart Builder | High | Shareable findings and stakeholder-ready outputs. |
| 7 | Operational Document Studio | High for operations persona | Charters, check sheets, A3 drafts, SOP/checklist drafts, collection templates. |
| 8 | Period-over-Period Comparison | High | Repeatable comparison across files and periods. |
| 9 | Historical Analysis Memory | Medium | Context across saved datasets and analyses. |
| 10 | Secure Sharing, collaboration, and plan limits | Later | Team workflows and controlled sharing. |

### Why Large Dataset Engine precedes Ask Your Data

Ask Your Data depends on an engine that can reliably execute operations against the selected dataset. Building the natural-language planner before the large-data execution path is stable would leave the most important questions unable to run on the very files users need help with.

---

## 20. Product Acceptance and Quality Metrics

Track product quality through measurable outcomes.

### Ingestion and performance

- Upload success rate by file type and size
- Correct row and column counts
- Time to first preview
- Time to schema/profile completion
- Time for common aggregations
- Browser responsiveness
- Out-of-memory and worker errors
- Successful persistence and reopen rate

### Data quality and cleaning

- Issues detected by category
- False-positive rate from reviewed findings
- Transformations previewed and approved
- Undo/restore success
- Original-file integrity
- Finalized-file reopen/download success

### Ask Your Data

- Valid plan rate
- Invalid-column detection rate
- Exact calculation verification
- Clarification rate for ambiguous questions
- Answer latency
- Result-to-source traceability
- Sample/full-data labelling correctness

### User value

- Time from upload to first useful insight
- Percentage of users who complete cleaning/finalization
- Percentage who save an analysis
- Return use of saved datasets
- Executive brief/template exports
- Repeat use by dataset

Avoid optimizing only for number of AI messages or token usage. The primary measure is whether users can get a trustworthy answer and complete a useful task.

---

## 21. Customer-Facing Capability and Limit Policy

Do not advertise:

- Unlimited rows
- Zero hallucinations
- Zero data leaving the machine
- HIPAA-compliant processing
- GDPR-compliant processing
- SOC 2 certification

unless each statement is proven and legally reviewed.

Instead, publish capability details that can be tested:

- Supported file types
- Tested maximum file size
- Tested row/column ranges
- Supported browsers
- Which analyses use full data
- Which analyses use sampling
- Whether the file is cloud-saved
- What information is sent to AI services
- Retention and deletion behavior

### Suggested customer-facing wording

> **Analyze business datasets with guided data preparation, reliable calculations, and AI-assisted explanations. DataSimplr supports standard and larger datasets within tested file and device limits. You can inspect cleaning steps, trace analytical results to their source, and continue working with saved datasets.**

After the 541,909-row benchmark has passed, add the specific tested capability and conditions.

---

## 22. Engineering Principles and Guardrails

These rules apply to all development agents and contributors.

1. Preserve the existing TanStack Start + React architecture unless a documented technical limitation requires a change.
2. Preserve the existing Lovable Cloud-managed backend and authentication unless a separate migration is deliberately approved.
3. Do not alter working login, logout, session, route-guard, or user-identity behavior while implementing product features.
4. Keep dataset files in private storage and metadata in the database.
5. Enforce dataset and file ownership at the backend/storage layer; do not rely only on frontend visibility.
6. Preserve original files and versioned finalized files.
7. Use migrations that are additive and reversible where practical.
8. Do not replace existing analysis functions without measuring and documenting why.
9. Run regression tests after changes to ingestion, persistence, cleaning, Chat, or PythonLab.
10. Do not allow multiple coding agents to edit the same Git branch concurrently.
11. Use a feature branch for substantial architecture work and merge only after tests pass.
12. Inspect the repository and `package.json` before running development commands. This is a TanStack/React project—not an XAMPP/PHP/MySQL application.
13. Do not move all large-file processing into Cloudflare Workers by default. Evaluate browser-side columnar processing and any dedicated processing service against actual constraints.
14. AI proposes; deterministic code validates and executes.
15. Make assumptions, samples, exclusions, and limitations visible to users.

---

## 23. Final Product Definition

DataSimplr should not be positioned merely as another spreadsheet viewer, an AI chatbot, or a collection of statistical functions.

Its differentiated value is the complete workflow:

```text
UPLOAD
  ↓
DETECT THE REAL DATA TABLE
  ↓
PROFILE AND VALIDATE
  ↓
CLEAN WITH USER APPROVAL
  ↓
FINALIZE AND SAVE A VERSION
  ↓
ASK QUESTIONS IN PLAIN ENGLISH
  ↓
RUN VERIFIED ANALYSIS
  ↓
EXPLAIN AND VISUALIZE
  ↓
CREATE AN EXECUTIVE OR OPERATIONAL ARTIFACT
  ↓
SHARE OR EXPORT
```

### The core promise

> **DataSimplr turns messy business data into trustworthy insight and practical next steps—without making users become data scientists.**

The product should combine:

- The accessibility of plain-English questions
- The reliability of deterministic calculations
- The transparency of cleaning logs and reproducible analysis
- The flexibility of PythonLab
- The persistence of a saved dataset workspace
- The usefulness of operational document generation

That is the product direction to build toward.

---

## 24. Technical References

These references support the architecture and compliance guardrails. They are not a substitute for reviewing the exact versions, configuration, vendor contracts, or deployment settings used by DataSimplr.

1. [DuckDB-Wasm — Browser analytical database](https://duckdb.org/docs/current/clients/wasm/overview)
2. [DuckDB-Wasm — Troubleshooting and memory limitations](https://duckdb.org/docs/stable/clients/wasm/troubleshoot)
3. [Apache Arrow — Columnar format and analytics](https://arrow.apache.org/docs/)
4. [Pyodide — Python in the browser](https://pyodide.org/en/stable/)
5. [Pyodide — Using Pyodide and Web Workers](https://pyodide.org/en/stable/usage/index.html)
6. [Supabase Storage — Access control and RLS](https://supabase.com/docs/guides/storage/security/access-control)
7. [Supabase Storage — Private and public buckets](https://supabase.com/docs/guides/storage/buckets/fundamentals)
8. [HHS — HIPAA and cloud computing guidance](https://www.hhs.gov/hipaa/for-professionals/special-topics/health-information-technology/cloud-computing/index.html)
9. [European Commission — GDPR roles and responsibilities](https://commission.europa.eu/law/law-topic/data-protection/information-business-and-organisations/application-gdpr_en)
10. [AICPA — SOC for Service Organizations overview](https://www.aicpa-cima.com/resources/landing/system-and-organization-controls-soc-suite-of-services)

---

**End of document**
