// MCP stdio server. Tool descriptions double as the contract for the Claude
// Code/Cursor/Codex skills: get_activity is read-only, save_standup persists an
// agent-authored draft, and no tool requires a model provider key.
import { McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import {
  getActivity,
  getAgentStatus,
  renderStandup,
  reviseStandup,
  saveStandup,
  dailyPromptInstructions,
} from "./tools";
import { agentVersion } from "../version";

const detailSchema = z.enum(["concise", "standard", "elaborate"]);
const toneSchema = z.enum(["neutral", "junior", "mid", "senior"]);

function text(value: string) {
  return { content: [{ type: "text" as const, text: value }] };
}

export function createServer(version = agentVersion()): McpServer {
  const server = new McpServer(
    { name: "shiplogue", version },
    { capabilities: { tools: {}, resources: {}, prompts: {} } },
  );

  server.registerTool(
    "get_activity",
    {
      title: "Get local development activity",
      description:
        "Read the user's local agent sessions, prompts, tool calls, file edits, commits, uncommitted files, and optional GitHub activity. Read-only; no network unless GITHUB_TOKEN is set. Use this, then write the stand-up yourself.",
      inputSchema: z.object({
        lookbackHours: z.number().int().min(1).max(168).optional(),
        repoPath: z.string().optional(),
        includeGitHub: z.boolean().optional(),
        includeIdePrompts: z.boolean().optional(),
        detail: detailSchema.optional(),
      }),
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      const result = await getActivity(args);
      return text(result.text);
    },
  );

  server.registerTool(
    "save_standup",
    {
      title: "Save an agent-authored stand-up",
      description:
        "Validate, ground, format, and save the stand-up Markdown written by the host model. Use this once after writing the draft; the user should not have to save separately. No model key is used.",
      inputSchema: z.object({
        markdown: z.string().min(1),
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        source: z.string().optional(),
        lookbackHours: z.number().int().min(1).max(168).optional(),
        repoPath: z.string().optional(),
      }),
    },
    async (args) => {
      const result = await saveStandup(args);
      return {
        content: [{ type: "text" as const, text: result.text }],
        structuredContent: {
          date: result.draft.date,
          revision: result.draft.revision,
          quality: result.final.quality,
          warnings: result.final.warnings,
        },
      };
    },
  );

  server.registerTool(
    "render_standup",
    {
      title: "Render a stand-up draft",
      description:
        "Return the canonical Markdown and plain text for a draft, either the provided Markdown or the latest saved local draft.",
      inputSchema: z.object({
        markdown: z.string().optional(),
        date: z.string().optional(),
      }),
      annotations: { readOnlyHint: true },
    },
    async (args) => {
      const rendered = renderStandup(args);
      return text(
        [
          rendered.markdown,
          "",
          "---",
          rendered.plainText,
          rendered.path ? `\nDraft: ${rendered.path}` : "",
        ].join("\n"),
      );
    },
  );

  server.registerTool(
    "revise_standup",
    {
      title: "Revise a stand-up section",
      description:
        "Replace or append one section (yesterday/today/next/blockers) in the current draft, then re-validate and save it.",
      inputSchema: z.object({
        markdown: z.string().optional(),
        section: z.enum(["yesterday", "today", "next", "blockers"]),
        text: z.string().min(1),
        mode: z.enum(["replace", "append"]).optional(),
        date: z.string().optional(),
      }),
    },
    async (args) => {
      const result = await reviseStandup(args);
      return text(result.text);
    },
  );

  server.registerTool(
    "get_agent_status",
    {
      title: "Get Shiplogue agent status",
      description:
        "Local versions, event/draft counts, hook installation, and whether a Shiplogue Cloud token is configured. Read-only.",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true },
    },
    async () => text(JSON.stringify(getAgentStatus(), null, 2)),
  );

  server.registerResource(
    "activity-today",
    "shiplogue://activity/today",
    { title: "Today's local activity", mimeType: "text/markdown" },
    async (uri) => {
      const result = await getActivity({ lookbackHours: 24 });
      return { contents: [{ uri: uri.href, text: result.text }] };
    },
  );

  server.registerResource(
    "draft-latest",
    "shiplogue://draft/latest",
    { title: "Latest stand-up draft", mimeType: "text/markdown" },
    async (uri) => {
      try {
        const rendered = renderStandup();
        return { contents: [{ uri: uri.href, text: rendered.markdown }] };
      } catch {
        return { contents: [{ uri: uri.href, text: "No draft saved yet." }] };
      }
    },
  );

  server.registerResource(
    "agent-status",
    "shiplogue://status",
    { title: "Shiplogue agent status", mimeType: "application/json" },
    async (uri) => ({
      contents: [{ uri: uri.href, text: JSON.stringify(getAgentStatus(), null, 2) }],
    }),
  );

  server.registerPrompt(
    "shiplogue-daily",
    {
      title: "Write today's Shiplogue stand-up",
      description:
        "Use the host model to write the stand-up from local activity, then save it.",
      argsSchema: z.object({
        detail: detailSchema.optional(),
        tone: toneSchema.optional(),
      }),
    },
    ({ detail, tone }) => ({
      messages: [
        {
          role: "user" as const,
          content: {
            type: "text" as const,
            text: dailyPromptInstructions(detail ?? "standard", tone ?? "neutral"),
          },
        },
      ],
    }),
  );

  return server;
}
