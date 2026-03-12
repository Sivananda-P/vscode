import { CancellationToken } from '../../../../base/common/cancellation.js';
import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { ICodeChunk } from './semanticIndexer.js';

export const IEmbeddingProvider = createDecorator<IEmbeddingProvider>('embeddingProvider');

export interface IEmbeddingProvider {
	readonly _serviceBrand: undefined;

	/** Dimension of each embedding vector. */
	readonly embeddingDimension: number;

	/** Check if the provider is reachable and configured. */
	isAvailable(): Promise<boolean>;

	/** Compute embeddings for a batch of chunks or raw text. */
	provideEmbeddings(chunks: (ICodeChunk | { text: string })[], token: CancellationToken): Promise<Float32Array[]>;
}
