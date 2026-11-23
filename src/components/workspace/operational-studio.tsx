import { useState, useMemo } from "react";
import {
  Briefcase,
  FileSpreadsheet,
  FileText,
  Printer,
  Copy,
  Check,
  Download,
  Database,
  Sparkles,
  Layers,
  ShieldCheck,
  AlertCircle,
  Users,
  CheckSquare,
  Calendar,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  PRESET_GOALS,
  buildDocumentsFromDataset,
  type PresetGoal,
  type ProjectCharterData,
  type A3Data,
  type CheckSheetData,
  type DataCollectionTemplate,
} from "@/lib/operational-documents";
import type { DatasetRow } from "@/lib/dataset-library";

type DocTab = "charter" | "a3" | "checksheet" | "template";

export interface OperationalStudioProps {
  savedDatasets?: DatasetRow[] | undefined;
  initialDatasetId?: string | undefined;
}

export function OperationalStudio({
  savedDatasets = [],
  initialDatasetId,
}: OperationalStudioProps) {
  const [mode, setMode] = useState<"dataset" | "proactive">(
    savedDatasets.length > 0 ? "dataset" : "proactive"
  );
  const [selectedDatasetId, setSelectedDatasetId] = useState<string>(
    initialDatasetId ?? savedDatasets[0]?.id ?? ""
  );
  const [selectedPresetId, setSelectedPresetId] = useState<string>(
    PRESET_GOALS[0]?.id ?? "warehouse-delays"
  );
  const [activeTab, setActiveTab] = useState<DocTab>("charter");
  const [copied, setCopied] = useState(false);

  // Editable fields for user-confirmed parameters
  const [customTarget, setCustomTarget] = useState("");
  const [customLead, setCustomLead] = useState("");

  const currentDataset = useMemo(() => {
    return savedDatasets.find((d) => d.id === selectedDatasetId) ?? savedDatasets[0] ?? null;
  }, [savedDatasets, selectedDatasetId]);

  const currentPreset = useMemo(() => {
    return PRESET_GOALS.find((p) => p.id === selectedPresetId) ?? PRESET_GOALS[0]!;
  }, [selectedPresetId]);

  // Generate grounded documents
  const documents = useMemo(() => {
    if (mode === "dataset" && currentDataset) {
      return buildDocumentsFromDataset({
        datasetName: currentDataset.name,
        rowCount: currentDataset.row_count ?? 1000,
        columns: ["id", "timestamp", "category", "status", "metric_value", "region", "operator"],
      });
    }

    // Proactive Mode from industry presets
    const p = currentPreset;
    const charter: ProjectCharterData = {
      projectName: `Operational Launch: ${p.label}`,
      businessCase: `Implementing structured collection and tracking for ${p.label.toLowerCase()} to eliminate reporting gaps and standardize root-cause analysis before discrepancies compound.`,
      problemStatement: `Operational teams currently lack a validated collection framework for ${p.description.toLowerCase()}`,
      baselineMetric: "Baseline: Pre-collection phase (0 records logged)",
      targetMetric: customTarget || "Target: Capture 100% of shift incidents with < 2% unclassified records",
      scopeIn: [
        `Standardized data collection across all shifts and hubs`,
        `Mandatory data dictionary enforcement`,
        `Weekly supervisor verification reviews`,
      ],
      scopeOut: [
        "Unrelated operational facilities not in initial rollout",
        "Legacy archive remediation",
      ],
      team: [
        { role: "Project Sponsor", name: "Operations Director" },
        { role: "Project Lead", name: customLead || "Process Excellence Lead" },
        { role: "Quality Coordinator", name: "Shift Supervisor" },
      ],
      milestones: [
        { phase: "Phase 1: Tool Rollout & Shift Briefing", targetDate: "Day 7", deliverable: "Check sheets printed & digital CSV ready" },
        { phase: "Phase 2: First 100 Records Audit", targetDate: "Day 21", deliverable: "Data quality review in DataSimplr" },
        { phase: "Phase 3: Operational Control & Reporting", targetDate: "Day 45", deliverable: "Automated executive briefings" },
      ],
      risks: [
        { risk: "Field workers skipping optional fields", mitigation: "Designate essential fields as mandatory in template" },
        { risk: "Delayed physical check sheet input", mitigation: "Assign daily 10-minute digital transcription slot" },
      ],
    };

    const a3: A3Data = {
      title: `A3 Problem Solving: ${p.label}`,
      background: `To improve performance in ${p.category}, a disciplined problem-solving approach is implemented using DataSimplr-validated templates.`,
      currentCondition: `Current lack of standardized logging leads to unquantified operational variances.`,
      problemStatement: `Variance in ${p.description.toLowerCase()} requires consistent recording to identify key failure modes.`,
      targetCondition: customTarget || "Zero missing records and 100% adherence to standard collection taxonomy.",
      rootCauseHypotheses: [
        "Hypothesis 1: No standardized physical check sheet was provided to operators on duty",
        "Hypothesis 2: Inconsistent column naming across shifts made central analysis impossible",
        "Hypothesis 3: High turnover without standardized onboarding procedures",
      ],
      countermeasures: [
        { action: "Deploy standardized physical check sheet & CSV template", owner: "Project Lead", deadline: "Week 1" },
        { action: "Conduct 10-minute shift huddle on category definitions", owner: "Shift Manager", deadline: "Week 2" },
        { action: "Import first weekly batch into DataSimplr for quality score", owner: "Data Lead", deadline: "Week 3" },
      ],
      followUpPlan: "Monitor weekly quality scores in DataSimplr and review trends during bi-weekly operations meetings.",
    };

    const checkSheet: CheckSheetData = {
      title: `Physical Floor Check Sheet — ${p.label}`,
      facility: "Distribution Center / Production Plant",
      shift: "Shift 1 / Shift 2",
      date: new Date().toISOString().split("T")[0]!,
      inspector: customLead || "Inspector Name",
      instructions: "Record tally marks (||||) immediately upon incident occurrence. Total each category at shift end and hand over to supervisor.",
      categories: p.template.columns
        .filter((c) => c.type === "Category" && c.allowedValues)
        .flatMap((c) =>
          c.allowedValues!
            .split(",")
            .map((val, idx) => ({ name: val.trim(), severity: idx === 0 ? ("Critical" as const) : ("Major" as const), code: `INC-0${idx + 1}` }))
        )
        .slice(0, 6),
    };

    return { charter, a3, checkSheet, template: p.template };
  }, [mode, currentDataset, currentPreset, customTarget, customLead]);

  // Generate markdown representation for current tab
  const markdownContent = useMemo(() => {
    if (activeTab === "charter") {
      const c = documents.charter;
      return [
        `# Project Charter: ${c.projectName}`,
        `*DataSimplr Continuous Improvement Studio*`,
        "",
        `## 1. Business Case`,
        c.businessCase,
        "",
        `## 2. Problem Statement & Baseline`,
        c.problemStatement,
        "",
        `- **Baseline:** ${c.baselineMetric}`,
        `- **Target:** ${c.targetMetric}`,
        "",
        `## 3. Scope`,
        `### In Scope`,
        ...c.scopeIn.map((s) => `- ${s}`),
        `### Out of Scope`,
        ...c.scopeOut.map((s) => `- ${s}`),
        "",
        `## 4. Project Team`,
        ...c.team.map((t) => `- **${t.role}:** ${t.name}`),
        "",
        `## 5. Timeline & Milestones`,
        ...c.milestones.map((m) => `- **${m.phase}** (${m.targetDate}): ${m.deliverable}`),
        "",
        `## 6. Risks & Mitigations`,
        ...c.risks.map((r) => `- **Risk:** ${r.risk} | **Mitigation:** ${r.mitigation}`),
      ].join("\n");
    }

    if (activeTab === "a3") {
      const a = documents.a3;
      return [
        `# A3 Problem-Solving Report: ${a.title}`,
        "",
        `## 1. Background`,
        a.background,
        "",
        `## 2. Current Condition`,
        a.currentCondition,
        "",
        `## 3. Problem Statement & Target Condition`,
        `- **Problem Statement:** ${a.problemStatement}`,
        `- **Target Condition:** ${a.targetCondition}`,
        "",
        `## 4. Root Cause Analysis (Hypotheses to Validate)`,
        ...a.rootCauseHypotheses.map((h) => `- ${h}`),
        "",
        `## 5. Countermeasures & Action Items`,
        `| Action | Owner | Deadline |`,
        `| --- | --- | --- |`,
        ...a.countermeasures.map((c) => `| ${c.action} | ${c.owner} | ${c.deadline} |`),
        "",
        `## 6. Follow-up & Control Plan`,
        a.followUpPlan,
      ].join("\n");
    }

    if (activeTab === "checksheet") {
      const cs = documents.checkSheet;
      return [
        `# ${cs.title}`,
        `**Facility:** ${cs.facility} | **Shift:** ${cs.shift} | **Date:** ${cs.date} | **Inspector:** ${cs.inspector}`,
        "",
        `**Instructions:** ${cs.instructions}`,
        "",
        `| Code | Category / Issue | Severity | Tally Observation | Total Count |`,
        `| --- | --- | --- | --- | --- |`,
        ...cs.categories.map((cat) => `| ${cat.code} | ${cat.name} | ${cat.severity} | [   ] | ___ |`),
      ].join("\n");
    }

    // Template
    const t = documents.template;
    return [
      `# Data Collection Template: ${t.objective}`,
      `*File Name:* \`${t.fileName}\``,
      "",
      `## Data Dictionary`,
      `| Field Name | Type | Required | Allowed Values / Format | Description | Example |`,
      `| --- | --- | --- | --- | --- | --- |`,
      ...t.columns.map((col) => `| \`${col.name}\` | ${col.type} | ${col.required ? "Yes" : "No"} | ${col.allowedValues ?? "—"} | ${col.description} | \`${col.example}\` |`),
      "",
      `## Starter CSV Preview`,
      "```csv",
      t.sampleCsv,
      "```",
    ].join("\n");
  }, [activeTab, documents]);

  const handleCopy = () => {
    void navigator.clipboard.writeText(markdownContent);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownloadMd = () => {
    const blob = new Blob([markdownContent], { type: "text/markdown;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${activeTab}-${new Date().toISOString().split("T")[0]}.md`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handleDownloadCsv = () => {
    const t = documents.template;
    const blob = new Blob([t.sampleCsv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = t.fileName;
    link.click();
    URL.revokeObjectURL(url);
  };

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="space-y-6">
      {/* Top Banner & Mode Toggle */}
      <div className="panel p-5">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4 border-b border-border/60 pb-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="flex size-7 items-center justify-center rounded-lg bg-primary/20 text-primary">
                <Briefcase className="size-4" />
              </span>
              <h2 className="font-display text-lg font-semibold tracking-tight">Operational Document Studio</h2>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              Turn verified analysis findings into continuous improvement charters, A3 drafts, check sheets, and data templates.
            </p>
          </div>

          {/* Mode Switcher */}
          <div className="flex items-center rounded-xl border border-border bg-muted p-1 text-xs">
            <button
              type="button"
              onClick={() => setMode("dataset")}
              className={`rounded-lg px-3 py-1.5 font-medium transition-colors ${
                mode === "dataset" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              From Saved Dataset
            </button>
            <button
              type="button"
              onClick={() => setMode("proactive")}
              className={`rounded-lg px-3 py-1.5 font-medium transition-colors ${
                mode === "proactive" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              Proactive Template Designer
            </button>
          </div>
        </div>

        {/* Source Configuration Controls */}
        <div className="mt-4 flex flex-wrap items-center gap-4 text-xs">
          {mode === "dataset" ? (
            <div className="flex items-center gap-2">
              <Database className="size-3.5 text-primary" />
              <span className="font-medium">Active Dataset:</span>
              {savedDatasets.length > 0 ? (
                <select
                  value={selectedDatasetId}
                  onChange={(e) => setSelectedDatasetId(e.target.value)}
                  className="rounded-lg border border-border bg-background px-3 py-1.5 text-xs font-medium"
                >
                  {savedDatasets.map((d) => (
                    <option key={d.id} value={d.id}>
                      {d.name} ({d.row_count?.toLocaleString() ?? "?"} rows)
                    </option>
                  ))}
                </select>
              ) : (
                <span className="text-muted-foreground italic">No saved datasets found. Switch to Proactive Mode.</span>
              )}
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <Sparkles className="size-3.5 text-primary" />
              <span className="font-medium">Industry Blueprint:</span>
              <div className="flex flex-wrap gap-2">
                {PRESET_GOALS.map((p) => (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => setSelectedPresetId(p.id)}
                    className={`rounded-lg border px-2.5 py-1 text-xs transition-colors ${
                      selectedPresetId === p.id
                        ? "border-primary bg-primary/10 text-primary font-semibold"
                        : "border-border bg-card text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* User Confirmation Overrides */}
          <div className="flex flex-wrap items-center gap-2 ml-auto">
            <input
              type="text"
              placeholder="Target metric (e.g. < 5% scrap)"
              value={customTarget}
              onChange={(e) => setCustomTarget(e.target.value)}
              className="rounded-lg border border-border bg-background px-2.5 py-1 text-xs placeholder:text-subtle w-44"
            />
            <input
              type="text"
              placeholder="Project lead name"
              value={customLead}
              onChange={(e) => setCustomLead(e.target.value)}
              className="rounded-lg border border-border bg-background px-2.5 py-1 text-xs placeholder:text-subtle w-36"
            />
          </div>
        </div>
      </div>

      {/* Main Document Workspace */}
      <div className="panel overflow-hidden">
        {/* Document Tabs & Action Toolbar */}
        <div className="flex flex-wrap items-center justify-between border-b border-border bg-muted/60 px-4 py-2.5 gap-2">
          {/* Tabs */}
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setActiveTab("charter")}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                activeTab === "charter" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Briefcase className="size-3.5" /> Project Charter
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("a3")}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                activeTab === "a3" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Layers className="size-3.5" /> A3 Problem Solving
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("checksheet")}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                activeTab === "checksheet" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <CheckSquare className="size-3.5" /> Inspection Check Sheet
            </button>
            <button
              type="button"
              onClick={() => setActiveTab("template")}
              className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                activeTab === "template" ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <FileSpreadsheet className="size-3.5" /> Data Template &amp; CSV
            </button>
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={handleCopy} className="text-xs h-8">
              {copied ? <Check className="mr-1.5 size-3.5 text-emerald-500" /> : <Copy className="mr-1.5 size-3.5" />}
              {copied ? "Copied" : "Copy Markdown"}
            </Button>
            <Button size="sm" variant="outline" onClick={handleDownloadMd} className="text-xs h-8">
              <Download className="mr-1.5 size-3.5" /> .md
            </Button>
            {activeTab === "template" && (
              <Button size="sm" onClick={handleDownloadCsv} className="text-xs h-8 bg-emerald-600 hover:bg-emerald-700 text-white">
                <Download className="mr-1.5 size-3.5" /> Download Starter CSV
              </Button>
            )}
            <Button size="sm" onClick={handlePrint} className="text-xs h-8">
              <Printer className="mr-1.5 size-3.5" /> Print / PDF
            </Button>
          </div>
        </div>

        {/* Render Active Document Content */}
        <div id="printable-operational-doc" className="p-6 space-y-6 text-foreground text-sm">
          {/* TAB 1: PROJECT CHARTER */}
          {activeTab === "charter" && (
            <div className="space-y-6">
              <div className="border-b border-border pb-4">
                <span className="font-mono text-xs uppercase tracking-wider text-primary font-semibold">Lean Six Sigma DMAIC</span>
                <h1 className="text-xl font-bold tracking-tight text-foreground mt-1">{documents.charter.projectName}</h1>
                <p className="text-xs text-muted-foreground mt-1">Structured initiative charter for operational continuous improvement</p>
              </div>

              {/* Business Case & Problem Statement */}
              <div className="grid md:grid-cols-2 gap-4">
                <div className="rounded-xl border border-border bg-card p-4">
                  <h3 className="font-semibold text-xs uppercase tracking-wider text-muted-foreground mb-2">1. Business Case</h3>
                  <p className="text-xs text-foreground/90 leading-relaxed">{documents.charter.businessCase}</p>
                </div>
                <div className="rounded-xl border border-primary/30 bg-primary/5 p-4">
                  <h3 className="font-semibold text-xs uppercase tracking-wider text-primary mb-2">2. Problem Statement</h3>
                  <p className="text-xs text-foreground/90 leading-relaxed">{documents.charter.problemStatement}</p>
                  <div className="mt-3 pt-3 border-t border-primary/20 space-y-1">
                    <p className="text-xs font-semibold text-foreground">{documents.charter.baselineMetric}</p>
                    <p className="text-xs font-bold text-primary">{documents.charter.targetMetric}</p>
                  </div>
                </div>
              </div>

              {/* Scope */}
              <div className="grid md:grid-cols-2 gap-4">
                <div className="rounded-xl border border-border bg-card p-4">
                  <h3 className="font-semibold text-xs uppercase tracking-wider text-emerald-500 mb-2">3A. In Scope</h3>
                  <ul className="list-disc pl-4 space-y-1 text-xs text-foreground/90">
                    {documents.charter.scopeIn.map((s, idx) => (
                      <li key={idx}>{s}</li>
                    ))}
                  </ul>
                </div>
                <div className="rounded-xl border border-border bg-card p-4">
                  <h3 className="font-semibold text-xs uppercase tracking-wider text-muted-foreground mb-2">3B. Out of Scope</h3>
                  <ul className="list-disc pl-4 space-y-1 text-xs text-muted-foreground">
                    {documents.charter.scopeOut.map((s, idx) => (
                      <li key={idx}>{s}</li>
                    ))}
                  </ul>
                </div>
              </div>

              {/* Team Roster & Milestones */}
              <div className="grid md:grid-cols-2 gap-4">
                <div className="rounded-xl border border-border bg-card p-4">
                  <h3 className="font-semibold text-xs uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
                    <Users className="size-3.5 text-primary" /> 4. Project Team
                  </h3>
                  <div className="space-y-2">
                    {documents.charter.team.map((t, idx) => (
                      <div key={idx} className="flex justify-between items-center text-xs border-b border-border/40 pb-1.5">
                        <span className="text-muted-foreground">{t.role}:</span>
                        <span className="font-medium text-foreground">{t.name}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="rounded-xl border border-border bg-card p-4">
                  <h3 className="font-semibold text-xs uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
                    <Calendar className="size-3.5 text-primary" /> 5. Key Milestones
                  </h3>
                  <div className="space-y-2">
                    {documents.charter.milestones.map((m, idx) => (
                      <div key={idx} className="text-xs border-b border-border/40 pb-1.5">
                        <div className="flex justify-between items-center">
                          <span className="font-semibold text-foreground">{m.phase}</span>
                          <span className="font-mono text-[10px] text-primary">{m.targetDate}</span>
                        </div>
                        <p className="text-[11px] text-muted-foreground mt-0.5">{m.deliverable}</p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Risks & Mitigations */}
              <div className="rounded-xl border border-border bg-card p-4">
                <h3 className="font-semibold text-xs uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
                  <AlertCircle className="size-3.5 text-amber-500" /> 6. Risk Management
                </h3>
                <div className="grid sm:grid-cols-2 gap-3">
                  {documents.charter.risks.map((r, idx) => (
                    <div key={idx} className="rounded-lg border border-border/60 bg-muted/30 p-2.5 text-xs">
                      <p className="font-semibold text-foreground">Risk: {r.risk}</p>
                      <p className="text-muted-foreground mt-1">Mitigation: {r.mitigation}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: A3 PROBLEM SOLVING */}
          {activeTab === "a3" && (
            <div className="space-y-6">
              <div className="border-b border-border pb-4">
                <span className="font-mono text-xs uppercase tracking-wider text-primary font-semibold">Toyota Practical Problem Solving</span>
                <h1 className="text-xl font-bold tracking-tight text-foreground mt-1">{documents.a3.title}</h1>
              </div>

              <div className="grid md:grid-cols-2 gap-4">
                {/* Left Side: Problem & Current State */}
                <div className="space-y-4">
                  <div className="rounded-xl border border-border bg-card p-4">
                    <h3 className="font-semibold text-xs uppercase tracking-wider text-muted-foreground mb-2">1. Background &amp; Context</h3>
                    <p className="text-xs text-foreground/90 leading-relaxed">{documents.a3.background}</p>
                  </div>

                  <div className="rounded-xl border border-border bg-card p-4">
                    <h3 className="font-semibold text-xs uppercase tracking-wider text-muted-foreground mb-2">2. Current Condition</h3>
                    <p className="text-xs text-foreground/90 leading-relaxed">{documents.a3.currentCondition}</p>
                  </div>

                  <div className="rounded-xl border border-primary/30 bg-primary/5 p-4">
                    <h3 className="font-semibold text-xs uppercase tracking-wider text-primary mb-2">3. Problem Statement &amp; Target</h3>
                    <p className="text-xs text-foreground font-medium">{documents.a3.problemStatement}</p>
                    <p className="text-xs font-bold text-primary mt-2">Target: {documents.a3.targetCondition}</p>
                  </div>
                </div>

                {/* Right Side: Cause, Countermeasure, Control */}
                <div className="space-y-4">
                  <div className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-4">
                    <h3 className="font-semibold text-xs uppercase tracking-wider text-amber-500 mb-1 flex items-center gap-1.5">
                      <AlertCircle className="size-3.5" /> 4. Root Cause Hypotheses
                    </h3>
                    <p className="text-[11px] text-muted-foreground italic mb-2">
                      *Note: Statistical signals indicate associations; confirm empirical causality through gemba walk.
                    </p>
                    <ul className="space-y-1.5 text-xs text-foreground/90">
                      {documents.a3.rootCauseHypotheses.map((h, idx) => (
                        <li key={idx} className="flex items-start gap-2">
                          <span className="font-mono font-bold text-amber-500">{idx + 1}.</span>
                          <span>{h}</span>
                        </li>
                      ))}
                    </ul>
                  </div>

                  <div className="rounded-xl border border-border bg-card p-4">
                    <h3 className="font-semibold text-xs uppercase tracking-wider text-muted-foreground mb-2">5. Countermeasures</h3>
                    <div className="space-y-2">
                      {documents.a3.countermeasures.map((c, idx) => (
                        <div key={idx} className="rounded border border-border/60 bg-muted/20 p-2 text-xs flex justify-between items-center">
                          <div>
                            <p className="font-medium text-foreground">{c.action}</p>
                            <p className="text-[11px] text-muted-foreground">Owner: {c.owner}</p>
                          </div>
                          <span className="font-mono text-[10px] text-primary">{c.deadline}</span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-xl border border-border bg-card p-4">
                    <h3 className="font-semibold text-xs uppercase tracking-wider text-muted-foreground mb-2">6. Follow-up &amp; Standardized Control</h3>
                    <p className="text-xs text-foreground/90 leading-relaxed">{documents.a3.followUpPlan}</p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: INSPECTION CHECK SHEET */}
          {activeTab === "checksheet" && (
            <div className="space-y-6">
              <div className="border-b border-border pb-4">
                <span className="font-mono text-xs uppercase tracking-wider text-primary font-semibold">Floor Data Collection Check Sheet</span>
                <h1 className="text-xl font-bold tracking-tight text-foreground mt-1">{documents.checkSheet.title}</h1>
                <p className="text-xs text-muted-foreground mt-1">Physical tally sheet for shift operators &amp; floor inspectors</p>
              </div>

              {/* Header Box */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 rounded-xl border border-border bg-muted/40 p-4 text-xs">
                <div>
                  <span className="text-muted-foreground block text-[10px] uppercase">Facility / Hub:</span>
                  <span className="font-semibold text-foreground">{documents.checkSheet.facility}</span>
                </div>
                <div>
                  <span className="text-muted-foreground block text-[10px] uppercase">Shift:</span>
                  <span className="font-semibold text-foreground">{documents.checkSheet.shift}</span>
                </div>
                <div>
                  <span className="text-muted-foreground block text-[10px] uppercase">Date:</span>
                  <span className="font-semibold text-foreground">{documents.checkSheet.date}</span>
                </div>
                <div>
                  <span className="text-muted-foreground block text-[10px] uppercase">Inspector:</span>
                  <span className="font-semibold text-foreground">{documents.checkSheet.inspector}</span>
                </div>
              </div>

              <p className="text-xs italic text-muted-foreground border-l-2 border-primary pl-3">
                {documents.checkSheet.instructions}
              </p>

              {/* Printable Tally Table */}
              <div className="overflow-x-auto rounded-xl border border-border">
                <table className="w-full border-collapse text-left text-xs">
                  <thead>
                    <tr className="border-b border-border bg-muted/80 text-muted-foreground font-semibold">
                      <th className="p-3 w-20">Code</th>
                      <th className="p-3">Defect / Incident Category</th>
                      <th className="p-3 w-28">Severity</th>
                      <th className="p-3 w-1/3">Tally Marks (Observation)</th>
                      <th className="p-3 w-24 text-right">Total Count</th>
                    </tr>
                  </thead>
                  <tbody>
                    {documents.checkSheet.categories.map((cat, idx) => (
                      <tr key={idx} className="border-b border-border/50 hover:bg-muted/30">
                        <td className="p-3 font-mono font-bold text-foreground">{cat.code}</td>
                        <td className="p-3 font-medium text-foreground">{cat.name}</td>
                        <td className="p-3">
                          <span
                            className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
                              cat.severity === "Critical"
                                ? "bg-destructive/15 text-destructive"
                                : "bg-amber-500/15 text-amber-600 dark:text-amber-400"
                            }`}
                          >
                            {cat.severity}
                          </span>
                        </td>
                        <td className="p-3 border-x border-border/40 font-mono text-muted-foreground text-center">
                          <div className="h-7 border border-dashed border-border/60 rounded flex items-center justify-center text-[10px] text-subtle">
                            [ tally box ]
                          </div>
                        </td>
                        <td className="p-3 text-right font-mono font-bold text-foreground">
                          ________
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Sign-off Footer */}
              <div className="pt-6 grid grid-cols-2 gap-8 text-xs border-t border-border">
                <div>
                  <p className="text-muted-foreground">Shift Supervisor Signature:</p>
                  <div className="mt-4 border-b border-border w-48" />
                </div>
                <div>
                  <p className="text-muted-foreground">Quality Audit Sign-Off:</p>
                  <div className="mt-4 border-b border-border w-48" />
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: DATA COLLECTION TEMPLATE & CSV */}
          {activeTab === "template" && (
            <div className="space-y-6">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border pb-4">
                <div>
                  <span className="font-mono text-xs uppercase tracking-wider text-primary font-semibold">Proactive Data Hygiene</span>
                  <h1 className="text-xl font-bold tracking-tight text-foreground mt-1">{documents.template.objective}</h1>
                  <p className="text-xs text-muted-foreground mt-1">
                    Predefined schema to prevent formatting issues, type errors, and missing categories before collection starts.
                  </p>
                </div>
                <Button size="sm" onClick={handleDownloadCsv} className="bg-emerald-600 hover:bg-emerald-700 text-white text-xs">
                  <Download className="mr-1.5 size-3.5" /> Download {documents.template.fileName}
                </Button>
              </div>

              {/* Data Dictionary Table */}
              <div>
                <h3 className="font-semibold text-xs uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-1.5">
                  <FileText className="size-3.5 text-primary" /> Data Dictionary &amp; Validation Rules
                </h3>
                <div className="overflow-x-auto rounded-xl border border-border">
                  <table className="w-full border-collapse text-left text-xs">
                    <thead>
                      <tr className="border-b border-border bg-muted/80 text-muted-foreground font-semibold">
                        <th className="p-3">Field Name</th>
                        <th className="p-3">Type</th>
                        <th className="p-3">Mandatory</th>
                        <th className="p-3">Allowed Values / Range</th>
                        <th className="p-3">Description</th>
                        <th className="p-3">Example</th>
                      </tr>
                    </thead>
                    <tbody>
                      {documents.template.columns.map((col, idx) => (
                        <tr key={idx} className="border-b border-border/50 hover:bg-muted/30">
                          <td className="p-3 font-mono font-semibold text-primary">{col.name}</td>
                          <td className="p-3 font-mono text-[11px] text-muted-foreground">{col.type}</td>
                          <td className="p-3">
                            {col.required ? (
                              <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-bold text-primary">Required</span>
                            ) : (
                              <span className="text-subtle text-[11px]">Optional</span>
                            )}
                          </td>
                          <td className="p-3 text-[11px] text-foreground/80">{col.allowedValues ?? "Any valid " + col.type.toLowerCase()}</td>
                          <td className="p-3 text-xs text-muted-foreground">{col.description}</td>
                          <td className="p-3 font-mono text-[11px] text-muted-foreground">{col.example}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Starter CSV Code Preview */}
              <div>
                <h3 className="font-semibold text-xs uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1.5">
                  <FileSpreadsheet className="size-3.5 text-primary" /> Starter CSV File Preview
                </h3>
                <pre className="overflow-x-auto rounded-xl border border-border bg-muted/80 p-4 font-mono text-xs text-foreground leading-relaxed">
                  {documents.template.sampleCsv}
                </pre>
              </div>
            </div>
          )}

          {/* Footer Quality Assurance Guarantee */}
          <div className="rounded-xl border border-border/60 bg-muted/20 p-4 text-[11px] text-muted-foreground flex items-center justify-between">
            <span className="flex items-center gap-2">
              <ShieldCheck className="size-4 text-emerald-500" />
              Grounded operational documentation synthesized with <strong>DataSimplr</strong>.
            </span>
            <span className="font-mono text-[10px]">DMAIC &middot; Lean A3 &middot; ISO 9001 Compliant Framework</span>
          </div>
        </div>
      </div>
    </div>
  );
}
