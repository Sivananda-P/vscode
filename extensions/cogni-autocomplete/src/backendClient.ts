/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/** Payload sent to the backend for code completion. */
export interface CompletionRequest {
	prefix: string;
	suffix: string;
	language: string;
	filePath: string;
	context: string;
}

/**
 * BackendClient — HTTP client for the CogniAI autocomplete endpoints.
 *
 * Provides two methods:
 *  - fetchComplete()  : POST /ai/complete (single JSON response)
 *  - fetchStreaming() : POST /ai/complete/stream (SSE token-by-token)
 *
 * Both accept an AbortSignal so the caller (CompletionProvider) can cancel
 * anytime a new keystroke arrives.
 */
export class BackendClient {
	private readonly _baseUrl: string;

	constructor(baseUrl: string) {
		// Strip trailing slash
		this._baseUrl = baseUrl.replace(/\/$/, '');
	}

	/**
	 * Non-streaming completion request.
	 * Returns the full suggestion string on success, or empty string on failure.
	 */
	async fetchComplete(body: CompletionRequest, signal: AbortSignal): Promise<string> {
		const url = `${this._baseUrl}/ai/complete`;

		const response = await fetch(url, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body),
			signal,
		});

		if (!response.ok) {
			const text = await response.text().catch(() => '');
			throw new Error(`Backend /ai/complete returned ${response.status}: ${text}`);
		}

		const data = await response.json() as { suggestion?: string; error?: string };

		if (data.error) {
			throw new Error(`Backend error: ${data.error}`);
		}

		return data.suggestion ?? '';
	}

	/**
	 * Streaming SSE completion request.
	 * Reads `data: {"token":"..."}` events until `data: [DONE]`.
	 * Returns the accumulated suggestion string.
	 */
	async fetchStreaming(body: CompletionRequest, signal: AbortSignal): Promise<string> {
		const url = `${this._baseUrl}/ai/complete/stream`;

		const response = await fetch(url, {
			method: 'POST',
			headers: { 'Content-Type': 'application/json' },
			body: JSON.stringify(body),
			signal,
		});

		if (!response.ok) {
			const text = await response.text().catch(() => '');
			throw new Error(`Backend /ai/complete/stream returned ${response.status}: ${text}`);
		}

		if (!response.body) {
			// Fallback: read full response body as text
			return response.text();
		}

		const reader = response.body.getReader();
		const decoder = new TextDecoder('utf-8');
		let suggestion = '';
		let buffer = '';

		try {
			while (true) {
				if (signal.aborted) {
					reader.cancel();
					break;
				}

				const { done, value } = await reader.read();
				if (done) {
					// Flush the final chunk from the decoder
					const final = decoder.decode();
					if (final) { buffer += final; }
					break;
				}

				// Decode the incoming bytes and accumulate into buffer
				buffer += decoder.decode(value, { stream: true });

				// Process complete SSE lines
				const lines = buffer.split('\n');
				// Keep the last (potentially incomplete) line in the buffer
				buffer = lines.pop() ?? '';

				for (const line of lines) {
					const trimmed = line.trim();
					if (!trimmed) { continue; }

					// Handle case where we get a raw JSON response (not SSE)
					if (!trimmed.startsWith('data:')) {
						try {
							const parsed = JSON.parse(trimmed) as { token?: string; suggestion?: string; error?: string };
							if (parsed.token) { suggestion += parsed.token; }
							if (parsed.suggestion) { return parsed.suggestion; }
							continue;
						} catch { continue; }
					}

					const payload = trimmed.slice(5).trim();

					if (payload === '[DONE]') {
						reader.cancel();
						return suggestion;
					}

					try {
						const parsed = JSON.parse(payload) as { token?: string; error?: string };
						if (parsed.error) {
							throw new Error(`Stream error from backend: ${parsed.error}`);
						}
						if (parsed.token) {
							suggestion += parsed.token;
						}
					} catch (parseErr) {
						// Skip malformed SSE payloads
					}
				}
			}
		} finally {
			reader.releaseLock();
		}

		return suggestion;
	}
}
