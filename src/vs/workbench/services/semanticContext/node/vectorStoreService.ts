/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IVectorStoreService, ISearchResult } from '../common/vectorStore.js';
import { ICodeChunk } from '../common/semanticIndexer.js';
import { URI } from '../../../../base/common/uri.js';
import { IEnvironmentService } from '../../../../platform/environment/common/environment.js';
import { join } from '../../../../base/common/path.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { VPTree, cosineDistance } from '../common/vectorIndex.js';

/**
 * Node-side implementation of VectorStoreService using SQLite.
 * Used primarily in the Shared Process.
 */
export class VectorStoreService extends Disposable implements IVectorStoreService {
	declare readonly _serviceBrand: undefined;

	private db: any;
	private readonly dbPath: string;
	private index: VPTree<any> | undefined;

	constructor(
		@IEnvironmentService environmentService: IEnvironmentService,
		@ILogService private readonly logService: ILogService
	) {
		super();
		this.dbPath = join(environmentService.userRoamingDataHome.fsPath, 'semantic_context_v2.vscdb');
	}

	async init(): Promise<void> {
		if (this.db) {
			return;
		}

		const sqlite3 = await import('@vscode/sqlite3');
		return new Promise((resolve, reject) => {
			this.db = new sqlite3.default.Database(this.dbPath, (err: Error | null) => {
				if (err) {
					this.logService.error(`VectorStoreService: Failed to open database at ${this.dbPath}: ${err}`);
					return reject(err);
				}
				this.db.serialize(() => {
					this.db.run(`
						CREATE TABLE IF NOT EXISTS Chunks (
							id TEXT PRIMARY KEY,
							uri TEXT,
							filePath TEXT,
							startLineNumber INTEGER,
							startColumn INTEGER,
							endLineNumber INTEGER,
							endColumn INTEGER,
							text TEXT,
							symbolName TEXT,
							symbolType TEXT,
							embedding BLOB,
							indexedAt INTEGER
						)
					`);
					this.db.run(`CREATE INDEX IF NOT EXISTS idx_chunks_uri ON Chunks (uri)`);
					this.db.run(`CREATE INDEX IF NOT EXISTS idx_chunks_symbol ON Chunks (symbolName)`, async (err: Error | null) => {
						if (err) {
							reject(err);
						} else {
							this.logService.info(`VectorStoreService: Database initialized at ${this.dbPath}`);
							try {
								await this.rebuildIndex();
								resolve();
							} catch (e) {
								reject(e);
							}
						}
					});
				});
			});
		});
	}

	async rebuildIndex(): Promise<void> {
		if (!this.db) {
			await this.init();
		}
		this.logService.info('VectorStoreService: building in-memory VP-Tree index...');
		this.index = new VPTree(cosineDistance);
		return new Promise((resolve, reject) => {
			this.db.all('SELECT * FROM Chunks', (err: Error | null, rows: any[]) => {
				if (err) {
					return reject(err);
				}
				const items = rows.map(row => ({
					vector: new Float32Array(row.embedding.buffer, row.embedding.byteOffset, row.embedding.byteLength / 4),
					metadata: {
						uri: URI.parse(row.uri),
						range: {
							startLineNumber: row.startLineNumber,
							startColumn: row.startColumn,
							endLineNumber: row.endLineNumber,
							endColumn: row.endColumn
						},
						text: row.text,
						symbolName: row.symbolName ?? undefined,
						symbolType: row.symbolType ?? undefined
					}
				}));
				this.index!.build(items);
				this.logService.info(`VectorStoreService: index rebuilt with ${items.length} items.`);
				resolve();
			});
		});
	}

