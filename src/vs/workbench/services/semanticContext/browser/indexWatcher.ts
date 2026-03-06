/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../base/common/lifecycle.js';
import { IFileService, FileChangesEvent } from '../../../../platform/files/common/files.js';
import { URI } from '../../../../base/common/uri.js';
import { ILogService } from '../../../../platform/log/common/log.js';
import { CancellationTokenSource } from '../../../../base/common/cancellation.js';
import { RunOnceScheduler } from '../../../../base/common/async.js';

export type IndexFileCallback = (uri: URI) => Promise<void>;

const IGNORE_DIRS = new Set(['node_modules', '.git', 'out', 'dist', '.build', 'coverage']);
const SUPPORTED_EXTS = new Set(['ts', 'js', 'py', 'java', 'go', 'cpp', 'c', 'cs', 'rs', 'tsx', 'jsx']);

/**
 * Watches for file changes and triggers incremental re-indexing.
 * Debounces rapid changes by 500ms per file.
 */
export class IndexWatcher extends Disposable {
	private readonly pendingFiles = new Map<string, URI>();
	private readonly scheduler: RunOnceScheduler;

	constructor(
		private readonly onIndexFile: IndexFileCallback,
		@IFileService fileService: IFileService,
		@ILogService private readonly logService: ILogService
	) {
		super();

		// Scheduler fires 500ms after the last queued change
		this.scheduler = this._register(new RunOnceScheduler(() => this.flushPending(), 500));

		this._register(fileService.onDidFilesChange((event: FileChangesEvent) => {
			this.onFilesChanged(event);
		}));
	}

	private onFilesChanged(event: FileChangesEvent): void {
		// FileChangesEvent exposes rawAdded and rawUpdated (deprecated but stable arrays)
		const candidates = [...event.rawAdded, ...event.rawUpdated];

		const relevant = candidates.filter(uri =>
			this.isSupportedFile(uri) && !this.isIgnoredPath(uri)
		);

		if (relevant.length === 0) return;

		for (const uri of relevant) {
			this.pendingFiles.set(uri.toString(), uri);
		}
		this.logService.trace(`IndexWatcher: ${this.pendingFiles.size} file(s) queued for re-index`);
		this.scheduler.schedule();
	}

	private async flushPending(): Promise<void> {
		const toIndex = [...this.pendingFiles.values()];
		this.pendingFiles.clear();

		for (const uri of toIndex) {
			const cts = new CancellationTokenSource();
			try {
				this.logService.trace(`IndexWatcher: re-indexing ${uri.toString()}`);
				await this.onIndexFile(uri);
			} catch (err) {
				this.logService.error(`IndexWatcher: failed to index ${uri.toString()}: ${err}`);
			} finally {
				cts.dispose();
			}
		}
	}

	private isSupportedFile(uri: URI): boolean {
		const ext = uri.path.split('.').pop()?.toLowerCase();
		return !!ext && SUPPORTED_EXTS.has(ext);
	}

	private isIgnoredPath(uri: URI): boolean {
		const parts = uri.path.split('/');
		return parts.some(p => IGNORE_DIRS.has(p));
	}
}
