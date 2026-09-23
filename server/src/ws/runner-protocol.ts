/** Messages between the cloud and a member's runner. Declared once, imported by both workspaces. */

export type CloudToRunner =
  /**
   * `userName` is how the agent addresses the member (their GitHub login); empty when unknown.
   * `model` is the member's choice from the app; null leaves the runner's own default in charge.
   */
  | {
      type: "turn_start";
      turnId: string;
      conversationId: string;
      text: string;
      resumeSessionId?: string | null;
      userName: string;
      model: string | null;
    }
  | { type: "permission_response"; id: string; allow: boolean }
  | { type: "cancel"; turnId: string }
  | { type: "memory_result"; callId: string; result: string };

export type RunnerToCloud =
  | { type: "text_delta"; turnId: string; text: string }
  | { type: "tool_start"; turnId: string; name: string; summary: string }
  | { type: "permission_request"; turnId: string; id: string; question: string; detail: string }
  | { type: "memory_call"; turnId: string; callId: string; tool: "remember" | "recall" | "forget"; args: Record<string, unknown> }
  /** `costUsd` is the SDK's running total for the resumed session, not this turn alone. */
  | { type: "turn_done"; turnId: string; sessionId: string; costUsd?: number; fullText: string }
  | { type: "turn_error"; turnId: string; message: string };

const RUNNER_TYPES = new Set(["text_delta", "tool_start", "permission_request", "memory_call", "turn_done", "turn_error"]);
const CLOUD_TYPES = new Set(["turn_start", "permission_response", "cancel", "memory_result"]);

function parse(raw: string, allowed: Set<string>): unknown {
  try {
    const m = JSON.parse(raw);
    return m && typeof m === "object" && allowed.has(String((m as { type?: unknown }).type)) ? m : null;
  } catch {
    return null;
  }
}

export const parseRunnerMessage = (raw: string) => parse(raw, RUNNER_TYPES) as RunnerToCloud | null;
export const parseCloudMessage = (raw: string) => parse(raw, CLOUD_TYPES) as CloudToRunner | null;
