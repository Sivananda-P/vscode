/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { registerSingleton, InstantiationType } from '../../../../platform/instantiation/common/extensions.js';
import { ISemanticContextService, SemanticIndexStatus } from '../common/semanticContext.js';
import { SemanticContextService } from './semanticContextService.js';
import { IEmbeddingProvider } from '../common/embeddings.js';
import { TransformersEmbeddingProvider } from './embeddingProviders/transformersEmbeddingProvider.js';
import { IVectorStoreService } from '../common/vectorStore.js';
import { VectorStoreServiceClient } from './vectorStoreService.js';
import { INativeEmbeddingService } from '../common/nativeEmbeddingService.js';
import { NativeEmbeddingServiceClient } from './nativeEmbeddingService.js';

import { ILogService } from '../../../../platform/log/common/log.js';
import { CancellationToken } from '../../../../base/common/cancellation.js';
import { IProgressService, ProgressLocation, IProgress, IProgressStep } from '../../../../platform/progress/common/progress.js';
import { IStatusbarService, StatusbarAlignment, IStatusbarEntryAccessor } from '../../../services/statusbar/browser/statusbar.js';
import { IEditorService } from '../../editor/common/editorService.js';
import { IOutputService } from '../../output/common/output.js';
import { Registry } from '../../../../platform/registry/common/platform.js';
import { Extensions as OutputExt, IOutputChannelRegistry } from '../../output/common/output.js';
import { Disposable } from '../../../../base/common/lifecycle.js';
import { Extensions as WorkbenchExtensions, IWorkbenchContributionsRegistry } from '../../../common/contributions.js';
import { LifecyclePhase } from '../../lifecycle/common/lifecycle.js';
import { registerAction2, Action2 } from '../../../../platform/actions/common/actions.js';
import { ServicesAccessor } from '../../../../platform/instantiation/common/instantiation.js';
import { localize } from '../../../../nls.js';

// ── Register Services ──────────────────────────────────────────────────────────
registerSingleton(IEmbeddingProvider, TransformersEmbeddingProvider, InstantiationType.Delayed);
registerSingleton(IVectorStoreService, VectorStoreServiceClient, InstantiationType.Delayed);
registerSingleton(INativeEmbeddingService, NativeEmbeddingServiceClient, InstantiationType.Delayed);
registerSingleton(ISemanticContextService, SemanticContextService, InstantiationType.Delayed);


// ── Output Channel ─────────────────────────────────────────────────────────────
const SEMANTIC_OUTPUT_CHANNEL = 'Semantic Context Engine';
Registry.as<IOutputChannelRegistry>(OutputExt.OutputChannels).registerChannel({
	id: 'semanticContextEngine',
	label: SEMANTIC_OUTPUT_CHANNEL,
	log: false
});

// ── Status Bar Contribution ───────────────────────────────────────────────────────

class SemanticStatusBarContribution extends Disposable {
	private statusBarEntry: IStatusbarEntryAccessor | undefined;

	constructor(
		@ISemanticContextService private readonly semanticService: ISemanticContextService,
		@IStatusbarService private readonly statusbarService: IStatusbarService
	) {
		super();
		this.createStatusBarItem();
		this._register(this.semanticService.onDidChangeStatus(s => this.updateItem(s)));
	}

	private createStatusBarItem(): void {
		this.statusBarEntry = this.statusbarService.addEntry(
			{
				name: 'Semantic Index',
				text: '$(sync~spin) Semantic Index: Initializing',
				tooltip: 'Semantic Context Engine status',
				ariaLabel: 'Semantic Index status',
				command: 'semantic.debugContext'
			},
			'semanticContextStatus',
			StatusbarAlignment.RIGHT,
			1000
		);
		this.updateItem('idle');
	}

	private updateItem(status: SemanticIndexStatus): void {
		if (!this.statusBarEntry) return;
		let text: string;
		let tooltip: string;

		switch (status) {
			case 'building':
				text = '$(sync~spin) Semantic Index: Building';
				tooltip = 'Semantic Index is performing initial workspace indexing...';
				break;
			case 'ready':
				text = '$(check) Semantic Index: Ready';
				tooltip = 'Semantic Index is ready for AI context queries';
				break;
			case 'updating':
				text = '$(lightbulb~spin) Semantic Index: Updating';
				tooltip = 'Semantic Index is re-indexing changed files...';
				break;
			case 'error':
				text = '$(error) Semantic Index: Error';
				tooltip = 'Semantic Index encountered an error. Check Output panel.';
				break;
			default:
				text = '$(circle-outline) Semantic Index: Idle';
				tooltip = 'Semantic Index is idle';
		}

		this.statusBarEntry.update({
			name: 'Semantic Index',
			text,
			tooltip,
			ariaLabel: text,
			command: 'semantic.debugContext'
		});
	}
}

// ── Register Workbench Contribution ──────────────────────────────────────────
Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench).registerWorkbenchContribution(SemanticStatusBarContribution, LifecyclePhase.Eventually);

// ── Actions ───────────────────────────────────────────────────────────────────

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
			{ location: ProgressLocation.Notification, title: 'Semantic Indexing', cancellable: true },
			async (progress: IProgress<IProgressStep>) => {
				progress.report({ message: 'Indexing workspace files...' });
				await semanticService.indexWorkspace(CancellationToken.None);
				progress.report({ message: 'Done!' });
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
		if (!editor || !('getModel' in editor)) {
			logService.warn('semantic.debugContext: no active text editor');
			return;
		}

		// eslint-disable-next-line local/code-no-any-casts
		const model = (editor as any).getModel();
		// eslint-disable-next-line local/code-no-any-casts
		const position = (editor as any).getPosition();
		if (!model || !position) return;

		const ctx = await semanticService.getLayeredContext(
			model.uri,
			{ lineNumber: position.lineNumber, column: position.column },
			'Show context for current cursor position',
			CancellationToken.None
		);

		const channel = outputService.getChannel('semanticContextEngine');
		if (!channel) return;

		channel.clear();
		channel.append(`=== Semantic Context Debug ===\n`);
		channel.append(`File: ${model.uri.fsPath}\n`);
		channel.append(`Position: L${position.lineNumber}:${position.column}\n`);
		channel.append(`Status: ${semanticService.status}\n\n`);

		channel.append(`--- Cursor Context ---\n`);
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
