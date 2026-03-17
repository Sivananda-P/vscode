/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { ISemanticContextService, SemanticIndexStatus } from '../common/semanticContext.js';
import { SemanticContextService } from './semanticContextService.js';
import { IEmbeddingProvider } from '../common/embeddings.js';
import { GroqEmbeddingProvider } from './embeddingProviders/groqEmbeddingProvider.js';
import { IVectorStoreService } from '../common/vectorStore.js';
import { VectorStoreServiceClient } from './vectorStoreService.js';
import { INativeEmbeddingService } from '../common/nativeEmbeddingService.js';
import { NativeEmbeddingServiceClient } from './nativeEmbeddingService.js';

import { ILogService } from '../../../../platform/log/common/log.js';
import { ICodeEditor, isCodeEditor } from '../../../../editor/browser/editorBrowser.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { IProgressService, ProgressLocation, IProgress, IProgressStep } from '../../../../platform/progress/common/progress.js';
import { IStatusbarService, StatusbarAlignment, IStatusbarEntryAccessor } from '../../../services/statusbar/browser/statusbar.js';
import { IEditorService } from '../../editor/common/editorService.js';
import { IOutputService, Extensions as OutputExt, IOutputChannelRegistry } from '../../output/common/output.js';
import { IQuickInputService } from '../../../../platform/quickinput/common/quickInput.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { IWorkspaceContextService } from '../../../../platform/workspace/common/workspace.js';
import { Extensions as WorkbenchExtensions, IWorkbenchContributionsRegistry } from '../../../common/contributions.js';
import { LifecyclePhase } from '../../lifecycle/common/lifecycle.js';
import { registerAction2, Action2 } from '../../../../platform/actions/common/actions.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { localize } from '../../../../nls.js';
import { CommandsRegistry } from '../../../../platform/commands/common/commands.js';
import { URI } from '../../../../base/common/uri.js';


// -- Register Services ----------------------------------------------------------
registerSingleton(IEmbeddingProvider, GroqEmbeddingProvider, InstantiationType.Delayed);
registerSingleton(IVectorStoreService, VectorStoreServiceClient, InstantiationType.Delayed);
registerSingleton(INativeEmbeddingService, NativeEmbeddingServiceClient, InstantiationType.Delayed);
registerSingleton(ISemanticContextService, SemanticContextService, InstantiationType.Delayed);


// -- Output Channel -------------------------------------------------------------
const SEMANTIC_OUTPUT_CHANNEL = 'Semantic Context Engine';
Registry.as<IOutputChannelRegistry>(OutputExt.OutputChannels).registerChannel({
	id: 'semanticContextEngine',
	label: SEMANTIC_OUTPUT_CHANNEL,
	log: false
});

// -- Status Bar Contribution -------------------------------------------------------
// -- Status Bar Contribution -------------------------------------------------------

class SemanticStatusBarContribution extends Disposable {
	private item: IStatusbarEntryAccessor | undefined;
	private lastProgress: { total: number; processed: number } | undefined;

	constructor(
		@ISemanticContextService private readonly semanticService: ISemanticContextService,
		@IStatusbarService private readonly statusbarService: IStatusbarService,
		@ILogService private readonly logService: ILogService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService
	) {
		super();
		this.createStatusBarItem();
		this._register(this.semanticService.onDidChangeStatus(s => this.updateItem(s)));
		this._register(this.semanticService.onDidIndexProgress(p => this.updateProgress(p)));
		this.updateItem(this.semanticService.status);

		// Auto-start indexing on startup after a larger delay to allow extension host and search providers to stabilize
		setTimeout(() => {
			if (!this.semanticService.isAvailable) {
				this.logService.info('Semantic Engine: Skipping auto-index, AI Backend not reachable.');
				return;
			}
			const hasWorkspace = this.workspaceContextService.getWorkspace().folders.length > 0;
			if (hasWorkspace && (this.semanticService.status === 'idle' || this.semanticService.status === 'unindexed')) {
				this.logService.info('Semantic Engine: Auto-indexing workspace on startup...');
				this.semanticService.indexWorkspace(CancellationToken.None).catch(err => {
					this.logService.error(`Semantic Engine: Auto-index failed: ${err}`);
				});
			} else if (!hasWorkspace) {
				this.logService.info('Semantic Engine: Skipping auto-index, no workspace opened.');
			}
		}, 10000);
	}

