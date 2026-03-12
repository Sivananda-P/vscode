/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { IEmbeddingProvider } from '../../common/embeddings.js';

import { Disposable } from '../../../../../base/common/lifecycle.js';

import { ICodeChunk } from '../../common/semanticIndexer.js';

export class GroqEmbeddingProvider extends Disposable implements IEmbeddingProvider {
	declare readonly _serviceBrand: undefined;

	readonly embeddingDimension = 384;

	constructor(
	) {
		super();
	}

	async isAvailable(): Promise<boolean> {
		return true; // Backend is assumed available or we can add a health check
	}

	async provideEmbeddings(inputs: (ICodeChunk | { text: string })[], token: CancellationToken): Promise<Float32Array[]> {
		// Professional Phase 8: The backend now generates its own embeddings
		// during the 'addChunks' call in VectorStoreServiceClient.
		// We return zero-filled arrays as placeholders for the IDE's legacy data flow.
		return inputs.map(() => new Float32Array(this.embeddingDimension).fill(0));
	}
}
