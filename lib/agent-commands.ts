/**
 * In-memory queue of commands for the local Windows agent (MVP).
 * Agent polls GET /api/agent/commands and consumes one command at a time.
 */

export type AgentCommand =
  | { type: "PLAY_LOCAL_PLAYLIST"; path: string };

const queue: AgentCommand[] = [];

export function enqueueAgentCommand(command: AgentCommand): void {
  queue.push(command);
}

export function consumeNextCommand(): AgentCommand | null {
  return queue.shift() ?? null;
}
