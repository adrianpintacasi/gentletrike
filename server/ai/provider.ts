import OpenAI from 'openai';
import type { ToolDefinition } from './tools';

/**
 * The seam between the agent loop and whoever actually generates text.
 *
 * The OpenAI credit for this project is a fixed grant, so every phase before
 * go-live runs against MockProvider: the retrieval, tool dispatch, booking
 * confirmation gate, and UI are all exercised for zero tokens. Switching to the
 * real provider is one environment variable.
 */

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string;
  /** Present on assistant turns that requested tools. */
  toolCalls?: ToolCall[];
  /** Present on tool results, matching the call being answered. */
  toolCallId?: string;
  name?: string;
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, any>;
}

export interface ChatResponse {
  text: string;
  toolCalls: ToolCall[];
  usage?: { promptTokens: number; completionTokens: number };
}

export interface LlmProvider {
  readonly name: string;
  chat(messages: ChatMessage[], tools: ToolDefinition[]): Promise<ChatResponse>;
  /** Undefined when the provider cannot embed — retrieval then uses keyword search. */
  embed?(texts: string[]): Promise<number[][]>;
}

// ---------------------------------------------------------------------------
// Mock
// ---------------------------------------------------------------------------

/**
 * Deterministic stand-in. It pattern-matches the last user message to decide
 * which tool to call, then summarises whatever the tool returned.
 *
 * It is not pretending to be clever — its job is to drive the loop through
 * every branch (tool call, tool result, final answer) so the surrounding code
 * is proven before real tokens are spent.
 */
export class MockProvider implements LlmProvider {
  readonly name = 'mock';

  async chat(messages: ChatMessage[], tools: ToolDefinition[]): Promise<ChatResponse> {
    const lastUser = [...messages].reverse().find((m) => m.role === 'user')?.content ?? '';
    const toolResults = messages.filter((m) => m.role === 'tool');
    const available = new Set(tools.map((t) => t.name));

    // Second pass: tools have answered, so produce the final reply.
    if (toolResults.length) {
      return {
        text:
          `[mock] Maayong adlaw! Based on what I looked up:\n\n` +
          toolResults.map((r) => r.content).join('\n\n'),
        toolCalls: [],
      };
    }

    const wantsBooking = /\b(book|order|get me|hire|sundo|reserve)\b/i.test(lastUser);
    const wantsFare = /\b(fare|cost|price|how much|magkano|tagpila|pila)\b/i.test(lastUser);
    const places = lastUser.match(/from\s+(.+?)\s+to\s+(.+?)[?.!]*$/i);

    if ((wantsBooking || wantsFare) && places && available.has(wantsBooking ? 'draft_booking' : 'estimate_fare')) {
      return {
        text: '',
        toolCalls: [
          {
            id: 'mock_1',
            name: wantsBooking ? 'draft_booking' : 'estimate_fare',
            arguments: { pickup: places[1], dropoff: places[2] },
          },
        ],
      };
    }

    if (available.has('search_knowledge')) {
      return {
        text: '',
        toolCalls: [{ id: 'mock_1', name: 'search_knowledge', arguments: { query: lastUser } }],
      };
    }

    return { text: '[mock] No tools available.', toolCalls: [] };
  }
}

// ---------------------------------------------------------------------------
// OpenAI
// ---------------------------------------------------------------------------

/** Cheap and more than capable for this workload. */
const CHAT_MODEL = 'gpt-4o-mini';
const EMBED_MODEL = 'text-embedding-3-small';

export class OpenAiProvider implements LlmProvider {
  readonly name = 'openai';
  private client: OpenAI;

  constructor(apiKey: string) {
    this.client = new OpenAI({ apiKey });
  }

  async chat(messages: ChatMessage[], tools: ToolDefinition[]): Promise<ChatResponse> {
    const completion = await this.client.chat.completions.create({
      model: CHAT_MODEL,
      temperature: 0.6,
      max_tokens: 700,
      messages: messages.map((m) => {
        if (m.role === 'tool') {
          return { role: 'tool' as const, content: m.content, tool_call_id: m.toolCallId! };
        }
        if (m.role === 'assistant' && m.toolCalls?.length) {
          return {
            role: 'assistant' as const,
            content: m.content || null,
            tool_calls: m.toolCalls.map((t) => ({
              id: t.id,
              type: 'function' as const,
              function: { name: t.name, arguments: JSON.stringify(t.arguments) },
            })),
          };
        }
        return { role: m.role as 'system' | 'user' | 'assistant', content: m.content };
      }) as any,
      tools: tools.map((t) => ({
        type: 'function' as const,
        function: { name: t.name, description: t.description, parameters: t.parameters },
      })),
    });

    const choice = completion.choices[0]?.message;

    const toolCalls: ToolCall[] = (choice?.tool_calls ?? []).flatMap((tc: any) => {
      if (tc.type && tc.type !== 'function') return [];
      try {
        return [{ id: tc.id, name: tc.function.name, arguments: JSON.parse(tc.function.arguments || '{}') }];
      } catch {
        // Malformed JSON from the model: skip rather than crash the turn.
        return [{ id: tc.id, name: tc.function.name, arguments: {} }];
      }
    });

    return {
      text: choice?.content ?? '',
      toolCalls,
      usage: completion.usage && {
        promptTokens: completion.usage.prompt_tokens,
        completionTokens: completion.usage.completion_tokens,
      },
    };
  }

  async embed(texts: string[]): Promise<number[][]> {
    const res = await this.client.embeddings.create({ model: EMBED_MODEL, input: texts });
    return res.data.map((d) => d.embedding as number[]);
  }
}

/**
 * Pick a provider.
 *
 * Set GENTLY_PROVIDER=mock to force the free path even with a key present —
 * useful while iterating on prompts or the UI.
 */
export function createProvider(log = console.log): LlmProvider {
  const forced = process.env.GENTLY_PROVIDER;
  const apiKey = process.env.OPENAI_API_KEY;

  if (forced === 'mock' || (!forced && !apiKey)) {
    log(
      apiKey
        ? 'Gently: GENTLY_PROVIDER=mock — using the mock provider (no tokens spent).'
        : 'Gently: no OPENAI_API_KEY — using the mock provider (no tokens spent).'
    );
    return new MockProvider();
  }

  if (!apiKey) throw new Error('GENTLY_PROVIDER is set but OPENAI_API_KEY is missing.');

  log('Gently: using OpenAI (gpt-4o-mini).');
  return new OpenAiProvider(apiKey);
}
