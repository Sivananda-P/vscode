/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { MarkdownString } from '../../../../../base/common/htmlContent.js';
import {
	Disposable,
	DisposableStore,
	IDisposable,
} from '../../../../../base/common/lifecycle.js';
import {
	IChatAgentCommand,
	IChatAgentHistoryEntry,
	IChatAgentImplementation,
	IChatAgentRequest,
	IChatAgentResult,
	IChatAgentService,
} from '../../common/participants/chatAgents.js';
import {
	IChatProgress,
	IChatTaskDto,
	IChatTask,
} from '../../common/chatService/chatService.js';
import { IChatProgressHistoryResponseContent } from '../../common/model/chatModel.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { ChatAgentLocation, ChatModeKind } from '../../common/constants.js';
import { nullExtensionDescription } from '../../../../services/extensions/common/extensions.js';
import { IAIService } from '../../../../../platform/ai/common/ai.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { ISemanticContextService } from '../../../../services/semanticContext/common/semanticContext.js';
import { ISearchResult } from '../../../../services/semanticContext/common/vectorStore.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { VSBuffer } from '../../../../../base/common/buffer.js';
import {
	IMarkerService,
	MarkerSeverity,
} from '../../../../../platform/markers/common/markers.js';
import { URI } from '../../../../../base/common/uri.js';
import { relativePath } from '../../../../../base/common/resources.js';
import { ILanguageFeaturesService } from '../../../../../editor/common/services/languageFeatures.js';
import { IModelService } from '../../../../../editor/common/services/model.js';
import { getDefinitionsAtPosition } from '../../../../../editor/contrib/gotoSymbol/browser/goToSymbol.js';
import { Position } from '../../../../../editor/common/core/position.js';
import { Range } from '../../../../../editor/common/core/range.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { localize } from '../../../../../nls.js';

interface IToolCall {
	id: string;
	type: string;
	function: { name: string; arguments: string };
}

interface IChatMessage {
	role: 'system' | 'user' | 'assistant' | 'tool';
	content?: string;
	tool_calls?: IToolCall[];
	tool_call_id?: string;
	name?: string;
}

interface SkillInfo {
	name: string;
	description: string;
}

