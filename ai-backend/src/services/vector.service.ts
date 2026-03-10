import * as lancedb from "@lancedb/lancedb";
import path from "path";

const DB_PATH = path.join(process.cwd(), "data", "lancedb");

export class VectorService {
	private static db: lancedb.Connection | null = null;

	static async connect() {
		if (!this.db) {
			this.db = await lancedb.connect(DB_PATH);
		}
		return this.db;
	}

	static async indexChunks(projectId: string, chunks: { text: string; vector: number[]; metadata: any }[]) {
		const db = await this.connect();
		const tableName = `project_${projectId.replace(/[^a-zA-Z0-9]/g, "_")}`;

		let table;
		try {
			table = await db.openTable(tableName);
			await table.add(chunks);
		} catch {
			table = await db.createTable(tableName, chunks);
		}
	}

	static async search(projectId: string, queryVector: number[], k: number = 5) {
		const db = await this.connect();
		const tableName = `project_${projectId.replace(/[^a-zA-Z0-9]/g, "_")}`;

		try {
			const table = await db.openTable(tableName);
			const results = await table.vectorSearch(queryVector)
				.limit(k)
				.toArray();
			return results;
		} catch {
			return [];
		}
	}
}
