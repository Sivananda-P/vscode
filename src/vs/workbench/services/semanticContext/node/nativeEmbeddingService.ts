/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../base/common/cancellation.js';
import { INativeEmbeddingService } from '../common/nativeEmbeddingService.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { pipeline } from '@xenova/transformers';

/**
 * Implementation of INativeEmbeddingService that runs in the Shared Process (Node).
 * Offloads heavy AI inference from the Renderer process.
 */
export class NativeEmbeddingService implements INativeEmbeddingService {
	declare readonly _serviceBrand: undefined;

	private _pipeline: any | undefined;
	private _initPromise: Promise<void> | undefined;
	private readonly modelName = 'Xenova/jina-embeddings-v2-base-code';

	constructor(
		@ILogService private readonly logService: ILogService
	) { }

	private async _ensurePipeline(): Promise<void> {
		if (this._pipeline) return;
		if (this._initPromise) return this._initPromise;

		this._initPromise = (async () => {
			this.logService.info(`NativeEmbeddingService: loading model ${this.modelName}...`);
			try {
				this._pipeline = await pipeline('feature-extraction', this.modelName);
				this.logService.info(`NativeEmbeddingService: model ${this.modelName} loaded successfully.`);
			} catch (err) {
				this.logService.error(`NativeEmbeddingService: failed to load model ${this.modelName}: ${err}`);
				this._initPromise = undefined;
				throw err;
			}
		})();

		return this._initPromise;
	}

	async provideEmbeddings(texts: string[], token: CancellationToken): Promise<VSBuffer[]> {
		await this._ensurePipeline();
		if (!this._pipeline) {
			return texts.map(() => VSBuffer.alloc(0));
		}

		const results: VSBuffer[] = [];
		try {
			// Pass the entire array to the pipeline for true batching performance
			const output = await this._pipeline(texts, { pooling: 'mean', normalize: true });

			// The output is a tensor-like object where data is a flat Float32Array
			// Dimension is [batch_size, 768]
			const fullData = output.data;
			const dim = 768;

			for (let i = 0; i < texts.length; i++) {
				const slice = fullData.slice(i * dim, (i + 1) * dim);
				results.push(VSBuffer.wrap(new Uint8Array(slice.buffer, slice.byteOffset, slice.byteLength)));
			}
		} catch (err) {
			this.logService.error(`NativeEmbeddingService: batch embedding failed: ${err}`);
			return texts.map(() => VSBuffer.alloc(0));
		}

		return results;
	}
}
