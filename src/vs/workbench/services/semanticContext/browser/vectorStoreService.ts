/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IVectorStoreService, ISearchResult } from '../common/vectorStore.js';
import { ICodeChunk } from '../common/semanticIndexer.js';
import { URI } from '../../../../base/common/uri.js';
import { ISharedProcessService } from '../../../../platform/ipc/electron-browser/services.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { IChannel } from '../../../../base/parts/ipc/common/ipc.js';
import { VSBuffer } from '../../../../base/common/buffer.js';

export class VectorStoreServiceClient extends Disposable implements IVectorStoreService {
	declare readonly _serviceBrand: undefined;

	private readonly channel: IChannel;

	constructor(
		@ISharedProcessService sharedProcessService: ISharedProcessService
	) {
		super();
		this.channel = sharedProcessService.getChannel('vectorStore');
	}

	async init(): Promise<void> {
		return this.channel.call('init');
	}

	async addChunks(chunks: ICodeChunk[], embeddings: VSBuffer[], skipIndexUpdate?: boolean): Promise<void> {
		return this.channel.call('addChunks', [chunks, embeddings, skipIndexUpdate]);
	}

	async deleteChunks(uri: URI, skipIndexUpdate?: boolean): Promise<void> {
		return this.channel.call('deleteChunks', [uri, skipIndexUpdate]);
	}

	async rebuildIndex(): Promise<void> {
		return this.channel.call('rebuildIndex');
	}

	async search(queryEmbedding: VSBuffer, limit = 10): Promise<ISearchResult[]> {
		const results = await this.channel.call<ISearchResult[]>('search', [queryEmbedding, limit]);
		// Revive URIs
		return results.map(r => ({
			...r,
			uri: URI.revive(r.uri)
		}));
	}

	async getFileMtimes(): Promise<[string, number][]> {
		return this.channel.call<[string, number][]>('getFileMtimes');
	}

	async close(): Promise<void> {
		// No-op for client-side
	}
}