	private createStatusBarItem(): void {
		this.item = this.statusbarService.addEntry(
			{
				name: localize('semanticIndex', "Semantic Index"),
				text: '$(sync~spin) Semantic Index: Initializing',
				tooltip: localize('semanticIndexStatus', "Semantic Context Engine status"),
				ariaLabel: localize('semanticIndexStatus', "Semantic Context Engine status"),
				command: 'semantic.debugContext'
			},
			'semanticContextStatus',
			StatusbarAlignment.RIGHT,
			1000
		);
	}

	private updateItem(status: SemanticIndexStatus): void {
		if (!this.item) {
			return;
		}
		let text = '';
		let tooltip = '';

		switch (status) {
			case 'building': {
				const percent = this.lastProgress ? Math.round((this.lastProgress.processed / this.lastProgress.total) * 100) : 0;
				text = `$(sync~spin) Semantic Index: Building${percent > 0 ? ` ${percent}%` : ''}`;
				tooltip = localize('buildingStatus', "Building semantic index for the workspace...");
				break;
			}
			case 'ready':
				text = `$(check) Semantic Index: Ready`;
				tooltip = localize('readyStatus', "Semantic Index is ready for AI context queries");
				break;
			case 'updating':
				text = `$(sync~spin) Semantic Index: Updating`;
				tooltip = localize('updatingStatus', "Updating semantic index for changed files...");
				break;
			case 'error':
				text = `$(error) Semantic Index: Error`;
				tooltip = localize('errorStatus', "Semantic Index encountered an error. Check Output panel.");
				break;
			case 'idle':
				text = `$(circle-outline) Semantic Index: Idle`;
				tooltip = localize('idleStatus', "Semantic Index is idle. Click to run Debug Context.");
				break;
			case 'unindexed':
			default:
				text = `$(circle-outline) Semantic Index: Unindexed`;
				tooltip = localize('unindexedStatus', "Semantic Index has not been built yet. Run 'Semantic: Reindex Workspace'.");
				break;
		}

		this.item.update({
			name: localize('semanticIndex', "Semantic Index"),
			text,
			tooltip,
			ariaLabel: text,
			command: 'semantic.debugContext',
			backgroundColor: undefined
		});
	}

	private updateProgress(progress: { total: number; processed: number }): void {
		this.lastProgress = progress;
		if (this.semanticService.status === 'building') {
			this.updateItem('building');
		}
	}
}

// -- Register Workbench Contribution ------------------------------------------
Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench).registerWorkbenchContribution(SemanticStatusBarContribution, LifecyclePhase.Eventually);

