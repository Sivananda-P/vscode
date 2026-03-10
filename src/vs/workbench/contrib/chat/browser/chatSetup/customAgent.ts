/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { MarkdownString } from '../../../../../base/common/htmlContent.js';
import { Disposable, DisposableStore, IDisposable } from '../../../../../base/common/lifecycle.js';
import { IChatAgentHistoryEntry, IChatAgentImplementation, IChatAgentRequest, IChatAgentResult, IChatAgentService } from '../../common/participants/chatAgents.js';
import { IChatProgress } from '../../common/chatService/chatService.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { ChatAgentLocation, ChatModeKind } from '../../common/constants.js';
import { nullExtensionDescription } from '../../../../services/extensions/common/extensions.js';
import { IRequestService, asText } from '../../../../../platform/request/common/request.js';

export class CustomAgent extends Disposable implements IChatAgentImplementation {

	static registerCustomAgents(instantiationService: IInstantiationService, location: ChatAgentLocation, mode: ChatModeKind): { agent: CustomAgent; disposable: IDisposable } {
		const disposables = new DisposableStore();
		const chatAgentService = instantiationService.invokeFunction(accessor => accessor.get(IChatAgentService));

		const id = `custom.agent.${location}.${mode}`;
		const name = 'Gemini AI';

		disposables.add(chatAgentService.registerAgent(id, {
			id,
			name,
			isDefault: true,
			isCore: true,
			modes: [mode],
			slashCommands: [],
			disambiguation: [],
			locations: [location],
			description: 'Powered by Google Gemini.',
			metadata: {
				themeIcon: { id: 'sparkle' }
			},
			extensionId: nullExtensionDescription.identifier,
			extensionVersion: undefined,
			extensionDisplayName: nullExtensionDescription.name,
			extensionPublisherId: nullExtensionDescription.publisher
		}));

		const agent = disposables.add(instantiationService.createInstance(CustomAgent));
		disposables.add(chatAgentService.registerAgentImplementation(id, agent));

		return { agent, disposable: disposables };
	}

	constructor(
		@IRequestService private readonly requestService: IRequestService,
	) {
		super();
	}

	async invoke(request: IChatAgentRequest, progress: (parts: IChatProgress[]) => void, _history: IChatAgentHistoryEntry[], token: CancellationToken): Promise<IChatAgentResult> {
		progress([{
			kind: 'progressMessage',
			content: new MarkdownString('Contacting AI Backend...'),
		}]);

		try {
			const backendUrl = 'http://localhost:3000/ai/query';
			const response = await this.requestService.request({
				url: backendUrl,
				type: 'POST',
				headers: {
					'Content-Type': 'application/json'
				},
				data: JSON.stringify({
					prompt: request.message,
					projectId: 'default_project' // In production, this would be the repo ID
				})
			}, token);

			const result = await asText(response);
			if (response.res.statusCode !== 200) {
				throw new Error(`Backend error (${response.res.statusCode}): ${result}`);
			}

			const json = JSON.parse(result!);
			const text = json.response || 'No response from backend AI.';

			progress([{
				kind: 'markdownContent',
				content: new MarkdownString(text)
			}]);

		} catch (e) {
			progress([{
				kind: 'markdownContent',
				content: new MarkdownString('Error connecting to backend: ' + (e instanceof Error ? e.message : String(e)))
			}]);
		}

		return {};
	}
}
