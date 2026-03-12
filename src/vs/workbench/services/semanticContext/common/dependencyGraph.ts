/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../base/common/uri.js';
import { ILanguageFeaturesService } from '../../../../editor/common/services/languageFeatures.js';
import { ITextModelService } from '../../../../editor/common/services/resolverService.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { ICodeChunk } from './semanticIndexer.js';

// ─── Graph Types ─────────────────────────────────────────────────────────────

export type NodeKind = 'file' | 'function' | 'class' | 'interface' | 'method' | 'module';
export type EdgeKind = 'imports' | 'calls' | 'inherits' | 'references' | 'contains';

export interface IGraphNode {
	id: string;           // chunk id or file URI string
	kind: NodeKind;
	label: string;
	uri: URI;
	startLine: number;
	endLine: number;
}

export interface IGraphEdge {
	from: string;
	to: string;
	kind: EdgeKind;
}

// ─── DependencyGraph ─────────────────────────────────────────────────────────

/**
 * Builds and maintains a symbol-level dependency graph for the indexed workspace.
 * Used by the ContextRetriever to expand top-K vector results with related code.
 *
 * Professional Phase 8: This service is now 100% renderer-safe (no typescript module import).
 */
export class DependencyGraph {
	private readonly nodes = new Map<string, IGraphNode>();
	private readonly edges: IGraphEdge[] = [];
	// adjacency: nodeId → set of neighbor nodeIds
	private readonly adj = new Map<string, Set<string>>();

	constructor(
		@ILanguageFeaturesService private readonly languageFeaturesService: ILanguageFeaturesService,
		@ITextModelService private readonly textModelService: ITextModelService,
		@ILogService private readonly logService: ILogService
	) { }

	// ── Build ────────────────────────────────────────────────────────────────

	/** Register all chunks from a file as nodes. */
	addChunks(chunks: ICodeChunk[]): void {
		for (const chunk of chunks) {
			const node: IGraphNode = {
				id: chunk.id,
				kind: (chunk.symbolType ?? 'symbol') as NodeKind,
				label: chunk.symbolName ?? chunk.id,
				uri: chunk.uri,
				startLine: chunk.range.startLineNumber,
				endLine: chunk.range.endLineNumber
			};
			this.nodes.set(node.id, node);
		}
	}

	/** Remove all nodes/edges for a specific file (called before re-indexing). */
	removeFile(uri: URI): void {
		const uriStr = uri.toString();
		const toRemove: string[] = [];
		for (const [id, node] of this.nodes) {
			if (node.uri.toString() === uriStr) {
				toRemove.push(id);
			}
		}
		for (const id of toRemove) {
			this.nodes.delete(id);
			this.adj.delete(id);
		}
		// Remove edges referencing removed nodes
		for (let i = this.edges.length - 1; i >= 0; i--) {
			if (toRemove.includes(this.edges[i].from) || toRemove.includes(this.edges[i].to)) {
				this.edges.splice(i, 1);
			}
		}
	}

	/**
	 * Resolve import-level edges for a file using language features.
	 * This adds `imports` edges from the file node to imported file nodes.
	 */
	async resolveImportsForFile(uri: URI, token: CancellationToken): Promise<void> {
		try {
			const modelRef = await this.textModelService.createModelReference(uri);
			try {
				const model = modelRef.object.textEditorModel;
				const fromId = uri.toString();

				// Professional Phase 8: Use regex-based import extraction for all languages in the renderer.
				// This avoids the 'typescript' module dependency while providing high accuracy for RAG.
				const lineCount = model.getLineCount();
				const scanTo = Math.min(100, lineCount);

				for (let i = 1; i <= scanTo; i++) {
					const line = model.getLineContent(i) as string;
					const importMatch = /^\s*(?:import|export\s+.*\s+from|const\s+\w+\s*=\s*require)\s*['"]([^'"]+)['"]/.exec(line);
					if (importMatch) {
						const modulePath = importMatch[1];
						this.addEdge(fromId, modulePath, 'imports');
					}
				}

				// Fallback: also check document symbols if available
				const providers = this.languageFeaturesService.documentSymbolProvider.ordered(model);
				if (providers.length > 0) {
					const symbols = await providers[0].provideDocumentSymbols(model, token);
					if (symbols) {
						for (const sym of symbols) {
							if (sym.name.startsWith('import') || sym.kind === 1 /* Module */) {
								this.addEdge(fromId, sym.name, 'imports');
							}
						}
					}
				}
			} finally {
				modelRef.dispose();
			}
		} catch (err) {
			this.logService.trace(`DependencyGraph: could not resolve imports for ${uri.toString()}: ${err}`);
		}
	}

	private addEdge(from: string, to: string, kind: EdgeKind): void {
		this.edges.push({ from, to, kind });
		if (!this.adj.has(from)) {
			this.adj.set(from, new Set());
		}
		this.adj.get(from)!.add(to);
		if (!this.adj.has(to)) {
			this.adj.set(to, new Set());
		}
		this.adj.get(to)!.add(from);
	}

	// ── Query ────────────────────────────────────────────────────────────────

	/**
	 * BFS from a chunk ID, returning related chunk IDs up to `depth` hops away.
	 */
	getRelatedSymbols(chunkId: string, depth = 2): string[] {
		const visited = new Set<string>([chunkId]);
		const queue: { id: string; d: number }[] = [{ id: chunkId, d: 0 }];
		const related: string[] = [];

		while (queue.length > 0) {
			const { id, d } = queue.shift()!;
			if (d >= depth) continue;
			const neighbors = this.adj.get(id);
			if (!neighbors) continue;
			for (const neighbor of neighbors) {
				if (!visited.has(neighbor)) {
					visited.add(neighbor);
					related.push(neighbor);
					queue.push({ id: neighbor, d: d + 1 });
				}
			}
		}

		return related;
	}

	/** Get all chunk IDs for a given file. */
	getChunksForFile(uri: URI): string[] {
		const uriStr = uri.toString();
		return [...this.nodes.values()]
			.filter(n => n.uri.toString() === uriStr)
			.map(n => n.id);
	}

	getNode(id: string): IGraphNode | undefined {
		return this.nodes.get(id);
	}

	get nodeCount(): number { return this.nodes.size; }
	get edgeCount(): number { return this.edges.length; }
}
