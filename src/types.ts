import { AiderProcessManager } from "./aider-runner.js";

// File tracking with edit/read-only distinction
export interface TrackedFile {
  path: string;
  mode: "editable" | "read-only";
}

// This will be the main state for each session.
// We are keeping it separate from the SDK types as it's internal to our agent.
export interface SessionState {
  id: string;
  created: Date;
  model: string;
  files: string[];
  readOnlyFiles: string[];
  workingDir: string;
  aiderProcess?: AiderProcessManager;
  commandQueue: string[];
  pendingPromptId?: string | number;
  lastPromptText?: string;
  cancelled?: boolean;
  currentMode?: string;
  currentPlan?: Plan;
  activeToolCalls?: Map<string, ToolCallState>;
}

export interface ToolCallState {
  id: string;
  kind: string;
  status: string;
  startTime: number;
}

export interface Plan {
  entries: PlanEntry[];
}

export interface PlanEntry {
  content: string;
  priority: "high" | "medium" | "low";
  status: "pending" | "in_progress" | "completed";
}
