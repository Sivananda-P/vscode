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
			const table = await db.openTable(tableName);
			await table.add(chunks);
		} catch (err) {
			console.log(`[Vector] Table ${tableName} not found or error adding, creating new:`, err);
			try {
				await db.createTable(tableName, chunks);
			} catch (createErr) {
				console.error(`[Vector] FAILED to create/add to table ${tableName}:`, createErr);
				throw createErr;
			}
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