// -- Actions -------------------------------------------------------------------

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'semantic.reindexWorkspace',
			title: { value: localize('reindex', "Semantic: Reindex Workspace"), original: 'Semantic: Reindex Workspace' },
			f1: true // Show in Command Palette
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const semanticService = accessor.get(ISemanticContextService);
		const progressService = accessor.get(IProgressService);
		const logService = accessor.get(ILogService);

		logService.info('Semantic Engine: Reindexing workspace...');

		await progressService.withProgress(
			{ location: ProgressLocation.Notification, title: localize('indexing', "Semantic Indexing"), cancellable: true },
			async (progress: IProgress<IProgressStep>) => {
				progress.report({ message: localize('indexingFiles', "Indexing workspace files...") });
				await semanticService.indexWorkspace(CancellationToken.None);
				progress.report({ message: localize('done', "Done!") });
			}
		);
		logService.info('Semantic Engine: Reindexing complete.');
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'semantic.debugContext',
			title: { value: localize('debugContext', "Semantic: Debug Context"), original: 'Semantic: Debug Context' },
			f1: true
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const semanticService = accessor.get(ISemanticContextService);
		const editorService = accessor.get(IEditorService);
		const outputService = accessor.get(IOutputService);
		const logService = accessor.get(ILogService);

		const editor = editorService.activeTextEditorControl;
		const channel = outputService.getChannel('semanticContextEngine');

		if (!isCodeEditor(editor)) {
			logService.warn('semantic.debugContext: no active text editor');
			if (channel) {
				channel.clear();
				channel.append('=== Semantic Context Debug ===\n');
				channel.append('Status: ' + semanticService.status + '\n\n');
				channel.append('!! No active text editor found.\n');
				channel.append('Please open a code file and click the button again to see the semantic context for that file.\n');
				outputService.showChannel('semanticContextEngine');
			}
			return;
		}

		const model = (editor as ICodeEditor).getModel();
		const position = (editor as ICodeEditor).getPosition();
		if (!model || !position || !model.uri) {
			return;
		}

		if (!channel) {
			return;
		}

		channel.clear();
		channel.append(`=== Semantic Context Debug ===\n`);
		channel.append(`File: ${model.uri.fsPath}\n`);
		channel.append(`Position: L${position.lineNumber}:${position.column}\n`);
		channel.append(`Status: ${semanticService.status}\n\n`);
		channel.append(`Computing full layered context (this may take a few seconds)...\n`);

		const ctx = await semanticService.getLayeredContext(
			model.uri,
			{ lineNumber: position.lineNumber, column: position.column },
			'Show context for current cursor position',
			CancellationToken.None
		);

		channel.append(`\n--- Cursor Context ---\n`);
		channel.append(`Symbol: ${ctx.cursorContext.currentSymbol?.name ?? '(none)'}\n`);
		channel.append(`Enclosing: ${ctx.cursorContext.enclosingSymbol?.name ?? '(none)'}\n`);
		channel.append(`Imports: ${ctx.cursorContext.importStatements.length} found\n\n`);

		channel.append(`--- Semantic Matches (${ctx.semanticMatches.length}) ---\n`);
		for (const m of ctx.semanticMatches) {
			channel.append(`  [${m.score.toFixed(3)}] ${m.symbolName ?? m.uri.fsPath} (${m.symbolType})\n`);
		}

		channel.append(`\n--- Dependency Context (${ctx.dependencyContext.length}) ---\n`);
		for (const d of ctx.dependencyContext) {
			channel.append(`  ${d.symbolName ?? d.uri.fsPath} (${d.symbolType})\n`);
		}

		channel.append(`\n--- Assembled Prompt (~${ctx.tokenEstimate} tokens) ---\n`);
		channel.append(ctx.assembledPrompt.slice(0, 2000) + (ctx.assembledPrompt.length > 2000 ? '\n...(truncated)' : ''));

		outputService.showChannel('semanticContextEngine');
		logService.info(`semantic.debugContext: wrote context to output panel`);
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'semantic.search',
			title: { value: localize('semanticSearch', 'Semantic: Search Codebase'), original: 'Semantic: Search Codebase' },
			f1: true
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const semanticService = accessor.get(ISemanticContextService);
		const quickInputService = accessor.get(IQuickInputService);
		const outputService = accessor.get(IOutputService);
		const logService = accessor.get(ILogService);

		// Prompt user for search query
		const query = await quickInputService.input({
			placeHolder: localize('searchPlaceholder', 'Search your codebase semantically…'),
			prompt: localize('searchPrompt', 'Enter a natural-language query (e.g. "authentication middleware", "parse JSON config")')
		});
		if (!query) {
			return;
		}

		const channel = outputService.getChannel('semanticContextEngine');
		if (!channel) {
			return;
		}

		channel.clear();
		channel.append(`=== Semantic Search ===\n`);
		channel.append(`Query: "${query}"\n`);
		channel.append(`Status: ${semanticService.status}\n\n`);
		channel.append(`Searching...\n`);
		outputService.showChannel('semanticContextEngine');

		try {
			const results = await semanticService.search(query, CancellationToken.None);

			if (results.length === 0) {
				channel.append(`\nNo results found. Try reindexing with "Semantic: Reindex Workspace".\n`);
			} else {
				channel.append(`\nFound ${results.length} result(s):\n`);
				channel.append(`${'-'.repeat(60)}\n`);
				for (let i = 0; i < results.length; i++) {
					const r = results[i];
					const label = r.symbolName ? `${r.symbolName} (${r.symbolType ?? 'chunk'})` : r.uri.fsPath;
					const filePath = r.uri.fsPath;
					const line = r.range.startLineNumber;
					channel.append(`\n[${i + 1}] score=${r.score.toFixed(4)}  ${label}\n`);
					channel.append(`    ${filePath}:${line}\n`);
					if (r.text) {
						const preview = r.text.trim().split('\n').slice(0, 4).join('\n    ');
						channel.append(`    ${preview}\n`);
					}
				}
				channel.append(`\n${'-'.repeat(60)}\n`);
			}
		} catch (err) {
			logService.error(`semantic.search failed: ${err}`);
			channel.append(`\nError: ${err}\n`);
			channel.append(`Make sure the workspace is indexed ("Semantic: Reindex Workspace").\n`);
		}

		outputService.showChannel('semanticContextEngine');
		logService.info(`semantic.search: query="${query}" done`);
	}
});