/** Join a workspace root URI with a relative path safely */
function joinWorkspacePath(
	root: typeof import('../../../../../base/common/uri.js').URI.prototype,
	relative: string,
) {
	if (relative === '.' || relative === '' || relative === '/') {
		return root;
	}
	// Remove leading slash/dot-slash
	const clean = relative.replace(/^\.?\//, '');
	return root.with({ path: root.path + '/' + clean });
}

export class CustomAgent
	extends Disposable
	implements IChatAgentImplementation {
	static registerCustomAgents(
		instantiationService: IInstantiationService,
		location: ChatAgentLocation,
		mode: ChatModeKind,
	): { agent: CustomAgent; disposable: IDisposable } {
		const disposables = new DisposableStore();
		const chatAgentService = instantiationService.invokeFunction((accessor) =>
			accessor.get(IChatAgentService),
		);

		const id = `custom.agent.${location}.${mode}`;
		const name = localize('chat.customAgent.name', "CogniAI");

		const dynamicSlashCommands: IChatAgentCommand[] = [
			{
				name: 'explain',
				description: localize('chat.customAgent.explain', "Explain how the current code works."),
			},
			{
				name: 'fix',
				description: localize('chat.customAgent.fix', "Propose a fix for the problems in the current file."),
			},
			{ name: 'clear', description: localize('chat.customAgent.clear', "Clear the chat history.") },
			{ name: '3danim', description: localize('chat.customAgent.run3dAnim', "3D Animation Assistant") },
			{ name: 'design', description: localize('chat.customAgent.runFrontendDesign', "Frontend Design Assistant") },
			{ name: 'brainstorming', description: localize('chat.customAgent.runBrainstorming', "Brainstorming Assistant") },
			{ name: 'debugging', description: localize('chat.customAgent.runDebugging', "Systematic Debugging Assistant") },
			{ name: 'gitpush', description: localize('chat.customAgent.runGitPush', "Git Pushing Assistant") },
			{ name: 'tdd', description: localize('chat.customAgent.runTDD', "Test-Driven Development Assistant") },
			{ name: 'react', description: localize('chat.customAgent.runReact', "React Best Practices Assistant") },
			{ name: 'fullstack', description: localize('chat.customAgent.runFullstack', "Senior Fullstack Engineer") },
			{ name: 'review', description: localize('chat.customAgent.runReview', "Professional Code Reviewer") },
			{ name: 'testing', description: localize('chat.customAgent.runTesting', "WebApp Testing Assistant") },
			{ name: 'available-skills', description: localize('chat.customAgent.listSkills', "List all available specialized skills.") },
		];

		disposables.add(
			chatAgentService.registerAgent(id, {
				id,
				name,
				isDefault: true,
				isCore: true,
				modes: [mode],
				slashCommands: dynamicSlashCommands,
				disambiguation: [],
				locations: [location],
				description: localize('chat.customAgent.poweredBy', "Powered by CogniAI Professional."),
				metadata: {
					themeIcon: { id: 'sparkle' },
				},
				extensionId: nullExtensionDescription.identifier,
				extensionVersion: undefined,
				extensionDisplayName:
					nullExtensionDescription.displayName || nullExtensionDescription.name,
				extensionPublisherId: nullExtensionDescription.publisher,
			}),
		);

		const agent = disposables.add(
			instantiationService.createInstance(CustomAgent, dynamicSlashCommands),
		);
		disposables.add(chatAgentService.registerAgentImplementation(id, agent));

		return { agent, disposable: disposables };
	}

	constructor(
		private readonly dynamicSlashCommands: IChatAgentCommand[],
		@IAIService private readonly aiService: IAIService,
		@IFileService private readonly fileService: IFileService,
		@ISemanticContextService
		private readonly semanticContextService: ISemanticContextService,
		@IWorkspaceContextService
		private readonly workspaceContextService: IWorkspaceContextService,
		@IMarkerService private readonly markerService: IMarkerService,
		@ILanguageFeaturesService
		private readonly languageFeaturesService: ILanguageFeaturesService,
		@IModelService private readonly modelService: IModelService,
		@IEditorService private readonly editorService: IEditorService,
		@IConfigurationService private readonly configurationService: IConfigurationService
	) {
		super();
		this.fetchAndRegisterSkills();
	}

	private get backendUrl(): string {
		const url = this.configurationService.getValue<string>('cogniai.backendUrl') || 'http://localhost:3000';
		return url.endsWith('/') ? url.slice(0, -1) : url;
	}

	private async fetchAndRegisterSkills() {
		try {
			const json = await this.aiService.request(`${this.backendUrl}/ai/skills`, {}, CancellationToken.None) as { skills: SkillInfo[] };
			const skills = json.skills || [];
			const existingNames = new Set(this.dynamicSlashCommands.map(c => c.name));

			for (const skill of skills) {
				const commandName = skill.name.toLowerCase();
				if (!existingNames.has(commandName)) {
					this.dynamicSlashCommands.push({
						name: commandName,
						description: skill.description || localize('chat.customAgent.skillDesc', "Specialized skill: {0}", skill.name)
					});
					existingNames.add(commandName);
				}
			}
		} catch (e) {
			console.error('Failed to load skills for autocomplete', e);
		}
	}

	async invoke(
		request: IChatAgentRequest,
		progress: (parts: IChatProgress[]) => void,
		history: IChatAgentHistoryEntry[],
		token: CancellationToken,
	): Promise<IChatAgentResult> {
		let messages: IChatMessage[] = [];
		let turnCount = 0;
		const MAX_TURNS = 10;

		try {
			// Map history to messages (reconstruction based on progress parts)
			for (const entry of history) {
				// 1. Add User Request
				messages.push({ role: 'user', content: entry.request.message });

				// Response can be multiple parts
				const assistantContent = entry.response
					.map((p: IChatProgressHistoryResponseContent | IChatTaskDto) => {
						if (p.kind === 'markdownContent') {
							const md = p as IChatProgressHistoryResponseContent & {
								content: { value: string };
							};
							return md.content.value;
						}
						if (p.kind === 'progressTask') {
							return (p as IChatTask).content?.value || '';
						}
						return '';
					})
					.filter(Boolean)
					.join('\n');

				if (assistantContent) {
					messages.push({ role: 'assistant', content: assistantContent });
				}
			}

			const backendUrl = `${this.backendUrl}/ai/query`;
			let prompt = request.message.trim();

			while (turnCount < MAX_TURNS && !token.isCancellationRequested) {
				turnCount++;

				// 1. Detect core slash commands (must be at the start of the message)

				if (prompt.startsWith('/explain')) {
					prompt = `Explain this code in detail: ${prompt.replace('/explain', '').trim()}`;
				} else if (prompt.startsWith('/fix')) {
					prompt = `Look for bugs or improvements in this code and fix them: ${prompt.replace('/fix', '').trim()}`;
				} else if (prompt.startsWith('/clear')) {
					messages = [];
					progress([
						{
							kind: 'markdownContent',
							content: new MarkdownString(localize('chat.customAgent.historyCleared', "Chat history cleared.")),
						},
					]);
					return {};
				} else if (prompt.startsWith('/available-skills')) {
					try {
						const json = await this.aiService.request(`${this.backendUrl}/ai/skills`, {}, token) as { skills: SkillInfo[] };
						const skills = json.skills || [];
						let skillList = localize('chat.customAgent.availableSkills', "### Available Specialized Skills\n\n");

						// Featured ones first
						const featured = ['brainstorming', 'systematic-debugging', 'git-pushing', 'test-driven-development', 'react-best-practices', 'senior-fullstack', 'code-reviewer', 'webapp-testing'];

						skillList += localize('chat.customAgent.featuredHeader', "**Featured Skills:**\n");
						featured.forEach(f => {
							const s = skills.find((sk: SkillInfo) => sk.name.toLowerCase() === f);
							if (s) {
								skillList += `- **/${f}**: ${s.description}\n`;
							}
						});

						skillList += localize('chat.customAgent.moreSkillsHeader', "\n**More Skills (Partial List):**\n");
						const otherSkills = skills.filter((sk: SkillInfo) => !featured.includes(sk.name.toLowerCase())).slice(0, 15);
						otherSkills.forEach((s: SkillInfo) => {
							skillList += `- **/${s.name.toLowerCase()}**: ${s.description}\n`;
						});

						if (skills.length > (featured.length + otherSkills.length)) {
							skillList += localize('chat.customAgent.totalSkillsHint', "\n... and {0} more! Try typing `/` followed by any skill name.", skills.length - featured.length - otherSkills.length);
						}

						progress([{ kind: 'markdownContent', content: new MarkdownString(skillList) }]);
						return {};
					} catch (e) {
						progress([{ kind: 'markdownContent', content: new MarkdownString(localize('chat.customAgent.skillsLoadError', "Error loading skills: {0}", String(e))) }]);
						return {};
					}
				}

				let activeSkill: string | undefined;

				// 1. Check for legacy/featured hardcoded aliases
				if (prompt.includes('/3danim')) {
					activeSkill = '3d_animation_designer';
					prompt = prompt.replace('/3danim', '').trim();
				} else if (prompt.includes('/design')) {
					activeSkill = 'frontend_design';
					prompt = prompt.replace('/design', '').trim();
				} else if (prompt.includes('/debugging')) {
					activeSkill = 'systematic-debugging';
					prompt = prompt.replace('/debugging', '').trim();
				} else if (prompt.includes('/gitpush')) {
					activeSkill = 'git-pushing';
					prompt = prompt.replace('/gitpush', '').trim();
				} else if (prompt.includes('/tdd')) {
					activeSkill = 'test-driven-development';
					prompt = prompt.replace('/tdd', '').trim();
				} else if (prompt.includes('/react')) {
					activeSkill = 'react-best-practices';
					prompt = prompt.replace('/react', '').trim();
				} else if (prompt.includes('/fullstack')) {
					activeSkill = 'senior-fullstack';
					prompt = prompt.replace('/fullstack', '').trim();
				} else if (prompt.includes('/review')) {
					activeSkill = 'code-reviewer';
					prompt = prompt.replace('/review', '').trim();
				} else if (prompt.includes('/testing')) {
					activeSkill = 'webapp-testing';
					prompt = prompt.replace('/testing', '').trim();
				} else {
					// 2. Dynamic Slash Command Detection
					const skillMatch = prompt.match(/^\/([a-zA-Z0-9_-]+)/);
					if (skillMatch) {
						const skillCandidate = skillMatch[1].toLowerCase();
						const reserved = [
							'explain', 'fix', 'clear', 'available-skills',
							'hooks', 'models', 'tools', 'plugins', 'debug',
							'agents', 'skills', 'instructions', 'prompts',
							'fork', 'rename', 'autoapprove', 'disableautoapprove',
							'yolo', 'disableyolo', 'help'
						];
						if (!reserved.includes(skillCandidate)) {
							activeSkill = skillCandidate;
							prompt = prompt.replace(`/${skillCandidate}`, '').trim();
						}
					}
				}

				// 3. Prepend context only on the first turn if no slash command intercepted control
				if (turnCount === 1) {
					const activeEditor = this.editorService.activeEditor;
					const workspace = this.workspaceContextService.getWorkspace();
					const workspaceRoot = workspace.folders[0]?.uri;
					const workspaceName = workspace.folders[0]?.name || 'root';

					let context = `[Context: Workspace Root is ${workspaceName}]`;
					if (activeEditor?.resource && workspaceRoot) {
						const relPath =
							relativePath(workspaceRoot, activeEditor.resource) ||
							activeEditor.resource.fsPath;
						context += ` [Active File: ${relPath}]`;
					}
					prompt = `${context}\n${prompt}`;
				}

				// CRITICAL FIX: Always add current user message to messages array.
				// Previously: if messages.length > 0, prompt was sent as undefined → one-turn lag bug.
				// Now: current prompt is always the LAST user message in the array.
				if (turnCount === 1) {
					// Only add on the first agentic turn (turnCount was just incremented above)
					messages.push({ role: 'user', content: prompt });
				}

				const json = await this.aiService.request(
					backendUrl,
					{
						messages: messages,
						projectId: 'default_project',
						skill: activeSkill,
					},
					token,
				);

				const { response, tool_calls } = json;

				if (response) {
					progress([
						{ kind: 'markdownContent', content: new MarkdownString(response) },
					]);
					messages.push({ role: 'assistant', content: response });
				}

				if (!tool_calls || tool_calls.length === 0) {
					break;
				}

				// Handle Tool Calls
				const assistantMessage: IChatMessage = {
					role: 'assistant',
					tool_calls: tool_calls,
				};
				messages.push(assistantMessage);

				for (const toolCall of tool_calls) {
					const { name, arguments: argsString } = toolCall.function;
					const args = JSON.parse(argsString);

					progress([
						{
							kind: 'progressMessage',
							content: new MarkdownString(localize('chat.customAgent.executingTool', "Agent executing `{0}`...", name)),
						},
					]);

					let result;
					try {
						switch (name) {
							case 'read_file':
								result = await this.readFile(args.path);
								break;
							case 'write_file':
								result = await this.writeFile(
									args.path,
									args.content,
									progress,
								);
								break;
							case 'semantic_search':
								result = await this.semanticSearch(args.query, args.k);
								break;
							case 'apply_patch':
								result = await this.applyPatch(args.path, args.patch, progress);
								break;
							case 'get_diagnostics':
								result = await this.getDiagnostics(args.path);
								break;
							case 'create_folder':
								result = await this.createFolder(args.path);
								break;
							case 'delete_file':
								result = await this.deleteFile(args.path);
								break;
							case 'list_dir':
								result = await this.listDir(args.path);
								break;
							case 'go_to_definition':
								result = await this.goToDefinition(args.symbol, args.path);
								break;
							case 'run_terminal':
								result = await this.runTerminal(args.command);
								break;
							default:
								result = localize('chat.customAgent.unknownTool', "Error: Unknown tool {0}", name);
						}
					} catch (err) {
						result = localize('chat.customAgent.toolError', "Error executing tool: {0}", err);
					}

					messages.push({
						role: 'tool',
						tool_call_id: toolCall.id,
						name: name,
						content:
							typeof result === 'string' ? result : JSON.stringify(result),
					});
				}
			}
		} catch (e) {
			progress([
				{
					kind: 'markdownContent',
					content: new MarkdownString(
						localize('chat.customAgent.errorConnecting', "Error connecting to backend: {0}", (e instanceof Error ? e.message : String(e))),
					),
				},
			]);
		}

		return {};
	}

	private async readFile(relativePath: string): Promise<string> {
		const workspaceRoot =
			this.workspaceContextService.getWorkspace().folders[0]?.uri;
		if (!workspaceRoot) {
			return localize('chat.customAgent.noWorkspaceRoot', "Error: No workspace root found.");
		}
		const fileUri = joinWorkspacePath(workspaceRoot, relativePath);
		const content = await this.fileService.readFile(fileUri);
		return content.value.toString();
	}

	private async writeFile(
		relativePath: string,
		content: string,
		progress?: (parts: IChatProgress[]) => void,
	): Promise<string> {
		const workspaceRoot =
			this.workspaceContextService.getWorkspace().folders[0]?.uri;
		if (!workspaceRoot) {
			return localize('chat.customAgent.noWorkspaceRoot', "Error: No workspace root found.");
		}
		const fileUri = joinWorkspacePath(workspaceRoot, relativePath);

		// Read existing content to compute diff lines for the chat editing UI
		let existingLines: string[] = [];
		try {
			const existing = await this.fileService.readFile(fileUri);
			existingLines = existing.value.toString().split('\n');
		} catch {
			// New file — no existing content
		}

		// Write to disk
		await this.fileService.writeFile(fileUri, VSBuffer.fromString(content));

		// Emit textEdit progress so VS Code shows Accept/Reject in editor toolbar
		if (progress) {
			const newLines = content.split('\n');
			const endLine = Math.max(existingLines.length, newLines.length);
			progress([
				{
					kind: 'textEdit',
					uri: fileUri,
					edits: [
						{
							range: {
								startLineNumber: 1,
								startColumn: 1,
								endLineNumber: endLine + 1,
								endColumn: 1,
							},
							text: content,
						},
					],
					done: true,
				},
			]);
		}

		return localize('chat.customAgent.successWrite', "Successfully wrote {0}", relativePath);
	}

	private async semanticSearch(
		query: string,
		k: number = 5,
	): Promise<ISearchResult[]> {
		const searchUrl = `${this.backendUrl}/search`;
		try {
			const json = await this.aiService.request(
				searchUrl,
				{
					query,
					projectId: 'default_project',
					k,
				},
				CancellationToken.None,
			);
			return json.results || [];
		} catch (err) {
			// Fallback to IDE's in-memory store if backend is unavailable
			const results = await this.semanticContextService.search(
				query,
				CancellationToken.None,
			);
			return results.slice(0, k).map((r) => ({
				uri: r.uri,
				range: r.range,
				text: r.text.substring(0, 500) + '...',
				score: r.score,
			}));
		}
	}

	private async applyPatch(
		relativePath: string,
		patch: string,
		progress?: (parts: IChatProgress[]) => void,
	): Promise<string> {
		try {
			const original = await this.readFile(relativePath);
			const originalLines = original.split('\n');
			const patchLines = patch.split('\n');

			// Check if this is a unified diff or raw content
			const isUnifiedDiff = patchLines.some(
				(l) => l.startsWith('@@') || l.startsWith('---'),
			);

			if (!isUnifiedDiff) {
				// Fallback: If AI just sent a block of code, overwrite the file (safer than mangling)
				await this.writeFile(relativePath, patch, progress);
				return localize('chat.customAgent.updatedContent', "Updated {0} with new content.", relativePath);
			}

			const resultLines: string[] = [...originalLines];
			let offset = 0; // Tracks how much the file has grown/shrunk

			// Professional Hunk Parsing
			let i = 0;
			while (i < patchLines.length) {
				const line = patchLines[i];
				if (line.startsWith('@@')) {
					// Extract start line from @@ -oldStart,oldLen +newStart,newLen @@
					const match = line.match(/@@ -(\d+),?\d* \+(\d+),?\d* @@/);
					if (match) {
						let oldIdx = parseInt(match[1]) - 1; // 0-based
						i++; // Move to hunk content

						while (i < patchLines.length && !patchLines[i].startsWith('@@')) {
							const hunkLine = patchLines[i];
							if (hunkLine.startsWith('-')) {
								// Remove line at current position + offset
								resultLines.splice(oldIdx + offset, 1);
								offset--;
								oldIdx++;
							} else if (hunkLine.startsWith('+')) {
								// Insert line at current position + offset
								resultLines.splice(oldIdx + offset, 0, hunkLine.substring(1));
								offset++;
								// Notice: we DON'T increment oldIdx here because the next original line is still at the same index
							} else {
								// Context line — just verify and move pointer
								oldIdx++;
							}
							i++;
						}
						continue; // Next hunk or end
					}
				}
				i++;
			}

			const finalContent = resultLines.join('\n');
			await this.writeFile(relativePath, finalContent, progress);
			return localize('chat.customAgent.patchSuccess', "Successfully applied professional patch to {0}", relativePath);
		} catch (err) {
			// Fail-safe: if patching fails, try to write the raw patch as full content if it looks valid
			if (patch.length > 50) {
				await this.writeFile(relativePath, patch, progress);
				return localize('chat.customAgent.patchFullOverwrite', "Patch execution failed, performed full overwrite for safety to {0}", relativePath);
			}
			throw err;
		}
	}

	private async getDiagnostics(
		relativePath?: string,
	): Promise<
		{ file: string; message: string; severity: string; line: number }[]
	> {
		const workspaceRoot =
			this.workspaceContextService.getWorkspace().folders[0]?.uri;
		let filterUri: URI | undefined;
		if (relativePath && workspaceRoot) {
			filterUri = workspaceRoot.with({
				path: workspaceRoot.path + '/' + relativePath,
			});
		}

		const markers = this.markerService.read({ resource: filterUri });
		return markers.map((m) => ({
			file: m.resource.fsPath,
			message: m.message,
			severity: m.severity === MarkerSeverity.Error ? 'Error' : 'Warning',
			line: m.startLineNumber,
		}));
	}

	private async createFolder(relativePath: string): Promise<string> {
		const workspaceRoot =
			this.workspaceContextService.getWorkspace().folders[0]?.uri;
		if (!workspaceRoot) {
			return localize('chat.customAgent.noWorkspaceRoot', "Error: No workspace root found.");
		}
		const folderUri = joinWorkspacePath(workspaceRoot, relativePath);
		await this.fileService.createFolder(folderUri);
		return localize('chat.customAgent.createdFolder', "Created folder {0}", relativePath);
	}

	private async deleteFile(relativePath: string): Promise<string> {
		const workspaceRoot =
			this.workspaceContextService.getWorkspace().folders[0]?.uri;
		if (!workspaceRoot) {
			return localize('chat.customAgent.noWorkspaceRoot', "Error: No workspace root found.");
		}
		const fileUri = joinWorkspacePath(workspaceRoot, relativePath);
		await this.fileService.del(fileUri, { recursive: true });
		return localize('chat.customAgent.deletedFile', "Deleted {0}", relativePath);
	}

	private async listDir(
		relativePath: string,
	): Promise<{ name: string; isDir: boolean; size: number }[]> {
		const workspaceRoot =
			this.workspaceContextService.getWorkspace().folders[0]?.uri;
		if (!workspaceRoot) {
			return [];
		}
		// Special case: '.' or empty means the workspace root itself
		const dirUri =
			relativePath === '.' || relativePath === '' || relativePath === '/'
				? workspaceRoot
				: joinWorkspacePath(workspaceRoot, relativePath);
		const result = await this.fileService.resolve(dirUri);
		return (
			result.children?.map((c) => ({
				name: c.name,
				isDir: c.isDirectory,
				size: c.size || 0,
			})) || []
		);
	}

	private async goToDefinition(
		symbol: string,
		relativePath: string,
	): Promise<string> {
		const workspaceRoot =
			this.workspaceContextService.getWorkspace().folders[0]?.uri;
		if (!workspaceRoot) {
			return localize('chat.customAgent.noWorkspaceRoot', "Error: No workspace root found.");
		}

		const fileUri = joinWorkspacePath(workspaceRoot, relativePath);
		const content = await this.readFile(relativePath);
		const lines = content.split('\n');

		let position: Position | undefined;
		for (let i = 0; i < lines.length; i++) {
			const col = lines[i].indexOf(symbol);
			if (col !== -1) {
				position = new Position(i + 1, col + 1);
				break;
			}
		}

		if (!position) {
			return localize('chat.customAgent.symbolNotFound', "Error: Could not find symbol \"{0}\" in {1}", symbol, relativePath);
		}

		const model = this.modelService.getModel(fileUri);
		if (!model) {
			return localize('chat.customAgent.modelLoadError', "Error: Could not load model for {0}", relativePath);
		}

		const definitions = await getDefinitionsAtPosition(
			this.languageFeaturesService.definitionProvider,
			model,
			position,
			false,
			CancellationToken.None,
		);
		if (definitions.length === 0) {
			return localize('chat.customAgent.noDefinitions', "No definitions found for {0}", symbol);
		}

		const results = definitions.map((d) => {
			const range = Range.lift(d.range);
			return `${d.uri.fsPath}:${range.startLineNumber}:${range.startColumn}`;
		});

		return localize('chat.customAgent.definitionsFound', "Found {0} definitions:\n{1}", definitions.length, results.join('\n'));
	}

	private async runTerminal(command: string): Promise<string> {
		// Delegate terminal execution to the backend server which runs in Node.js
		try {
			const json = (await this.aiService.request(
				`${this.backendUrl}/terminal/run`,
				{
					command,
				},
				CancellationToken.None,
			)) as { stdout: string; stderr: string; exitCode: number };
			const output = [json.stdout, json.stderr].filter(Boolean).join('\n');
			return localize('chat.customAgent.terminalOutput', "Exit code: {0}\n{1}", json.exitCode, output || localize('chat.customAgent.noOutput', "(no output)"));
		} catch (err) {
			return localize('chat.customAgent.terminalError', "Terminal tool not yet connected to backend. Command requested: {0}\nError: {1}", command, err);
		}
	}
}
