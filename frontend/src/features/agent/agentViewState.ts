import type { AgentResultView } from "../../shared/contracts/agentResult";
import type { AgentMemoryState, AgentRunStatus, AgentTimelineStep } from "./agentModel";

export interface AgentViewSnapshot {
  readonly messages: readonly { readonly id: string; readonly role: "user" | "assistant"; readonly content: string }[];
  readonly timeline: readonly AgentTimelineStep[];
  readonly status: Exclude<AgentRunStatus, "running">;
  readonly response: string;
  readonly partial: boolean;
  readonly omittedTargets: readonly string[];
  readonly resultViews: readonly AgentResultView[];
  readonly memory: AgentMemoryState;
  readonly error: string;
}

// 只在当前页面进程内恢复导航状态，不把提问、答案或工具结果写入持久化存储。
const snapshots = new Map<string, AgentViewSnapshot>();

export function loadAgentViewSnapshot(key: string): AgentViewSnapshot | null {
  return snapshots.get(key) || null;
}

export function saveAgentViewSnapshot(key: string, snapshot: AgentViewSnapshot): void {
  snapshots.set(key, snapshot);
}

export function clearAgentViewSnapshot(key: string): void {
  snapshots.delete(key);
}