// -- cogni.getContext - Extension Bridge Command ------------------------------
//
// This command allows the cogni-autocomplete extension (and any future
// extension) to request layered semantic context from the IDE's internal
// SemanticContextService without needing direct service injection.
//
// Usage from an extension:
//   const ctx = await vscode.commands.executeCommand(
//     'cogni.getContext',
//     document.uri,
//     { lineNumber: position.line + 1, column: position.character + 1 }
//   );
//   // ctx.assembledPrompt  — full structured prompt string
//   // ctx.cursorContext    — surrounding code, symbol, imports
//   // ctx.semanticMatches  — top-K relevant chunks from vector DB
//
CommandsRegistry.registerCommand(
	'cogni.getContext',
	async (
		accessor: ServicesAccessor,
		uri: URI,
		position: { lineNumber: number; column: number }
	) => {
		const semanticService = accessor.get(ISemanticContextService);
		const logService = accessor.get(ILogService);

		if (!uri || !position) {
			logService.warn('[cogni.getContext] Called without uri or position');
			return null;
		}

		try {
			const ctx = await semanticService.getLayeredContext(
				uri,
				{ lineNumber: position.lineNumber, column: position.column },
				'inline completion context',
				CancellationToken.None
			);

			// Return a serializable subset of the layered context
			// (URI objects are converted to strings for cross-boundary safety)
			return {
				assembledPrompt: ctx.assembledPrompt,
				tokenEstimate: ctx.tokenEstimate,
				isFinal: ctx.isFinal,
				cursorContext: {
					surroundingLines: ctx.cursorContext.surroundingLines,
					importStatements: ctx.cursorContext.importStatements,
					currentSymbol: ctx.cursorContext.currentSymbol
						? {
							name: ctx.cursorContext.currentSymbol.name,
							kind: ctx.cursorContext.currentSymbol.kind,
							text: ctx.cursorContext.currentSymbol.text,
						}
						: undefined,
					enclosingSymbol: ctx.cursorContext.enclosingSymbol
						? {
							name: ctx.cursorContext.enclosingSymbol.name,
							kind: ctx.cursorContext.enclosingSymbol.kind,
						}
						: undefined,
				},
				semanticMatches: ctx.semanticMatches.slice(0, 5).map(m => ({
					text: m.text,
					score: m.score,
					symbolName: m.symbolName,
					symbolType: m.symbolType,
					uri: m.uri.toString(),
				})),
			};
		} catch (err) {
			logService.error(`[cogni.getContext] Failed: ${err}`);
			return null;
		}
	}
);
