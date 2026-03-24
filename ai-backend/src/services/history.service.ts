/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { promises as fs } from 'fs';
import * as path from 'path';

export interface IHistorySession {
	id: string;
	projectId: string;
	label: string;
	timestamp: number;
	messages: any[];
}

export class HistoryService {
	private static historyPath = path.join(process.cwd(), 'data', 'history');

	private static async ensureDirectory() {
		try {
			await fs.mkdir(this.historyPath, { recursive: true });
		} catch (err) {
			console.error('[HistoryService] Failed to create history directory:', err);
		}
	}

	static async saveSession(session: IHistorySession): Promise<void> {
		await this.ensureDirectory();
		const filePath = path.join(this.historyPath, `${session.id}.json`);
		await fs.writeFile(filePath, JSON.stringify(session, null, 2));
		console.log(`[HistoryService] Saved session: ${session.id} (${session.label})`);
	}

	static async getSessions(projectId: string): Promise<IHistorySession[]> {
		await this.ensureDirectory();
		try {
			const files = await fs.readdir(this.historyPath);
			const sessions: IHistorySession[] = [];

			for (const file of files) {
				if (!file.endsWith('.json')) {
					continue;
				}
				try {
					const content = await fs.readFile(path.join(this.historyPath, file), 'utf8');
					const session = JSON.parse(content) as IHistorySession;
					if (session.projectId === projectId) {
						sessions.push(session);
					}
				} catch (err) {
					console.error(`[HistoryService] Error reading session file ${file}:`, err);
				}
			}

			return sessions.sort((a, b) => b.timestamp - a.timestamp);
		} catch (err) {
			console.error('[HistoryService] Error reading history directory:', err);
			return [];
		}
	}

	static async deleteSession(id: string): Promise<void> {
		const filePath = path.join(this.historyPath, `${id}.json`);
		try {
			await fs.unlink(filePath);
			console.log(`[HistoryService] Deleted session: ${id}`);
		} catch (err: any) {
			if (err.code !== 'ENOENT') {
				console.error(`[HistoryService] Error deleting session ${id}:`, err);
			}
		}
	}

	static async clearHistory(projectId: string): Promise<void> {
		const sessions = await this.getSessions(projectId);
		for (const session of sessions) {
			await this.deleteSession(session.id);
		}
		console.log(`[HistoryService] Cleared history for project: ${projectId}`);
	}
}
