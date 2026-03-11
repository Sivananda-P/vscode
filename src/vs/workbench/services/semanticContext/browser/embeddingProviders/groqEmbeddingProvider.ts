/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { IEmbeddingProvider } from '../../common/embeddings.js';
import { IAIService } from '../../../../../platform/ai/common/ai.js';
import { ILogService } from '../../../../../platform/log/common/log.js';

import { Disposable } from '../../../../../base/common/lifecycle.js';

export class GroqEmbeddingProvider extends Disposable implements IEmbeddingProvider {
	declare readonly _serviceBrand: undefined;

	readonly embeddingDimension = 384;

	constructor(
		@IAIService private readonly aiService: IAIService,
		@ILogService private readonly logService: ILogService
	) {
		super();
	}

	async isAvailable(): Promise<boolean> {
		return true; // Backend is assumed available or we can add a health check
	}

	async provideEmbeddings(texts: string[], token: CancellationToken): Promise<Float32Array[]> {
		const backendUrl = 'http://127.0.0.1:3000/embeddings/index';

		try {
			await this.aiService.request(backendUrl, {
				projectId: 'default_project',
				chunks: texts.map(text => ({ text, metadata: {} }))
			}, token);

			// Note: The backend currently stores the embeddings.
			// In a full implementation, we might return them if the client needs them locally.
			// For now, we return empty arrays if the client logic expects them, but the indexing is done.
			return texts.map(() => new Float32Array(this.embeddingDimension).fill(0));

		} catch (err) {
			this.logService.error(`GroqEmbeddingProvider: Backend call failed: ${err}`);
			return texts.map(() => new Float32Array(this.embeddingDimension).fill(0));
		}
	}
}
