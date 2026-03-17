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
	static async indexChunks(projectId: string, chunks: { text: string; vector: number[]; metadata: any }[]) {
		const db = await this.connect();
		const tableName = `project_${projectId.replace(/[^a-zA-Z0-9]/g, '_')}`;

		try {
			const tables = await db.tableNames();
			if (tables.includes(tableName)) {
				const table = await db.openTable(tableName);
				if (chunks.length > 0) {
					console.log(`[Vector] Adding ${chunks.length} chunks to existing table ${tableName}. First chunk metadata keys:`, Object.keys(chunks[0].metadata));
				}
				await table.add(chunks);
			} else {
				if (chunks.length > 0) {
					console.log(`[Vector] Creating new table ${tableName}. First chunk metadata keys:`, Object.keys(chunks[0].metadata));
				}
				await db.createTable(tableName, chunks);
			}
		} catch (err) {
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