	async addChunks(chunks: ICodeChunk[], embeddings: VSBuffer[], skipIndexUpdate = false): Promise<void> {
		if (!this.db) {
			await this.init();
		}
		if (chunks.length !== embeddings.length) {
			throw new Error('Chunks and embeddings length mismatch');
		}

		return new Promise((resolve, reject) => {
			this.db.serialize(() => {
				this.db.run('BEGIN TRANSACTION');
				const stmt = this.db.prepare(`
					INSERT OR REPLACE INTO Chunks
						(id, uri, filePath, startLineNumber, startColumn, endLineNumber, endColumn, text, symbolName, symbolType, embedding, indexedAt)
					VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
				`);
				const now = Date.now();
				for (let i = 0; i < chunks.length; i++) {
					const c = chunks[i];
					const emb = embeddings[i];
					stmt.run(
						c.id,
						c.uri.toString(),
						c.filePath,
						c.range.startLineNumber,
						c.range.startColumn,
						c.range.endLineNumber,
						c.range.endColumn,
						c.text,
						c.symbolName ?? null,
						c.symbolType ?? null,
						emb.buffer,
						now
					);
				}
				stmt.finalize();
				this.db.run('COMMIT', async (err: Error | null) => {
					if (err) {
						reject(err);
					} else {
						if (!skipIndexUpdate) {
							await this.rebuildIndex();
						}
						resolve();
					}
				});
			});
		});
	}

	async deleteChunks(uri: URI, skipIndexUpdate = false): Promise<void> {
		if (!this.db) {
			await this.init();
		}
		return new Promise((resolve, reject) => {
			this.db.run(`DELETE FROM Chunks WHERE uri = ?`, [uri.toString()], async (err: Error | null) => {
				if (err) {
					reject(err);
				} else {
					if (!skipIndexUpdate) {
						await this.rebuildIndex();
					}
					resolve();
				}
			});
		});
	}

	async search(queryEmbedding: VSBuffer, limit = 10): Promise<ISearchResult[]> {
		if (!this.db) {
			await this.init();
		}
		if (!this.index) {
			await this.rebuildIndex();
		}

		const queryArr = new Float32Array(queryEmbedding.buffer.buffer, queryEmbedding.buffer.byteOffset, queryEmbedding.buffer.byteLength / 4);
		const matches = this.index!.search(queryArr, limit);

		return matches.map(m => ({
			...m.metadata,
			score: 1 - m.distance
		}));
	}

	async searchByText(query: string, limit = 10): Promise<ISearchResult[]> {
		// Professional Phase 8: Text-based semantic search is now handled by the backend.
		// This node implementation is a legacy fallback.
		this.logService.warn('VectorStoreService (Node): searchByText called. This implementation is a stub.');
		return [];
	}

	async indexFile(uri: URI, text: string, languageId: string, skipIndexUpdate?: boolean): Promise<number> {
		// Professional Phase 8: Server-side indexing is now handled by the backend.
		// This node implementation is a legacy fallback.
		this.logService.warn('VectorStoreService (Node): indexFile called. This implementation is a stub.');
		return 0;
	}

	async getFileMtimes(): Promise<[string, number][]> {
		if (!this.db) {
			await this.init();
		}
		return new Promise((resolve, reject) => {
			this.db.all(`SELECT DISTINCT uri, MAX(indexedAt) as mtime FROM Chunks GROUP BY uri`, (err: Error | null, rows: any[]) => {
				if (err) {
					return reject(err);
				}
				const result: [string, number][] = [];
				for (const row of rows) {
					result.push([row.uri, row.mtime]);
				}
				resolve(result);
			});
		});
	}

	async close(): Promise<void> {
		if (this.db) {
			return new Promise((resolve, reject) => {
				this.db.close((err: Error | null) => {
					if (err) {
						reject(err);
					} else {
						resolve();
					}
				});
			});
		}
	}

	override dispose(): void {
		if (this.db) {
			this.db.close((err: Error | null) => {
				if (err) {
					this.logService.error(`VectorStoreService: Failed to close database: ${err}`);
				}
			});
		}
		super.dispose();
	}
}
