import { describe, expect, it } from "vitest";

import type { AgentTimelineStep } from "./agentModel";
import {
  createAgentRunLifecycleState,
  reduceAgentRun,
  type AgentRunLifecycleState
} from "./agentRunReducer";

const planning: AgentTimelineStep = {
  id: "planning-1",
  phase: "planning",
  status: "running",
  label: "规划查询"
};

const tool: AgentTimelineStep = {
  id: "tool-1",
  phase: "tool",
  status: "done",
  label: "商户分析",
  dataSource: "database"
};

function run(events: Parameters<typeof reduceAgentRun>[1][]): AgentRunLifecycleState {
  return events.reduce(reduceAgentRun, createAgentRunLifecycleState());
}

describe("agentRunReducer", () => {
  it("models planning, tool batch, replan and synthesis explicitly", () => {
    const state = run([
      { type: "RUN_STARTED", runId: "run-1" },
      { type: "PHASE_STARTED", phase: "planning", step: planning },
      { type: "STEP_UPDATED", step: tool },
      { type: "PHASE_STARTED", phase: "replan" },
      { type: "PHASE_STARTED", phase: "synthesis" }
    ]);

    expect(state).toMatchObject({ runId: "run-1", status: "running", phase: "synthesis" });
    expect(state.steps).toEqual([planning, tool]);
  });

  it("appends streamed tokens and records partial targets", () => {
    const state = run([
      { type: "RUN_STARTED" },
      { type: "TOKEN", token: "EPC " },
      { type: "TOKEN", token: "1.23" },
      { type: "PARTIAL", omittedTargets: ["merchant-b", "merchant-b", ""] }
    ]);

    expect(state.response).toBe("EPC 1.23");
    expect(state.partial).toBe(true);
    expect(state.omittedTargets).toEqual(["merchant-b"]);
  });

  it("ignores late tokens after stop and supports reset", () => {
    const stopped = run([
      { type: "RUN_STARTED" },
      { type: "TOKEN", token: "partial" },
      { type: "RUN_STOPPED" },
      { type: "TOKEN", token: " leaked" }
    ]);

    expect(stopped).toMatchObject({ status: "stopped", phase: "stopped", response: "partial", errorCode: "stopped_by_user" });
    expect(reduceAgentRun(stopped, { type: "RESET" })).toEqual(createAgentRunLifecycleState());
  });

  it("finishes with safe result metadata and handles runtime errors", () => {
    const done = run([
      { type: "RUN_STARTED" },
      { type: "RUN_FINISHED", response: "完成", steps: [tool], partial: true, omittedTargets: ["next"] }
    ]);
    expect(done).toMatchObject({ status: "done", phase: "done", response: "完成", partial: true, omittedTargets: ["next"] });

    const errored = run([
      { type: "RUN_STARTED" },
      { type: "RUN_ERROR", errorCode: "tool_timeout" }
    ]);
    expect(errored).toMatchObject({ status: "error", phase: "error", errorCode: "tool_timeout" });

    const preserved = run([
      { type: "RUN_STARTED" },
      { type: "PARTIAL", omittedTargets: ["next"] },
      { type: "RUN_FINISHED", response: "部分完成" }
    ]);
    expect(preserved).toMatchObject({ status: "done", partial: true, omittedTargets: ["next"] });
  });

  it("hydrates state from the legacy bridge without exposing a new authority", () => {
    const state = reduceAgentRun(createAgentRunLifecycleState(), {
      type: "STATE_SYNC",
      state: {
        status: "running",
        steps: [tool],
        response: "正在生成"
      }
    });

    expect(state).toMatchObject({ status: "running", phase: "tools", response: "正在生成" });
    expect(state.steps).toEqual([tool]);
  });
});
