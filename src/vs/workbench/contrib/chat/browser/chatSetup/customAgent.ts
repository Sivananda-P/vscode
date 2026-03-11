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
import { IAIService } from '../../../../../platform/ai/common/ai.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { ISemanticContextService } from '../../../../services/semanticContext/common/semanticContext.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { VSBuffer } from '../../../../../base/common/buffer.js';

export class CustomAgent extends Disposable implements IChatAgentImplementation {

	static registerCustomAgents(instantiationService: IInstantiationService, location: ChatAgentLocation, mode: ChatModeKind): { agent: CustomAgent; disposable: IDisposable } {
		const disposables = new DisposableStore();
		const chatAgentService = instantiationService.invokeFunction(accessor => accessor.get(IChatAgentService));

		const id = `custom.agent.${location}.${mode}`;
		const name = 'Groq AI';

		disposables.add(chatAgentService.registerAgent(id, {
			id,
			name,
			isDefault: true,
			isCore: true,
			modes: [mode],
			slashCommands: [],
			disambiguation: [],
			locations: [location],
			description: 'Powered by Groq Llama 3.',
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
		@IAIService private readonly aiService: IAIService,
		@IFileService private readonly fileService: IFileService,
		@ISemanticContextService private readonly semanticContextService: ISemanticContextService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
	) {
		super();
	}

	async invoke(request: IChatAgentRequest, progress: (parts: IChatProgress[]) => void, _history: IChatAgentHistoryEntry[], token: CancellationToken): Promise<IChatAgentResult> {
		let messages: any[] = [];
		let turnCount = 0;
		const MAX_TURNS = 10;

		try {
			const backendUrl = 'http://127.0.0.1:3000/ai/query';
			let prompt = request.message;

			while (turnCount < MAX_TURNS && !token.isCancellationRequested) {
				turnCount++;

				const json = await this.aiService.request(backendUrl, {
					prompt: messages.length === 0 ? prompt : undefined,
					messages: messages,
					projectId: 'default_project'
				}, token);

				const { response, tool_calls } = json;

				if (response) {
					progress([{ kind: 'markdownContent', content: new MarkdownString(response) }]);
					messages.push({ role: 'assistant', content: response });
				}

				if (!tool_calls || tool_calls.length === 0) {
					break;
				}

				// Handle Tool Calls
				const assistantMessage = { role: 'assistant', tool_calls: tool_calls };
				messages.push(assistantMessage);

				for (const toolCall of tool_calls) {
					const { name, arguments: argsString } = toolCall.function;
					const args = JSON.parse(argsString);

					progress([{ kind: 'progressMessage', content: new MarkdownString(`Agent executing \`${name}\`...`) }]);

					let result;
					try {
						switch (name) {
							case 'read_file':
								result = await this.readFile(args.path);
								break;
							case 'write_file':
								result = await this.writeFile(args.path, args.content);
								break;
							case 'semantic_search':
								result = await this.semanticSearch(args.query, args.k);
								break;
							default:
								result = `Error: Unknown tool ${name}`;
						}
					} catch (err) {
						result = `Error executing tool: ${err}`;
					}

					messages.push({
						role: 'tool',
						tool_call_id: toolCall.id,
						name: name,
						content: typeof result === 'string' ? result : JSON.stringify(result)
					});
				}
			}

		} catch (e) {
			progress([{
				kind: 'markdownContent',
				content: new MarkdownString('Error connecting to backend: ' + (e instanceof Error ? e.message : String(e)))
			}]);
		}

		return {};
	}

	private async readFile(relativePath: string): Promise<string> {
		const workspaceRoot = this.workspaceContextService.getWorkspace().folders[0]?.uri;
		if (!workspaceRoot) return 'Error: No workspace root found.';

		const fileUri = workspaceRoot.with({ path: workspaceRoot.path + '/' + relativePath });
		const content = await this.fileService.readFile(fileUri);
		return content.value.toString();
	}

	private async writeFile(relativePath: string, content: string): Promise<string> {
		const workspaceRoot = this.workspaceContextService.getWorkspace().folders[0]?.uri;
		if (!workspaceRoot) return 'Error: No workspace root found.';

		const fileUri = workspaceRoot.with({ path: workspaceRoot.path + '/' + relativePath });
		await this.fileService.writeFile(fileUri, VSBuffer.fromString(content));
		return `Successfully updated ${relativePath}`;
	}

	private async semanticSearch(query: string, k: number = 5): Promise<any> {
		const searchUrl = 'http://127.0.0.1:3000/search';
		try {
			const json = await this.aiService.request(searchUrl, {
				query,
				projectId: 'default_project',
				k
			}, CancellationToken.None);
			return json.results || [];
		} catch (err) {
			// Fallback to IDE's in-memory store if backend is unavailable
			const results = await this.semanticContextService.search(query, CancellationToken.None);
			return results.slice(0, k).map(r => ({
				path: r.uri.fsPath,
				score: r.score,
				text: r.text.substring(0, 500) + '...'
			}));
		}
	}
}
