/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as lancedb from '@lancedb/lancedb';
import path from 'path';

const DB_PATH = path.join(process.cwd(), 'data', 'lancedb');

export class VectorService {
	private static db: lancedb.Connection | null = null;

	static async connect() {
		if (!this.db) {
			this.db = await lancedb.connect(DB_PATH);
		}
		return this.db;
	}

	/**
	 * Indexes chunks into LanceDB.
	 * Expected metadata shape for AST chunks:
	 * {
	 *   id: string,
	 *   uri: string,
	 *   filePath: string,
	 *   range: { startLineNumber: number, startColumn: number, endLineNumber: number, endColumn: number },
	 *   symbolName?: string,
	 *   symbolType?: string
	 * }
	 */
	private static creationLocks = new Set<string>();

	/**
	 * Indexes chunks into LanceDB.
	 */
	static async indexChunks(projectId: string, chunks: { text: string; vector: number[]; metadata: any }[]): Promise<void> {
		if (chunks.length === 0) {
			return;
		}

		const db = await this.connect();
		const tableName = `project_${projectId.replace(/[^a-zA-Z0-9]/g, '_')}`;

		// NORMALIZE: Ensure every chunk has all schema keys (id, uri, filePath, range, symbolName, symbolType)
		// LanceDB is strict: schema must match. We normalize up front.
		const normalizedChunks = chunks.map(c => ({
			...c,
			metadata: {
				id: c.metadata.id || '',
				uri: c.metadata.uri || '',
				filePath: c.metadata.filePath || '',
				range: c.metadata.range || { startLineNumber: 1, startColumn: 1, endLineNumber: 1, endColumn: 1 },
				symbolName: c.metadata.symbolName || '',
				symbolType: c.metadata.symbolType || 'symbol'
			}
		}));

		// Use a simple lock to prevent race conditions during parallel creation or healing
		while (this.creationLocks.has(tableName)) {
			await new Promise(r => setTimeout(r, 100));
		}

		try {
			const tables = await db.tableNames();
			if (tables.includes(tableName)) {
				const table = await db.openTable(tableName);
				console.log(`[Vector] Adding ${normalizedChunks.length} chunks to existing table ${tableName}.`);
				await table.add(normalizedChunks);
			} else {
				this.creationLocks.add(tableName);
				try {
					console.log(`[Vector] Creating new table ${tableName} with ${normalizedChunks.length} chunks.`);
					await db.createTable(tableName, normalizedChunks);
				} finally {
					this.creationLocks.delete(tableName);
				}
			}
		} catch (err: any) {
			// Fail-safe 1: Handle "table already exists" race condition
			if (err?.message?.includes('already exists') || err?.code === 'TableAlreadyExists') {
				const table = await db.openTable(tableName);
				await table.add(normalizedChunks);
				return;
			}
			
			// Fail-safe 2: Handle "Found field not in schema" (Schema Mismatch)
			// This happens if the table was created with an old schema. We reset it.
			const errorMessage = err instanceof Error ? err.message : String(err);
			if (errorMessage.includes('Found field not in schema') || 
				errorMessage.includes('schema mismatch') || 
				errorMessage.includes('not in schema')) {
				
				// Ensure only one request triggers healing
				if (this.creationLocks.has(tableName)) {
					// Wait for the other request to finish healing
					while (this.creationLocks.has(tableName)) {
						await new Promise(r => setTimeout(r, 100));
					}
					// Retry indexing after healing
					return this.indexChunks(projectId, chunks);
				}

				this.creationLocks.add(tableName);
				console.warn(`[Vector] Schema mismatch detected for ${tableName}. Resetting table to fix schema...`);
				try {
					await db.dropTable(tableName);
					await db.createTable(tableName, normalizedChunks);
					console.log(`[Vector] Table ${tableName} recreated successfully with new schema.`);
				} catch (dropErr: any) {
					console.error(`[Vector] Failed to reset table:`, dropErr.message);
				} finally {
					this.creationLocks.delete(tableName);
				}
				return;
			}

			console.error(`[Vector] Error indexing to ${tableName}:`, err);
			throw err;
		}
	}

	static async search(projectId: string, queryVector: number[], k: number = 5) {
		const db = await this.connect();
		const tableName = `project_${projectId.replace(/[^a-zA-Z0-9]/g, '_')}`;

		try {
			const table = await db.openTable(tableName);
			const results = await table.vectorSearch(queryVector)
				.limit(k)
				.toArray();
			return results;
		} catch (err) {
			console.error(`[Vector] Search failed on table ${tableName}:`, err);
			return [];
		}
	}
}
