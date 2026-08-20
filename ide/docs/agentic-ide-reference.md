# Agentic IDE reference notes

Reference: https://antigravity.google/product

The official Antigravity product page positions the IDE as an agentic IDE with an Agent Manager, artifacts, and deep understanding of the codebase. It describes an agent-first surface that orchestrates multiple subagents across environments, supports complex long-running workflows in the background, and treats the task as the main abstraction. It emphasizes essential artifacts and verification outcomes so users can understand and trust agent actions. It also describes providing feedback across surfaces and artifacts to steer the agent toward the desired outcome. Antigravity 2.0 is described as a command center for multiple local agents, projects, workspaces, and scheduled messages; the CLI is presented separately as a terminal-first surface.

BibzCode design translation (without copying proprietary branding or code):

1. Make the Agent Manager a first-class workbench surface, not a chat bubble.
2. Represent each request as a task with status, plan, steps, tool calls, approvals, artifacts, and verification results.
3. Stream progress events for planning, tool calls, tool results, and final response.
4. Keep tool execution in Electron main process with strict workspace boundaries and explicit approval for writes, deletes, terminal commands, and Git commits.
5. Show reviewable artifacts: file diffs, created/updated files, command output, Git status, and verification summaries.
6. Keep the CLI as a separate optional surface; the native IDE must not require Python or start the CLI.
7. Support cancellation and bounded long-running operations without claiming background scheduling unless implemented.
