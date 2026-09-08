/**
 * LLM client wrapper — interpretation & expression generation
 * ==========================================================
 *
 * A thin seam between SWARA and whatever model provider is eventually chosen
 * (not fixed yet — SWARA_KNOWLEDGE.md §13, SPEC.md §3c). Callers depend on the
 * {@link LlmClient} interface only.
 *
 * This pass ships:
 *   - `MockLlmClient` — deterministic, offline, no network. Lets the frontend and
 *     the /interpret + /generate-expressions stubs work today.
 *   - `createLlmClient()` — returns the mock unless a real provider is configured
 *     in the environment, in which case it throws a clear "not implemented yet"
 *     error (the real adapter is the Antigravity pass's job).
 *
 * The system prompts live in ./prompts.ts and always carry
 * MEANING_FIDELITY_CONSTRAINT. This wrapper does not let a caller send an
 * interpretation/expression request WITHOUT one of those prompts — see `complete`.
 */

import { CONFIG } from "./config.ts";
import {
  buildExpressionPrompt,
  buildInterpretationPrompt,
} from "./prompts.ts";

/* ────────────────────────────────────────────────────────────────────────────
 * Interface
 * ──────────────────────────────────────────────────────────────────────────── */

export interface LlmMessage {
  role: "user" | "assistant";
  content: string;
}

export interface LlmRequest {
  /**
   * Which SWARA task this call is for. Used to attach the correct, constraint-
   * bearing system prompt — a caller cannot supply a raw system prompt of its
   * own for these tasks, so the fidelity constraint cannot be bypassed.
   */
  task: "interpretation" | "expression";
  messages: LlmMessage[];
  /** Optional generation knobs; the mock ignores them. */
  temperature?: number;
  maxTokens?: number;
}

export interface LlmResponse {
  text: string;
  /** Which implementation answered — "mock" until a real provider lands. */
  provider: string;
  model: string;
}

export interface LlmClient {
  complete(request: LlmRequest): Promise<LlmResponse>;
}

/** The system prompt for a task is chosen here, never by the caller. */
export function systemPromptFor(task: LlmRequest["task"]): string {
  return task === "interpretation" ? buildInterpretationPrompt() : buildExpressionPrompt();
}

/* ────────────────────────────────────────────────────────────────────────────
 * Mock implementation
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * Deterministic, offline stand-in. It does NOT attempt real language
 * understanding — the /interpret and /generate-expressions handlers own the mock
 * "intelligence" (see their mock.ts files). This client just echoes a structured
 * acknowledgement so the call graph is exercised end to end.
 */
export class MockLlmClient implements LlmClient {
  async complete(request: LlmRequest): Promise<LlmResponse> {
    const system = systemPromptFor(request.task);
    const lastUser = [...request.messages].reverse().find((m) => m.role === "user");
    return {
      text:
        `[mock-llm:${request.task}] system-prompt-bytes=${system.length} ` +
        `user="${(lastUser?.content ?? "").slice(0, 160)}"`,
      provider: "mock",
      model: "mock",
    };
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * Real provider implementation
 * ──────────────────────────────────────────────────────────────────────────── */

export interface RealLlmConfig {
  provider: string;
  apiKey: string;
  model?: string;
  baseUrl?: string;
}

export class RealLlmClient implements LlmClient {
  constructor(private readonly config: RealLlmConfig) {}

  async complete(request: LlmRequest): Promise<LlmResponse> {
    const system = systemPromptFor(request.task);
    const provider = this.config.provider.toLowerCase();

    if (provider === "anthropic") {
      return this.completeAnthropic(request, system);
    }

    // Default to OpenAI / OpenAI-compatible completion
    return this.completeOpenAI(request, system);
  }

  private async completeOpenAI(request: LlmRequest, systemPrompt: string): Promise<LlmResponse> {
    const baseUrl = this.config.baseUrl || process.env.OPENAI_BASE_URL || "https://api.openai.com/v1";
    const model = this.config.model || "gpt-4o-mini";

    const messages = [
      { role: "system", content: systemPrompt },
      ...request.messages,
    ];

    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: request.temperature ?? 0.2,
        max_tokens: request.maxTokens ?? 512,
        response_format: { type: "json_object" },
      }),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      throw new Error(`OpenAI API error (${response.status}): ${errText}`);
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };

    const text = data.choices?.[0]?.message?.content?.trim() ?? "";
    return {
      text,
      provider: this.config.provider,
      model,
    };
  }

  private async completeAnthropic(request: LlmRequest, systemPrompt: string): Promise<LlmResponse> {
    const baseUrl = this.config.baseUrl || "https://api.anthropic.com/v1";
    const model = this.config.model || "claude-3-5-sonnet-20241022";

    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": this.config.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        system: systemPrompt,
        messages: request.messages.map((m) => ({
          role: m.role,
          content: m.content,
        })),
        max_tokens: request.maxTokens ?? 1024,
        temperature: request.temperature ?? 0.2,
      }),
    });

    if (!response.ok) {
      const errText = await response.text().catch(() => "");
      throw new Error(`Anthropic API error (${response.status}): ${errText}`);
    }

    const data = (await response.json()) as {
      content?: Array<{ type: string; text?: string }>;
    };

    const text =
      data.content
        ?.filter((c) => c.type === "text")
        .map((c) => c.text ?? "")
        .join("")
        .trim() ?? "";

    return {
      text,
      provider: "anthropic",
      model,
    };
  }
}

/* ────────────────────────────────────────────────────────────────────────────
 * Factory
 * ──────────────────────────────────────────────────────────────────────────── */

export function createLlmClient(): LlmClient {
  if (CONFIG.llm.enabled) {
    return new RealLlmClient({
      provider: CONFIG.llm.provider,
      apiKey: CONFIG.llm.apiKey,
      model: CONFIG.llm.model,
    });
  }
  return new MockLlmClient();
}

