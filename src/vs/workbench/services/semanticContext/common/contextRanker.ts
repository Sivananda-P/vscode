/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ISemanticSearchResult } from './semanticContext.js';

export interface IRankingInput {
	result: ISemanticSearchResult;
	dependencyProximity: number;  // 0–1, from BFS depth
	fileLastModified?: number;    // epoch ms
	fileImportFanIn?: number;     // how many other files import this file
}

export interface IRankedResult extends ISemanticSearchResult {
	finalScore: number;
}

/**
 * Ranks retrieved context chunks using a weighted composite score:
 *
 *   score = 0.60 × semanticSimilarity
 *         + 0.25 × dependencyProximity
 *         + 0.10 × fileRecency
 *         + 0.05 × fileImportance
 *
 * Limits output to 6–12 chunks.
 */
export class ContextRanker {
	private readonly W_SEMANTIC = 0.60;
	private readonly W_DEPENDENCY = 0.25;
	private readonly W_RECENCY = 0.10;
	private readonly W_IMPORTANCE = 0.05;

	private readonly MIN_CHUNKS = 6;
	private readonly MAX_CHUNKS = 12;

	rank(inputs: IRankingInput[], nowMs = Date.now()): IRankedResult[] {
		if (inputs.length === 0) return [];

		// Normalize file recency (most recent = 1, oldest = 0)
		const mtimes = inputs.map(i => i.fileLastModified ?? 0);
		const minMtime = Math.min(...mtimes);
		const maxMtime = Math.max(...mtimes);
		const mtimeRange = maxMtime - minMtime || 1;

		// Normalize import fan-in (most imported = 1)
		const fanIns = inputs.map(i => i.fileImportFanIn ?? 0);
		const maxFanIn = Math.max(...fanIns) || 1;

		const scored: IRankedResult[] = inputs.map(inp => {
			const semantic = Math.max(0, Math.min(1, inp.result.score));
			const dependency = Math.max(0, Math.min(1, inp.dependencyProximity));
			const recency = ((inp.fileLastModified ?? minMtime) - minMtime) / mtimeRange;
			const importance = (inp.fileImportFanIn ?? 0) / maxFanIn;

			const finalScore =
				this.W_SEMANTIC * semantic +
				this.W_DEPENDENCY * dependency +
				this.W_RECENCY * recency +
				this.W_IMPORTANCE * importance;

			return {
				...inp.result,
				dependencyScore: dependency,
				recencyScore: recency,
				finalScore
			};
		});

		scored.sort((a, b) => b.finalScore - a.finalScore);

		const limit = Math.min(Math.max(this.MIN_CHUNKS, Math.ceil(scored.length * 0.5)), this.MAX_CHUNKS);
		return scored.slice(0, limit);
	}

	/**
	 * Combine semantic and dependency matches into a unified ranked list.
	 * Dependency results get a proximity score based on their presence (0.5 default).
	 */
	rankAll(
		semanticMatches: ISemanticSearchResult[],
		dependencyContext: ISemanticSearchResult[],
		fileMtimes: [string, number][] = [],
		fileFanIns: [string, number][] = []
	): IRankedResult[] {
		const mtimeMap = new Map(fileMtimes);
		const fanInMap = new Map(fileFanIns);
		const inputs: IRankingInput[] = [
			...semanticMatches.map(r => ({
				result: r,
				dependencyProximity: 0,
				fileLastModified: mtimeMap.get(r.uri.toString()),
				fileImportFanIn: fanInMap.get(r.uri.toString())
			})),
			...dependencyContext.map(r => ({
				result: { ...r, score: r.score || 0.3 }, // baseline score for dep results
				dependencyProximity: 0.8,
				fileLastModified: mtimeMap.get(r.uri.toString()),
				fileImportFanIn: fanInMap.get(r.uri.toString())
			}))
		];
		return this.rank(inputs);
	}
}
