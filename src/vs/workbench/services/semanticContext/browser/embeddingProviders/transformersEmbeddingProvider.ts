/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { IEmbeddingProvider } from '../../common/embeddings.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { INativeEmbeddingService } from '../../common/nativeEmbeddingService.js';
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
 * Proxy embedding provider that offloads inference to the Shared Process
 * via INativeEmbeddingService. This resolves module resolution issues
 * and optimizes performance on i3 hardware.
 */
export class TransformersEmbeddingProvider implements IEmbeddingProvider {
	declare readonly _serviceBrand: undefined;

	readonly embeddingDimension = 768;

	private readonly cache = new LRUCache<Float32Array>(LRU_CAPACITY);

	private readonly batchQueue: { text: string; resolve: (emb: Float32Array) => void; reject: (err: any) => void }[] = [];
	private batchTimer: any = null;
	private readonly MAX_BATCH_SIZE = 32;
	private readonly BATCH_DELAY_MS = 10;

	constructor(
		@INativeEmbeddingService private readonly nativeService: INativeEmbeddingService,
		@ILogService private readonly logService: ILogService
	) { }

	async isAvailable(): Promise<boolean> {
		return true;
	}

	async provideEmbeddings(inputs: (ICodeChunk | { text: string })[], token: CancellationToken): Promise<Float32Array[]> {
		const results: Float32Array[] = new Array(inputs.length);
		const promises: Promise<void>[] = [];

		for (let i = 0; i < inputs.length; i++) {
			const text = inputs[i].text;
			const cached = this.cache.get(text);
			if (cached) {
				results[i] = cached;
			} else {
				promises.push(new Promise<void>((resolve, reject) => {
					this.batchQueue.push({
						text,
						resolve: (emb) => {
							results[i] = emb;
							resolve();
						},
						reject
					});
				}));
			}
		}

		if (this.batchQueue.length > 0 && !this.batchTimer) {
			this.batchTimer = setTimeout(() => this.flushBatch(), this.BATCH_DELAY_MS);
		}

		if (this.batchQueue.length >= this.MAX_BATCH_SIZE) {
			this.flushBatch();
		}

		await Promise.all(promises);
		return results;
	}

	private async flushBatch(): Promise<void> {
		if (this.batchTimer) {
			clearTimeout(this.batchTimer);
			this.batchTimer = null;
		}

		if (this.batchQueue.length === 0) return;

		const batch = this.batchQueue.splice(0, this.MAX_BATCH_SIZE);

		// If there's still more in the queue, schedule another flush
		if (this.batchQueue.length > 0) {
			this.batchTimer = setTimeout(() => this.flushBatch(), this.BATCH_DELAY_MS);
		}

		try {
			const texts = batch.map(b => b.text);
			const buffers = await this.nativeService.provideEmbeddings(texts, CancellationToken.None);

			for (let i = 0; i < buffers.length; i++) {
				const buffer = buffers[i];
				if (buffer.byteLength > 0) {
					const float32 = new Float32Array(buffer.buffer.buffer, buffer.buffer.byteOffset, buffer.buffer.byteLength / 4);
					this.cache.set(texts[i], float32);
					batch[i].resolve(float32);
				} else {
					const zeros = new Float32Array(this.embeddingDimension).fill(0);
					batch[i].resolve(zeros);
				}
			}
		} catch (err) {
			this.logService.error(`TransformersEmbeddingProvider: failed to provide embeddings via native service: ${err}`);
			const zeros = new Float32Array(this.embeddingDimension).fill(0);
			for (const b of batch) {
				b.resolve(zeros);
			}
		}
	}
}
