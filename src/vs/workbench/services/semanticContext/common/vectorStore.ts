/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from '../../../../platform/instantiation/common/instantiation.js';
import { URI } from '../../../../base/common/uri.js';
import { ICodeChunk } from './semanticIndexer.js';
import { ISemanticSearchResult } from './semanticContext.js';
import { VSBuffer } from '../../../../base/common/buffer.js';

export const IVectorStoreService = createDecorator<IVectorStoreService>('vectorStoreService');

export interface ISearchResult extends ISemanticSearchResult {
	symbolName?: string;
	symbolType?: string;
}

export interface IVectorStoreService {
	readonly _serviceBrand: undefined;

	init(): Promise<void>;
	/** Add chunks and their embeddings to the store. */
	addChunks(chunks: ICodeChunk[], embeddings: VSBuffer[], skipIndexUpdate?: boolean): Promise<void>;

	/** Delete all chunks for a file. */
	deleteChunks(uri: URI, skipIndexUpdate?: boolean): Promise<void>;

	/** Rebuild the in-memory spatial index from the database. */
	rebuildIndex(): Promise<void>;
	search(queryEmbedding: VSBuffer, limit?: number): Promise<ISearchResult[]>;
	getFileMtimes(): Promise<[string, number][]>;
	close(): Promise<void>;
}
