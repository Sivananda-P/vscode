/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { Emitter, Event } from '../../../../base/common/event.js';
import { VSBuffer } from '../../../../base/common/buffer.js';
import { ISemanticContextService, ISemanticSearchResult, ILayeredContext, IPosition, SemanticIndexStatus, IIndexProgress } from '../common/semanticContext.js';
import { IEmbeddingProvider } from '../common/embeddings.js';
import { IVectorStoreService, ISearchResult } from '../common/vectorStore.js';
import { SemanticIndexer } from '../common/semanticIndexer.js';

import { DependencyGraph } from '../common/dependencyGraph.js';
import { ContextRetriever } from '../common/contextRetriever.js';
import { ContextRanker } from '../common/contextRanker.js';
import { CursorContextExtractor } from '../common/cursorContext.js';
import { PromptAssembler } from '../common/promptAssembler.js';
import { IndexWatcher } from './indexWatcher.js';
import { IFileService } from '../../../../platform/files/common/files.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { IOutlineModelService } from '../../../../editor/contrib/documentSymbols/browser/outlineModel.js';
import { ITextModelService } from '../../../../editor/common/services/resolverService.js';
import { ILanguageFeaturesService } from '../../../../editor/common/services/languageFeatures.js';
import { ISearchService, QueryType } from '../../search/common/search.js';
import { IEditorService } from '../../editor/common/editorService.js';
import { IInstantiationService } from '../../../../platform/instantiation/common/instantiation.js';
import { URI } from '../../../../base/common/uri.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { IConfigurationService } from '../../../../platform/configuration/common/configuration.js';
import { DEFAULT_CODE_FILE_PATTERNS, buildExcludePatterns } from '../common/searchConfig.js';

export class SemanticContextService extends Disposable implements ISemanticContextService {
	declare readonly _serviceBrand: undefined;

	// ── Status ───────────────────────────────────────────────────────────────
	private readonly _onDidChangeStatus = this._register(new Emitter<SemanticIndexStatus>());
	readonly onDidChangeStatus: Event<SemanticIndexStatus> = this._onDidChangeStatus.event;

	private _status: SemanticIndexStatus = 'unindexed';
	get status(): SemanticIndexStatus { return this._status; }
	private setStatus(s: SemanticIndexStatus): void {
		if (this._status !== s) {
			this._status = s;
			this._onDidChangeStatus.fire(s);
		}
	}

	private readonly _onDidIndexProgress = this._register(new Emitter<IIndexProgress>());
	readonly onDidIndexProgress: Event<IIndexProgress> = this._onDidIndexProgress.event;

	// ── Core components ───────────────────────────────────────────────────────
	private readonly indexer: SemanticIndexer;
	private readonly dependencyGraph: DependencyGraph;

	private _retriever: ContextRetriever | undefined;
	private readonly ranker: ContextRanker;
	private readonly cursorExtractor: CursorContextExtractor;
	private readonly promptAssembler: PromptAssembler;

	// ── Telemetry ─────────────────────────────────────────────────────────────
	private filesIndexed = 0;
	private chunksCreated = 0;

	constructor(
		@IEmbeddingProvider private readonly embeddingProvider: IEmbeddingProvider,
		@IFileService private readonly fileService: IFileService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@ILogService private readonly logService: ILogService,
		@IOutlineModelService outlineModelService: IOutlineModelService,
		@ITextModelService private readonly textModelService: ITextModelService,
		@ILanguageFeaturesService languageFeaturesService: ILanguageFeaturesService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IVectorStoreService private readonly vectorStore: IVectorStoreService,
		@ISearchService private readonly searchService: ISearchService,
		@IEditorService private readonly editorService: IEditorService,
		@IConfigurationService private readonly configurationService: IConfigurationService
	) {

		super();

		this.indexer = instantiationService.createInstance(SemanticIndexer);
		this.dependencyGraph = instantiationService.createInstance(DependencyGraph);
		this.cursorExtractor = instantiationService.createInstance(CursorContextExtractor);
		this.ranker = new ContextRanker();
		this.promptAssembler = new PromptAssembler();

		// IndexWatcher is created later when vectorStore is ready
		// (We use a placeholder indexWatcher that will be initialized in ensureVectorStore)
		// IndexWatcher is created later when vectorStore is ready
		// (We use a placeholder indexWatcher that will be initialized in ensureVectorStore)
		this._register(
			instantiationService.createInstance(
				IndexWatcher,
				(uri: URI) => this.reindexFile(uri)
			)
		);

		// Lazy indexing: re-index active editor on change
		this._register(this.editorService.onDidActiveEditorChange(() => {
			const activeEditor = this.editorService.activeEditor;
			if (activeEditor?.resource) {
				this.reindexFile(activeEditor.resource).catch(() => { });
			}
		}));
	}

	// ── VectorStore lazy init ─────────────────────────────────────────────────

