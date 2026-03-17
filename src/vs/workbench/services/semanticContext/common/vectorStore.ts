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

export interface IRange {
	readonly startLineNumber: number;
	readonly startColumn: number;
	readonly endLineNumber: number;
	readonly endColumn: number;
}

export interface ISearchResult extends ISemanticSearchResult {
	symbolName?: string;
	symbolType?: string;
	range: IRange;
}

export interface IVectorStoreService {
	readonly _serviceBrand: undefined;

	init(): Promise<void>;
	/** Add chunks and their embeddings to the store. */
	addChunks(chunks: ICodeChunk[], embeddings: VSBuffer[], skipIndexUpdate?: boolean): Promise<void>;

	/** Index a file by sending its text to the backend for server-side parsing/chunking. Returns chunks count. */
	indexFile(uri: URI, text: string, languageId: string, skipIndexUpdate?: boolean): Promise<number>;

	/** Delete all chunks for a file. */
	deleteChunks(uri: URI, skipIndexUpdate?: boolean): Promise<void>;

	/** Rebuild the in-memory spatial index from the database. */
	rebuildIndex(): Promise<void>;
	search(queryEmbedding: VSBuffer, limit?: number): Promise<ISearchResult[]>;
	/** Search the codebase semantically using a text query. */
	searchByText(query: string, limit?: number): Promise<ISearchResult[]>;
	getFileMtimes(): Promise<[string, number][]>;
	readonly isAvailable?: boolean;
	close(): Promise<void>;
}
