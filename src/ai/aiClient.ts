/**
 * AI 공급자(OpenAI, Anthropic Claude, Google Gemini) 호출.
 * API Key는 현재 창의 메모리에만 보관하며, 브라우저에서 각 공급자의 API를 직접 호출한다.
 */

export type AIProvider = "openai" | "anthropic" | "gemini";

export interface AISettings {
	provider: AIProvider;
	apiKey: string;
	model: string;
	/** 주석, 논리명에 사용할 언어 */
	language: string;
}

export const AI_PROVIDERS: Record<AIProvider, { label: string; models: string[] }> = {
	openai:    { label: "OpenAI (ChatGPT)", models: ["gpt-5", "gpt-5-mini", "gpt-4.1"] },
	anthropic: { label: "Anthropic (Claude)", models: ["claude-opus-5-5", "claude-sonnet-5-5", "claude-haiku-5-5"] },
	gemini:    { label: "Google (Gemini)", models: ["gemini-2.5-pro", "gemini-2.5-flash"] },
};

const TIMEOUT_MS = 120_000;
/** 서버 측 거절 대비 모델(fallbacks)을 지원하는 Claude 모델 */
const CLAUDE_FALLBACK_MODELS = ["claude-fable-5-1", "claude-opus-5-5", "claude-opus-5", "claude-sonnet-5-5"];

let currentSettings: AISettings | null = null;

/** 현재 창에서 입력한 AI 설정 (없으면 null) */
export function getAISettings(): AISettings | null {
	return currentSettings;
}
export function setAISettings(settings: AISettings): void {
	currentSettings = settings;
}

export interface AIRequestOptions {
	/** 응답을 이 JSON 스키마로 제한 */
	jsonSchema?: Record<string, unknown>;
}

/** 응답 본문(텍스트) 반환. 실패하면 공급자의 오류 메시지로 예외 */
export async function requestAI(settings: AISettings, prompt: string, options: AIRequestOptions = {}): Promise<string> {
	switch (settings.provider) {
		case "anthropic": return requestClaude(settings, prompt, options);
		case "gemini":    return requestGemini(settings, prompt, options);
		default:          return requestOpenAI(settings, prompt, options);
	}
}

/* -----------------------------------------------------------------------------------
 * OpenAI - Chat Completions (공식 SDK, 필요할 때만 불러온다)
 */
async function requestOpenAI(settings: AISettings, prompt: string, options: AIRequestOptions): Promise<string> {
	const { default: OpenAI } = await import("openai");
	// API Key는 사용자가 이 창에 직접 입력한 본인의 키이고 서버가 없으므로 브라우저에서 호출
	const client = new OpenAI({ apiKey: settings.apiKey, dangerouslyAllowBrowser: true, timeout: TIMEOUT_MS, maxRetries: 1 });
	try {
		const response = await client.chat.completions.create({
			model: settings.model,
			messages: [{ role: "user", content: prompt }],
			...(options.jsonSchema ? { response_format: { type: "json_schema" as const, json_schema: { name: "erd", strict: true, schema: options.jsonSchema } } } : {}),
		});
		const message = response.choices[0]?.message;
		if (message?.refusal) throw new Error(message.refusal);
		if (typeof message?.content !== "string") throw new Error("Unexpected response from OpenAI.");
		return message.content;
	} catch (error) {
		if (error instanceof OpenAI.APIConnectionTimeoutError) throw new Error("The request to OpenAI timed out.");
		if (error instanceof OpenAI.APIError) throw new Error(`OpenAI request failed (${error.status ?? "network"}): ${error.message}`);
		throw error;
	}
}

/* -----------------------------------------------------------------------------------
 * Anthropic - Messages API (공식 SDK, 필요할 때만 불러온다)
 */
async function requestClaude(settings: AISettings, prompt: string, options: AIRequestOptions): Promise<string> {
	const { default: Anthropic } = await import("@anthropic-ai/sdk");
	// API Key는 사용자가 이 창에 직접 입력한 본인의 키이고 서버가 없으므로 브라우저에서 호출
	const client = new Anthropic({ apiKey: settings.apiKey, dangerouslyAllowBrowser: true, timeout: TIMEOUT_MS, maxRetries: 1 });
	const useFallback = CLAUDE_FALLBACK_MODELS.includes(settings.model);
	try {
		const response = await client.beta.messages.create({
			model: settings.model,
			max_tokens: 16000,
			messages: [{ role: "user", content: prompt }],
			...(options.jsonSchema ? { output_config: { format: { type: "json_schema" as const, schema: options.jsonSchema } } } : {}),
			// 안전 분류기가 요청을 거절하면 서버에서 다른 모델로 이어서 처리
			...(useFallback ? { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const } : {}),
		});
		if (response.stop_reason === "refusal") throw new Error("Claude declined this request.");
		if (response.stop_reason === "max_tokens") throw new Error("The response from Claude was cut off. Ask for a smaller ERD.");
		return response.content.filter(block => block.type === "text").map(block => block.text).join("");
	} catch (error) {
		if (error instanceof Anthropic.APIError) throw new Error(`Claude request failed (${error.status ?? "network"}): ${error.message}`);
		throw error;
	}
}

/* -----------------------------------------------------------------------------------
 * Google Gemini - generateContent (공식 SDK, 필요할 때만 불러온다)
 */
async function requestGemini(settings: AISettings, prompt: string, options: AIRequestOptions): Promise<string> {
	const { GoogleGenAI, ApiError } = await import("@google/genai");
	const client = new GoogleGenAI({ apiKey: settings.apiKey, httpOptions: { timeout: TIMEOUT_MS } });
	try {
		const response = await client.models.generateContent({
			model: settings.model,
			contents: prompt,
			...(options.jsonSchema ? { config: { responseMimeType: "application/json", responseJsonSchema: options.jsonSchema } } : {}),
		});
		const text = response.text;
		if (!text) {
			const finishReason = response.candidates?.[0]?.finishReason;
			throw new Error(finishReason ? `Gemini returned no text (${finishReason}).` : "Unexpected response from Gemini.");
		}
		return text;
	} catch (error) {
		if (error instanceof ApiError) throw new Error(`Gemini request failed (${error.status}): ${error.message}`);
		throw error;
	}
}
