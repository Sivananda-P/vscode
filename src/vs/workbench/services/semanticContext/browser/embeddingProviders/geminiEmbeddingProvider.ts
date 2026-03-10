/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { IEmbeddingProvider } from '../../common/embeddings.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { IRequestService, asText } from '../../../../../platform/request/common/request.js';

export class GeminiEmbeddingProvider implements IEmbeddingProvider {
	declare readonly _serviceBrand: undefined;

	readonly embeddingDimension = 768;

	constructor(
		@IRequestService private readonly requestService: IRequestService,
		@ILogService private readonly logService: ILogService
	) { }

	async isAvailable(): Promise<boolean> {
		return true; // Backend is assumed available or we can add a health check
	}

	async provideEmbeddings(texts: string[], token: CancellationToken): Promise<Float32Array[]> {
		const backendUrl = 'http://localhost:3000/embeddings/index';

		try {
			const response = await this.requestService.request({
				url: backendUrl,
				type: 'POST',
				headers: {
					'Content-Type': 'application/json'
				},
				data: JSON.stringify({
					projectId: 'default_project',
					chunks: texts.map(text => ({ text, metadata: {} }))
				})
			}, token);

			if (response.res.statusCode !== 200) {
				const errorText = await asText(response);
				throw new Error(`Backend embedding error (${response.res.statusCode}): ${errorText}`);
			}

			// Note: The backend currently stores the embeddings.
			// In a full implementation, we might return them if the client needs them locally.
			// For now, we return empty arrays if the client logic expects them, but the indexing is done.
			return texts.map(() => new Float32Array(this.embeddingDimension).fill(0));

		} catch (err) {
			this.logService.error(`GeminiEmbeddingProvider: Backend call failed: ${err}`);
			return texts.map(() => new Float32Array(this.embeddingDimension).fill(0));
		}
	}
}
