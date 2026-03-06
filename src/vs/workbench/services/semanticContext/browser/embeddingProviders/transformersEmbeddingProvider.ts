import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { IEmbeddingProvider } from '../../common/embeddings.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { INativeEmbeddingService } from '../../common/nativeEmbeddingService.js';

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

	constructor(
		@INativeEmbeddingService private readonly nativeService: INativeEmbeddingService,
		@ILogService private readonly logService: ILogService
	) { }

	async isAvailable(): Promise<boolean> {
		return true;
	}

	async provideEmbeddings(texts: string[], token: CancellationToken): Promise<Float32Array[]> {
		const results: Float32Array[] = new Array(texts.length);
		const toFetch: { text: string; index: number }[] = [];

		// Check cache first
		for (let i = 0; i < texts.length; i++) {
			const cached = this.cache.get(texts[i]);
			if (cached) {
				results[i] = cached;
			} else {
				toFetch.push({ text: texts[i], index: i });
			}
		}

		if (toFetch.length === 0) {
			return results;
		}

		try {
			// Call the native service in the Shared Process
			const buffers = await this.nativeService.provideEmbeddings(toFetch.map(tf => tf.text), token);

			for (let i = 0; i < buffers.length; i++) {
				const buffer = buffers[i];
				const originalIndex = toFetch[i].index;

				if (buffer.byteLength > 0) {
					// Convert VSBuffer back to Float32Array
					const float32 = new Float32Array(buffer.buffer.buffer, buffer.buffer.byteOffset, buffer.buffer.byteLength / 4);
					this.cache.set(toFetch[i].text, float32);
					results[originalIndex] = float32;
				} else {
					results[originalIndex] = new Float32Array(this.embeddingDimension).fill(0);
				}
			}
		} catch (err) {
			this.logService.error(`TransformersEmbeddingProvider: failed to provide embeddings via native service: ${err}`);
			for (const tf of toFetch) {
				results[tf.index] = new Float32Array(this.embeddingDimension).fill(0);
			}
		}

		return results;
	}
}
