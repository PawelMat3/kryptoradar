// Warstwa AI za uniwersalnym API zgodnym z OpenAI (/v1/chat/completions).
// Zmiana modelu = zmiana LLM_BASE_URL / LLM_MODEL (Ollama, vLLM, LM Studio, inny dostawca).
// AI pełni wyłącznie rolę pomocniczą: streszczenie dla analityka, oznaczone jako wymagające
// weryfikacji. Nie wpływa na Wskaźnik Pewności ani wykluczenia.
import { config } from '../config.js';

export interface LlmProvider {
  id: string;
  complete(system: string, user: string): Promise<string>;
}

class OpenAICompatible implements LlmProvider {
  id: string;
  constructor(
    private baseUrl: string,
    private model: string,
    private apiKey: string,
  ) {
    this.id = `${model}@${new URL(baseUrl).host}`;
  }
  async complete(system: string, user: string): Promise<string> {
    const r = await fetch(`${this.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}) },
      body: JSON.stringify({ model: this.model, temperature: 0, messages: [{ role: 'system', content: system }, { role: 'user', content: user }] }),
      signal: AbortSignal.timeout(120_000),
    });
    if (!r.ok) throw new Error(`LLM HTTP ${r.status}`);
    const j = (await r.json()) as { choices?: { message?: { content?: string } }[] };
    return j.choices?.[0]?.message?.content?.trim() ?? '';
  }
}

export function getLlm(): LlmProvider | null {
  if (!config.llm.baseUrl) return null;
  return new OpenAICompatible(config.llm.baseUrl, config.llm.model, config.llm.apiKey);
}
