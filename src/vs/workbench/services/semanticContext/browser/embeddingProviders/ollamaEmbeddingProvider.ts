/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { IEmbeddingProvider } from '../../common/embeddings.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { ICodeChunk } from '../../common/semanticIndexer.js';

const LRU_CAPACITY = 512;

class LRUCache<V> {
	private readonly map = new Map<string, V>();
	constructor(private readonly capacity: number) { }
	get(key: string): V | undefined {
		const val = this.map.get(key);
		if (val !== undefined) { this.map.delete(key); this.map.set(key, val); }
		return val;
	}
	set(key: string, value: V): void {
		if (this.map.has(key)) { this.map.delete(key); }
		else if (this.map.size >= this.capacity) { this.map.delete(this.map.keys().next().value!); }
		this.map.set(key, value);
	}
}

/**
 * Embedding provider backed by a locally running Ollama instance.
 * Default model: nomic-embed-text (768 dimensions).
 *
 * Start Ollama: `ollama pull nomic-embed-text && ollama serve`
 * Endpoint:     http://localhost:11434/api/embeddings
 */
export class OllamaEmbeddingProvider implements IEmbeddingProvider {
	declare readonly _serviceBrand: undefined;

	readonly embeddingDimension = 768;

	private readonly cache = new LRUCache<Float32Array>(LRU_CAPACITY);
	private readonly model: string;
	private readonly endpoint: string;

	constructor(
		@ILogService private readonly logService: ILogService,
		model = 'nomic-embed-text',
		endpoint = 'http://localhost:11434/api/embeddings'
	) {
		this.model = model;
		this.endpoint = endpoint;
	}

	async isAvailable(): Promise<boolean> {
		try {
			const response = await fetch('http://localhost:11434/api/tags', { signal: AbortSignal.timeout(2000) });
			return response.ok;
		} catch {
			return false;
		}
	}

	async provideEmbeddings(inputs: (ICodeChunk | { text: string })[], token: CancellationToken): Promise<Float32Array[]> {
		const results: Float32Array[] = [];
		for (const input of inputs) {
			const text = input.text;
			if (token.isCancellationRequested) break;

			const cached = this.cache.get(text);
			if (cached) {
				results.push(cached);
				continue;
			}

			try {
				const controller = new AbortController();
				const cancel = token.onCancellationRequested(() => controller.abort());
				const response = await fetch(this.endpoint, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({ model: this.model, prompt: text }),
					signal: controller.signal
				});
				cancel.dispose();

				if (!response.ok) {
					throw new Error(`Ollama HTTP ${response.status}`);
				}

				const data = await response.json() as { embedding: number[] };
				const embedding = new Float32Array(data.embedding);
				this.cache.set(text, embedding);
				results.push(embedding);
			} catch (err) {
				this.logService.error(`OllamaEmbeddingProvider: failed to embed text: ${err}`);
				results.push(new Float32Array(this.embeddingDimension).fill(0));
			}
		}
		return results;
	}
}
