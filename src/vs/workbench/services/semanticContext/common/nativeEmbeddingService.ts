/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { VSBuffer } from '../../../../base/common/buffer.js';

export const INativeEmbeddingService = createDecorator<INativeEmbeddingService>('nativeEmbeddingService');

export interface INativeEmbeddingService {
	readonly _serviceBrand: undefined;

	/** Compute embeddings for a batch of texts in the Shared Process. */
	provideEmbeddings(texts: string[], token: CancellationToken): Promise<VSBuffer[]>;
}
