/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../base/common/cancellation.js';
import { IEmbeddingProvider } from './embeddings.js';

/**
 * Simple LRU cache for embedding results.
 */
class LRUCache<V> {
	private readonly map = new Map<string, V>();
	constructor(private readonly capacity: number) { }

	get(key: string): V | undefined {
		const val = this.map.get(key);
		if (val !== undefined) {
			this.map.delete(key);
			this.map.set(key, val);
		}
		return val;
	}

	set(key: string, value: V): void {
		if (this.map.has(key)) this.map.delete(key);
		else if (this.map.size >= this.capacity) {
			this.map.delete(this.map.keys().next().value!);
		}
		this.map.set(key, value);
	}
}

/**
 * Deterministic mock embedding provider for testing and development.
 * Generates 128-dimensional vectors from text content.
 */
export class MockEmbeddingProvider implements IEmbeddingProvider {
	declare readonly _serviceBrand: undefined;

	readonly embeddingDimension = 128;

	private readonly cache = new LRUCache<Float32Array>(512);

	async isAvailable(): Promise<boolean> {
		return true;
	}

	async provideEmbeddings(texts: string[], _token: CancellationToken): Promise<Float32Array[]> {
		return texts.map(text => this.embed(text));
	}

	private embed(text: string): Float32Array {
		const cached = this.cache.get(text);
		if (cached) return cached;

		const dim = this.embeddingDimension;
		const embedding = new Float32Array(dim).fill(0);
		for (let i = 0; i < text.length; i++) {
			embedding[i % dim] += text.charCodeAt(i) / 1000;
		}
		const magnitude = Math.sqrt(embedding.reduce((s, v) => s + v * v, 0)) || 1;
		for (let i = 0; i < dim; i++) {
			embedding[i] /= magnitude;
		}
		this.cache.set(text, embedding);
		return embedding;
	}
}
