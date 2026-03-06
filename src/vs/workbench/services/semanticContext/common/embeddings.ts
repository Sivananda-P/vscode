/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../base/common/cancellation.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';

export const IEmbeddingProvider = createDecorator<IEmbeddingProvider>('embeddingProvider');

export interface IEmbeddingProvider {
	readonly _serviceBrand: undefined;

	/** Dimension of each embedding vector. */
	readonly embeddingDimension: number;

	/** Check if the provider is reachable and configured. */
	isAvailable(): Promise<boolean>;

	/** Compute embeddings for a batch of texts. */
	provideEmbeddings(texts: string[], token: CancellationToken): Promise<Float32Array[]>;
}
