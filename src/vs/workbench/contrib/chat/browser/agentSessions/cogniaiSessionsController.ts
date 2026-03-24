/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { Codicon } from '../../../../../base/common/codicons.js';
import { Emitter } from '../../../../../base/common/event.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../base/common/uri.js';
import { IWorkbenchContribution } from '../../../../common/contributions.js';
import { ChatSessionStatus, IChatSessionItem, IChatSessionItemController, IChatSessionsService } from '../../common/chatSessionsService.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { AgentSessionProviders } from './agentSessions.js';
import { IAIService } from '../../../../../platform/ai/common/ai.js';

export class CogniAISessionsController extends Disposable implements IChatSessionItemController, IWorkbenchContribution {

	static readonly ID = 'workbench.contrib.cogniaiSessionsController';

	readonly chatSessionType = AgentSessionProviders.CogniAI;

	private readonly _onDidChangeChatSessionItems = this._register(new Emitter<void>());
	readonly onDidChangeChatSessionItems = this._onDidChangeChatSessionItems.event;

	constructor(
		@IChatSessionsService private readonly chatSessionsService: IChatSessionsService,
		@ILogService private readonly logService: ILogService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@IAIService private readonly aiService: IAIService,
	) {
		super();

		this._register(this.chatSessionsService.registerChatSessionItemController(this.chatSessionType, this));
	}

	private _items: IChatSessionItem[] = [];
	get items(): readonly IChatSessionItem[] {
		return this._items;
	}

	async refresh(token: CancellationToken): Promise<void> {
		this._items = await this.provideChatSessionItems(token);
		this._onDidChangeChatSessionItems.fire();
	}

	private async provideChatSessionItems(token: CancellationToken): Promise<IChatSessionItem[]> {
		const workspace = this.workspaceContextService.getWorkspace();
		const projectId = workspace.id || 'default_project';
		const backendUrl = this.configurationService.getValue<string>('cogniai.backendUrl') || 'http://127.0.0.1:3000';
		try {
			const json = await this.aiService.request(`${backendUrl}/history/fetch/${projectId}`, undefined, token);

			if (!json || !json.sessions || !Array.isArray(json.sessions)) {
				return [];
			}

			return json.sessions.map((s: { id: string; label: string; timestamp: number }) => ({
				resource: URI.parse(s.id),
				label: s.label,
				status: ChatSessionStatus.Completed,
				iconPath: Codicon.history,
				timing: {
					created: s.timestamp,
					lastRequestStarted: s.timestamp
				}
			}));
		} catch (e) {
			this.logService.error('[CogniAI] Failed to fetch sessions from backend:', e);
			return [];
		}
	}
}
