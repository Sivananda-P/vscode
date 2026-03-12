/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { IEmbeddingProvider } from '../../common/embeddings.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { ISecretStorageService } from '../../../../../platform/secrets/common/secrets.js';
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

export interface IRemoteAPIConfig {
	endpoint: string;
	apiKey: string;
	model: string;
	embeddingDimension: number;
}

/**
 * OpenAI-compatible embedding provider.
 * Works with OpenAI, Azure OpenAI, or any compatible REST API.
 *
 * Uses VS Code secrets API pattern: call configure() after retrieving the key.
 */
export class RemoteAPIEmbeddingProvider implements IEmbeddingProvider {
	declare readonly _serviceBrand: undefined;

	readonly embeddingDimension: number = 1536; // OpenAI text-embedding-3-small default

	private readonly cache = new LRUCache<Float32Array>(LRU_CAPACITY);
	private apiKey: string | undefined;

	constructor(
		@ILogService private readonly logService: ILogService,
		@ISecretStorageService private readonly secretStorageService: ISecretStorageService,
		private readonly model = 'text-embedding-3-small',
		private readonly endpoint = 'https://api.openai.com/v1/embeddings'
	) { }

	async isAvailable(): Promise<boolean> {
		if (this.apiKey) return true;
		this.apiKey = await this.secretStorageService.get('semanticContext.openaiApiKey');
		return !!this.apiKey;
	}

	async provideEmbeddings(inputs: (ICodeChunk | { text: string })[], token: CancellationToken): Promise<Float32Array[]> {
		if (!this.apiKey) {
			this.apiKey = await this.secretStorageService.get('semanticContext.openaiApiKey');
		}
		if (!this.apiKey) {
			this.logService.warn('RemoteAPIEmbeddingProvider: not configured, returning zero vectors');
			return inputs.map(() => new Float32Array(this.embeddingDimension).fill(0));
		}

		const results: Float32Array[] = [];
		for (const input of inputs) {
			const text = input.text;
			if (token.isCancellationRequested) {
				// Fill remaining with zero vectors if cancellation occurs mid-loop
				while (results.length < inputs.length) {
					results.push(new Float32Array(this.embeddingDimension).fill(0));
				}
				break;
			}

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
					headers: {
						'Content-Type': 'application/json',
						'Authorization': `Bearer ${this.apiKey}`
					},
					body: JSON.stringify({ model: this.model, input: text }),
					signal: controller.signal
				});
				cancel.dispose();

				if (!response.ok) {
					throw new Error(`RemoteAPI HTTP ${response.status}: ${await response.text()}`);
				}

				const data = await response.json() as { data: { embedding: number[] }[] };
				const embedding = new Float32Array(data.data[0].embedding);
				this.cache.set(text, embedding);
				results.push(embedding);
			} catch (err) {
				this.logService.error(`RemoteAPIEmbeddingProvider: failed to embed text: ${err}`);
				results.push(new Float32Array(this.embeddingDimension).fill(0));
			}
		}
		return results;
	}
}