	private async ensureVectorStore(): Promise<IVectorStoreService> {
		if (!this._retriever) {
			await this.vectorStore.init();
			// Wire retriever now that store is available
			this._retriever = new ContextRetriever(
				this.vectorStore,
				this.dependencyGraph,
				this.logService
			);
		}
		return this.vectorStore;
	}


	private get retrieverInstance(): ContextRetriever {
		if (!this._retriever) {
			throw new Error('ContextRetriever not ready — call ensureVectorStore first');
		}
		return this._retriever;
	}

	// ── Workspace Indexing ────────────────────────────────────────────────────

	async indexWorkspace(token: CancellationToken): Promise<void> {
		this.setStatus('building');
		const folders = this.workspaceContextService.getWorkspace().folders;

		const t0 = Date.now();
		this.filesIndexed = 0;
		this.chunksCreated = 0;

		try {
			const store = await this.ensureVectorStore();
			const mtimesData = await store.getFileMtimes();
			const mtimesMap = new Map<string, number>(mtimesData);

			// Map folders to query format
			const folderQueries = folders.map(f => ({ folder: f.uri }));

			// Use searchService to find all supported files efficiently (respects .gitignore and excludes)
			const mergeExcludes = buildExcludePatterns(this.configurationService);
			const searchComplete = await this.searchService.fileSearch({
				type: QueryType.File,
				folderQueries,
				includePattern: DEFAULT_CODE_FILE_PATTERNS,
				excludePattern: mergeExcludes,
				maxResults: 100000
			}, token);

			this.logService.info(`SemanticContextService: discovered ${searchComplete.results.length} candidate files.`);

			// Process files in parallel with high concurrency for metadata checks
			const total = searchComplete.results.length;
			let processed = 0;
			const concurrencyLimit = 20;

			for (let i = 0; i < total; i += concurrencyLimit) {
				if (token.isCancellationRequested) {
					break;
				}
				const batch = searchComplete.results.slice(i, i + concurrencyLimit);
				await Promise.all(batch.map(file => this.reindexFile(file.resource, true, mtimesMap)));
				processed += batch.length;
				this._onDidIndexProgress.fire({ total, processed });
			}

			// Rebuild index once after all files are in the DB
			this.logService.info('SemanticContextService: final index rebuild...');
			await store.rebuildIndex();

			const elapsed = Date.now() - t0;
			this.logService.info(
				`SemanticContextService: indexed ${this.filesIndexed} files, ` +
				`${this.chunksCreated} chunks in ${elapsed}ms`
			);
			this.setStatus('ready');
		} catch (err) {
			this.logService.error(`SemanticContextService: indexWorkspace failed: ${err}`);
			this.setStatus('error');
			throw err;
		}
	}

	// ── Re-indexing ───────────────────────────────────────────────────────────

	/** Re-index a single file (called by IndexWatcher and on initial index). */
	async reindexFile(uri: URI, skipIndexUpdate = false, mtimesMap?: Map<string, number>): Promise<void> {
		if (!this.isSupportedFile(uri)) {
			return;
		}
		const store = await this.ensureVectorStore();

		// Fast-path: check mtime before doing ANY work
		try {
			const stat = await this.fileService.resolve(uri, { resolveMetadata: true });
			const indexedAt = mtimesMap ? mtimesMap.get(uri.toString()) : (await store.getFileMtimes()).find(m => m[0] === uri.toString())?.[1];

			if (indexedAt && stat.mtime <= indexedAt) {
				this.logService.trace(`SemanticContextService: skipping ${uri.fsPath} (unchanged)`);
				return;
			}
		} catch (err) {
			// If file doesn't exist or can't be resolved, just skip it
			return;
		}

		const wasPreviouslyReady = this._status === 'ready';
		if (wasPreviouslyReady) {
			this.setStatus('updating');
		}

		const t0 = Date.now();
		try {
			let chunksCount = 0;
			const ext = uri.fsPath.split('.').pop()?.toLowerCase();
			if (ext === 'ts' || ext === 'js' || ext === 'tsx' || ext === 'jsx') {
				// Professional Phase 8: Offload AST parsing and chunking to the backend
				const modelRef = await this.textModelService.createModelReference(uri);
				try {
					const text = modelRef.object.textEditorModel.getValue();
					// store.indexFile is expected to handle chunking, embedding, and storing
					// and return the number of chunks created.
					chunksCount = await store.indexFile(uri, text, ext, skipIndexUpdate);
				} finally {
					modelRef.dispose();
				}
			} else {
				// Fallback path: Use local symbols for other languages
				const chunks = await this.indexer.indexFile(uri, CancellationToken.None);
				if (chunks.length === 0) {
					// Even if no chunks, we should record the mtime to avoid re-scanning
					await store.addChunks([], [], skipIndexUpdate);
					if (wasPreviouslyReady) {
						this.setStatus('ready');
					}
					return;
				}

				const embeddings = await this.embeddingProvider.provideEmbeddings(
					chunks, CancellationToken.None
				);
				const binaryEmbeddings = embeddings.map(e => VSBuffer.wrap(new Uint8Array(e.buffer, e.byteOffset, e.byteLength)));

				await store.deleteChunks(uri, skipIndexUpdate);
				await store.addChunks(chunks, binaryEmbeddings, skipIndexUpdate);

				// Update dependency graph
				this.dependencyGraph.removeFile(uri);
				this.dependencyGraph.addChunks(chunks);
				await this.dependencyGraph.resolveImportsForFile(uri, CancellationToken.None);
				chunksCount = chunks.length;
			}

			this.filesIndexed++;
			this.chunksCreated += chunksCount;
			this.logService.trace(
				`SemanticContextService: reindexFile ${uri.fsPath} → ${chunksCount} chunks ` +
				`in ${Date.now() - t0}ms`
			);

			if (wasPreviouslyReady) {
				this.setStatus('ready');
			}
		} catch (err) {
			this.logService.error(`SemanticContextService: reindexFile failed for ${uri.toString()}: ${err}`);
			if (wasPreviouslyReady) {
				this.setStatus('ready');
			}
		}
	}

