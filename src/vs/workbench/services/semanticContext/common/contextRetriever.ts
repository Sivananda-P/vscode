/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { IEmbeddingProvider } from './embeddings.js';
import { IVectorStoreService } from './vectorStore.js';
import { DependencyGraph } from './dependencyGraph.js';
import { ICursorContext, ILayeredContext, ISemanticSearchResult } from './semanticContext.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { VSBuffer } from '../../../../base/common/buffer.js';

/**
 * ContextRetriever orchestrates the multi-stage retrieval pipeline:
 *
 * 1. Embed user query
 * 2. Top-K vector search
 * 3. Expand via dependency graph (BFS)
 * 4. Include cursor-local context
 * 5. Deduplicate overlapping chunks
 */
export class ContextRetriever {
	constructor(
		private readonly embeddingProvider: IEmbeddingProvider,
		private readonly vectorStore: IVectorStoreService,
		private readonly dependencyGraph: DependencyGraph,
		private readonly logService: ILogService
	) { }

	async retrieve(
		query: string,
		cursorContext: ICursorContext,
		token: CancellationToken,
		topK = 10,
		onProgress?: (partial: Pick<ILayeredContext, 'semanticMatches' | 'dependencyContext' | 'relatedFiles'>) => void
	): Promise<Pick<ILayeredContext, 'semanticMatches' | 'dependencyContext' | 'relatedFiles'>> {
		// Step 1: Embed the query
		const [queryEmbedding] = await this.embeddingProvider.provideEmbeddings([query], token);
		if (token.isCancellationRequested) {
			return { semanticMatches: [], dependencyContext: [], relatedFiles: [] };
		}

		// Step 2: Top-K vector search
		const queryBuffer = VSBuffer.wrap(new Uint8Array(queryEmbedding.buffer, queryEmbedding.byteOffset, queryEmbedding.byteLength));
		const rawResults = await this.vectorStore.search(queryBuffer, topK);
		const semanticMatches: ISemanticSearchResult[] = rawResults.map(r => ({
			uri: r.uri,
			range: r.range,
			text: r.text,
			score: r.score,
			symbolName: r.symbolName,
			symbolType: r.symbolType
		}));

		this.logService.trace(`ContextRetriever: ${semanticMatches.length} semantic matches`);

		// Step 2.5: EMIT PARTIAL RESULTS
		if (onProgress) {
			onProgress({
				semanticMatches,
				dependencyContext: [],
				relatedFiles: [...new Map(semanticMatches.map(r => [r.uri.toString(), r.uri])).values()].filter(u => u.toString() !== cursorContext.uri.toString())
			});
		}

		// Step 3: Expand via dependency graph
		const dependencyChunkIds = new Set<string>();
		for (const match of semanticMatches) {
			if (token.isCancellationRequested) break;
			const chunkId = match.symbolName
				? `${match.uri.toString()}::${match.range.startLineNumber}:${match.range.endLineNumber}`
				: '';
			if (!chunkId) continue;
			const related = this.dependencyGraph.getRelatedSymbols(chunkId, 2);
			for (const id of related) dependencyChunkIds.add(id);
		}

		// Resolve dependency chunk IDs into search results
		const dependencyContext: ISemanticSearchResult[] = [];
		for (const chunkId of dependencyChunkIds) {
			const node = this.dependencyGraph.getNode(chunkId);
			if (!node) continue;
			// Avoid duplicating top-K results
			const alreadyPresent = semanticMatches.some(m =>
				m.uri.toString() === node.uri.toString() &&
				m.range.startLineNumber === node.startLine
			);
			if (!alreadyPresent) {
				dependencyContext.push({
					uri: node.uri,
					range: { startLineNumber: node.startLine, startColumn: 1, endLineNumber: node.endLine, endColumn: 1 },
					text: '',
					score: 0,
					symbolName: node.label,
					symbolType: node.kind
				});
			}
		}

		// Step 4: Related files (union of all result URIs)
		const fileSet = new Map<string, URI>();
		for (const r of [...semanticMatches, ...dependencyContext]) {
			fileSet.set(r.uri.toString(), r.uri);
		}
		// Also add cursor file's neighbours
		const cursorChunks = this.dependencyGraph.getChunksForFile(cursorContext.uri);
		for (const chunkId of cursorChunks.flatMap(id => this.dependencyGraph.getRelatedSymbols(id, 1))) {
			const node = this.dependencyGraph.getNode(chunkId);
			if (node) fileSet.set(node.uri.toString(), node.uri);
		}

		const relatedFiles = [...fileSet.values()].filter(u => u.toString() !== cursorContext.uri.toString());

		// Step 5: Deduplicate — remove chunks whose ranges fully overlap with another
		const dedupedSemantic = this.deduplicateByRange(semanticMatches);
		const dedupedDependency = this.deduplicateByRange(dependencyContext);

		return {
			semanticMatches: dedupedSemantic,
			dependencyContext: dedupedDependency,
			relatedFiles
		};
	}

	/** Remove chunks that are fully contained within another chunk. */
	private deduplicateByRange(results: ISemanticSearchResult[]): ISemanticSearchResult[] {
		const out: ISemanticSearchResult[] = [];
		for (const r of results) {
			const dominated = out.some(o =>
				o.uri.toString() === r.uri.toString() &&
				o.range.startLineNumber <= r.range.startLineNumber &&
				o.range.endLineNumber >= r.range.endLineNumber
			);
			if (!dominated) out.push(r);
		}
		return out;
	}
}
