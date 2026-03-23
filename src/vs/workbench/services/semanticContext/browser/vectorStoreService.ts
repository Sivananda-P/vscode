/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IVectorStoreService, type ISearchResult, type IRange } from '../common/vectorStore.js';
import { ICodeChunk } from '../common/semanticIndexer.js';
import { URI } from '../../../../base/common/uri.js';
import { IAIService } from '../../../../platform/ai/common/ai.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';

/**
 * Professional VectorStore client that proxies all requests to the AI Backend.
 * Uses IAIService (IPC bridge) to communicate with the standalone Node.js server.
 */
export class VectorStoreServiceClient extends Disposable implements IVectorStoreService {
	declare readonly _serviceBrand: undefined;

	private backendAvailable = true;
	get isAvailable() { return this.backendAvailable; }
	private lastCheckTime = 0;
	private readonly CHECK_INTERVAL = 30000; // 30 seconds

	constructor(
		@IAIService private readonly aiService: IAIService,
		@ILogService private readonly logService: ILogService,
		@IConfigurationService private readonly configurationService: IConfigurationService
	) {
		super();
	}

	private get backendUrl(): string {
		const url = this.configurationService.getValue<string>('cogniai.backendUrl') || 'http://localhost:3000';
		return url.endsWith('/') ? url.slice(0, -1) : url;
	}

	async init(): Promise<void> {
		this.lastCheckTime = Date.now();
		try {
			await this.aiService.request(`${this.backendUrl}/ai/query`, { prompt: 'ping' }, CancellationToken.None);
			this.backendAvailable = true;
			this.logService.info(`VectorStoreServiceClient: Backend connectivity verified at ${this.backendUrl}`);
		} catch (err) {
			this.backendAvailable = false;
			this.logService.warn(`VectorStoreServiceClient: Backend not reachable at ${this.backendUrl}. Semantic features will be limited.`);
		}
	}

	private async checkConnectivity(): Promise<boolean> {
		if (this.backendAvailable) {
			return true;
		}

		const now = Date.now();
		if (now - this.lastCheckTime < this.CHECK_INTERVAL) {
			return false;
		}

		this.lastCheckTime = now;
		try {
			await this.aiService.request(`${this.backendUrl}/ai/query`, { prompt: 'ping' }, CancellationToken.None);
			this.backendAvailable = true;
			this.logService.info(`VectorStoreServiceClient: Backend connectivity restored at ${this.backendUrl}`);
			return true;
		} catch {
			return false;
		}
	}

	async addChunks(chunks: ICodeChunk[], embeddings: VSBuffer[], skipIndexUpdate?: boolean, mtime?: number): Promise<void> {
		if (!(await this.checkConnectivity())) {
			return;
		}

		const backendUrl = `${this.backendUrl}/embeddings/index`;

		// Prepare chunks with metadata for the backend
		const backendChunks = chunks.map(c => ({
			text: c.text,
			metadata: {
				id: c.id,
				uri: c.uri.toString(),
				filePath: c.filePath,
				range: c.range,
				symbolName: c.symbolName,
				symbolType: c.symbolType,
				mtime: mtime || 0
			}
		}));

		try {
			await this.aiService.request(backendUrl, {
				projectId: 'default_project',
				chunks: backendChunks
			}, CancellationToken.None);
		} catch (err) {
			this.backendAvailable = false;
			this.logService.error(`VectorStoreServiceClient: addChunks failed: ${err}`);
		}
	}

	async deleteChunks(uri: URI, skipIndexUpdate?: boolean): Promise<void> {
		if (!(await this.checkConnectivity())) {
			return;
		}

		const backendUrl = `${this.backendUrl}/embeddings/delete`;
		try {
			await this.aiService.request(backendUrl, {
				projectId: 'default_project',
				uri: uri.toString()
			}, CancellationToken.None);
			this.logService.trace(`VectorStoreServiceClient: Deleted chunks for ${uri.toString()}`);
		} catch (err) {
			this.backendAvailable = false;
			this.logService.error(`VectorStoreServiceClient: deleteChunks failed: ${err}`);
		}
	}

	async rebuildIndex(): Promise<void> {
		// Backend automatically handles index rebuilding in LanceDB
	}

	async search(queryEmbedding: VSBuffer, limit = 10): Promise<ISearchResult[]> {
		// Legacy search - no-op in backend bridge mode
		return [];
	}

	async indexFile(uri: URI, text: string, languageId: string, skipIndexUpdate?: boolean, mtime?: number): Promise<number> {
		if (!(await this.checkConnectivity())) {
			return 0;
		}

		const backendUrl = `${this.backendUrl}/embeddings/index-file`;
		try {
			const response = await this.aiService.request(backendUrl, {
				projectId: 'default_project',
				uri: uri.toString(),
				text,
				languageId,
				skipIndexUpdate,
				mtime: mtime || 0
			}, CancellationToken.None) as { count: number };
			return response.count || 0;
		} catch (err) {
			this.backendAvailable = false;
			this.logService.error(`VectorStoreServiceClient: indexFile failed: ${err}`);
			return 0;
		}
	}

	/** New professional search that takes a text query. */
	async searchByText(query: string, limit = 10): Promise<ISearchResult[]> {
		if (!(await this.checkConnectivity())) {
			return [];
		}

		const backendUrl = `${this.backendUrl}/search`;
		try {
			const response = await this.aiService.request(backendUrl, {
				projectId: 'default_project',
				query,
				k: limit
			}, CancellationToken.None) as { results: { text: string; score: number; metadata: { uri: string; range: IRange; symbolName?: string; symbolType?: string } }[] };

			return response.results.map(r => ({
				uri: URI.parse(r.metadata.uri),
				range: r.metadata.range,
				text: r.text,
				score: r.score,
				symbolName: r.metadata.symbolName,
				symbolType: r.metadata.symbolType
			}));
		} catch (err) {
			this.backendAvailable = false;
			this.logService.error(`VectorStoreServiceClient: Search failed: ${err}`);
			return [];
		}
	}

	async getFileMtimes(): Promise<[string, number][]> {
		if (!(await this.checkConnectivity())) {
			return [];
		}

		const backendUrl = `${this.backendUrl}/embeddings/mtimes`;
		try {
			const response = await this.aiService.request(backendUrl, {
				projectId: 'default_project'
			}, CancellationToken.None) as { mtimes: [string, number][] };
			return response.mtimes || [];
		} catch (err) {
			this.backendAvailable = false;
			this.logService.error(`VectorStoreServiceClient: getFileMtimes failed: ${err}`);
			return [];
		}
	}

	async close(): Promise<void> {
		// No-op
	}
}