	// ── Search ────────────────────────────────────────────────────────────────

	async search(query: string, token: CancellationToken): Promise<ISearchResult[]> {
		const store = await this.ensureVectorStore();
		return store.searchByText(query, 10);
	}

	// ── Layered Context ───────────────────────────────────────────────────────

	async getLayeredContext(uri: URI, position: IPosition, prompt: string, token: CancellationToken, onProgress?: (result: ILayeredContext) => void): Promise<ILayeredContext> {
		await this.ensureVectorStore();

		const t0 = Date.now();

		// Extract cursor context
		const cursorContext = await this.cursorExtractor.extract(uri, position, token);

		// Build query from prompt + current symbol name
		const query = cursorContext.currentSymbol
			? `${prompt} ${cursorContext.currentSymbol.name}`
			: prompt;

		// Local ranking function to avoid code duplication
		const rankAndAssemble = async (semanticMatches: ISemanticSearchResult[], dependencyContext: ISemanticSearchResult[], relatedFiles: URI[], isFinal: boolean): Promise<ILayeredContext> => {
			const fileMtimes = await this.vectorStore!.getFileMtimes();
			const ranked = this.ranker.rankAll(semanticMatches, dependencyContext, fileMtimes);

			const assembled = this.promptAssembler.assemble(
				prompt,
				cursorContext,
				ranked,
				dependencyContext
			);

			return {
				cursorContext,
				semanticMatches: ranked,
				dependencyContext,
				relatedFiles,
				assembledPrompt: assembled.text,
				tokenEstimate: assembled.tokenEstimate,
				isFinal
			};
		};

		// Retrieve
		const fullRetrievalPromise = this.retrieverInstance.retrieve(
			query,
			cursorContext,
			token,
			10,
			async (partial) => {
				if (onProgress) {
					const partialCtx = await rankAndAssemble(partial.semanticMatches, partial.dependencyContext, partial.relatedFiles, false);
					onProgress(partialCtx);
				}
			}
		);

		const { semanticMatches, dependencyContext, relatedFiles } = await fullRetrievalPromise;

		const finalCtx = await rankAndAssemble(semanticMatches, dependencyContext, relatedFiles, true);

		this.logService.trace(
			`SemanticContextService: getLayeredContext in ${Date.now() - t0}ms, ` +
			`${finalCtx.semanticMatches.length} chunks, ~${finalCtx.tokenEstimate} tokens`
		);

		return finalCtx;
	}

	/** Legacy — returns assembled prompt string. */
	async getContext(uri: URI, position: IPosition, token: CancellationToken): Promise<string> {
		const ctx = await this.getLayeredContext(uri, position, `Context for ${uri.fsPath}`, token);
		return ctx.assembledPrompt;
	}

	// ── Telemetry / Debug  ────────────────────────────────────────────────────

	getMetrics() {
		return {
			filesIndexed: this.filesIndexed,
			chunksCreated: this.chunksCreated,
			graphNodes: this.dependencyGraph.nodeCount,
			graphEdges: this.dependencyGraph.edgeCount,
			embeddingDimension: this.embeddingProvider.embeddingDimension
		};
	}

	// ── Helpers ───────────────────────────────────────────────────────────────

	private isSupportedFile(uri: URI): boolean {
		const ext = uri.path.split('.').pop()?.toLowerCase();
		return !!ext && ['ts', 'js', 'py', 'java', 'go', 'cpp', 'c', 'cs', 'rs', 'tsx', 'jsx'].includes(ext);
	}

	override dispose(): void {
		void this.vectorStore?.close();
		super.dispose();
	}
}
