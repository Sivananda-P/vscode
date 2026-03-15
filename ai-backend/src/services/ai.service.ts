/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureOpenAI } from 'openai';
import type { ChatCompletionMessageParam, ChatCompletionTool, ChatCompletionSystemMessageParam } from 'openai/resources/index';
import dotenv from 'dotenv';
import { pipeline } from '@xenova/transformers';

dotenv.config();

const azureClient = new AzureOpenAI({
	apiKey: process.env.AZURE_OPENAI_API_KEY || '',
	endpoint: process.env.AZURE_OPENAI_ENDPOINT || '',
	apiVersion: process.env.AZURE_OPENAI_API_VERSION || '2024-05-01-preview',
	deployment: process.env.AZURE_OPENAI_DEPLOYMENT_NAME || '',
});

export const TOOLS = [
	{
		type: 'function',
		function: {
			name: 'semantic_search',
			description: 'Search the codebase using vector embeddings to find relevant code blocks such as functions, classes, and modules.',
			parameters: {
				type: 'object',
				properties: {
					query: { type: 'string', description: 'The natural language search query. Use this to find code across the entire workspace.' },
					k: { type: 'number', description: 'Number of results to return (default 5).' }
				},
				required: ['query']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'read_file',
			description: 'Read the contents of a file in the workspace.',
			parameters: {
				type: 'object',
				properties: {
					path: { type: 'string', description: 'The relative path to the file.' }
				},
				required: ['path']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'write_file',
			description: 'Overwrite a file with updated code. Use only for bug fixes, new features, or refactorings.',
			parameters: {
				type: 'object',
				properties: {
					path: { type: 'string', description: 'The relative path to the file.' },
					content: { type: 'string', description: 'The new content for the file.' }
				},
				required: ['path', 'content']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'apply_patch',
			description: 'Apply a structured modification to an existing file using a minimal diff.',
			parameters: {
				type: 'object',
				properties: {
					path: { type: 'string', description: 'The relative path to the file.' },
					patch: { type: 'string', description: 'The diff/patch content.' }
				},
				required: ['path', 'patch']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'get_diagnostics',
			description: 'Retrieve IDE diagnostics such as lint errors, type errors, and warnings for the current workspace or a specific file.',
			parameters: {
				type: 'object',
				properties: {
					path: { type: 'string', description: 'Optional relative path to filter diagnostics.' }
				}
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'go_to_definition',
			description: 'Find the implementation location of a symbol using language services.',
			parameters: {
				type: 'object',
				properties: {
					symbol: { type: 'string', description: 'The name of the symbol to find.' },
					path: { type: 'string', description: 'The file path where the symbol is referenced.' }
				},
				required: ['symbol', 'path']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'create_folder',
			description: 'Create a new folder in the workspace.',
			parameters: {
				type: 'object',
				properties: {
					path: { type: 'string', description: 'The relative path to the folder.' }
				},
				required: ['path']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'delete_file',
			description: 'Delete a file or folder in the workspace.',
			parameters: {
				type: 'object',
				properties: {
					path: { type: 'string', description: 'The relative path to the file or folder.' }
				},
				required: ['path']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'list_dir',
			description: 'List the contents of a directory.',
			parameters: {
				type: 'object',
				properties: {
					path: { type: 'string', description: 'The relative path to the directory. Use "." for the workspace root.' }
				},
				required: ['path']
			}
		}
	},
	{
		type: 'function',
		function: {
			name: 'run_terminal',
			description: 'Run a shell command in the workspace terminal. Use to install packages, run builds, run tests, or execute scripts.',
			parameters: {
				type: 'object',
				properties: {
					command: { type: 'string', description: 'The shell command to execute (e.g. "npm install", "git status").' }
				},
				required: ['command']
			}
		}
	}
] satisfies ChatCompletionTool[];

export class AiService {
	private static extractor: any = null;

	private static async getExtractor() {
		if (!this.extractor) {
			this.extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
		}
		return this.extractor;
	}

	static async generateResponse(messages: ChatCompletionMessageParam[]) {
		// Consolidate system messages into the first slot
		const systemMessages = messages.filter((m): m is ChatCompletionSystemMessageParam => m?.role === 'system');
		const otherMessages = messages.filter(m => m && m.role !== 'system');

		const baseSystemPrompt = `You are CogniAI, an autonomous AI software engineering agent integrated inside the user's IDE.

You are NOT a chatbot. You are an autonomous builder whose job is to analyze, modify, and create files inside the user's workspace using tools.

---

PRIMARY OBJECTIVE:
Complete the user's request by directly interacting with the workspace using tools. Never stop because files do not exist. If something is missing — CREATE IT.

---

MANDATORY WORKFLOW (follow this for EVERY task):

STEP 1 — ANALYZE WORKSPACE
Always start with: list_dir(".")
If empty, create the required structure immediately.

STEP 2 — LOCATE RELEVANT CODE
If project has files, use semantic_search and read_file.
NEVER modify a file without reading it first.

STEP 3 — IMPLEMENT SOLUTION
- Use apply_patch for editing existing files
- Use write_file for new files
- Use create_folder if folders are missing
- Use delete_file if something must be removed
Modify files sequentially. Write code INTO files. Never paste code into chat.

STEP 4 — VERIFY
After writing or editing code, call get_diagnostics.
If errors exist, fix them immediately. Repeat until no errors.

---

FILE CREATION POLICY:
If the user asks to build something and workspace files don't exist — create the ENTIRE structure automatically.
Example: "create a signup page" → create_folder → write_file HTML → write_file CSS → done.
Do NOT ask for confirmation. Just build.

---

TOOL PRIORITY ORDER:
1. list_dir
2. semantic_search
3. read_file
4. apply_patch
5. write_file
6. create_folder
7. delete_file
8. get_diagnostics

---

IMPORTANT RULES:
- NEVER say "files do not exist" and stop. Create them.
- Always move forward. Complete the task.
- Chat is secondary. Use it only after finishing. Keep it short.
- All paths are relative to workspace root (".").
- If user says "in folder X" and X is the project name, use ".".

---

IDENTITY: You are a senior autonomous software engineer. Think in systems and files. Stop explaining. Start building.`;

		const finalSystemContent = baseSystemPrompt + (systemMessages.length > 0 ? '\n\nContext and Instructions:\n' + systemMessages.map(m => m.content).join('\n') : '');

		// Validate message sequence: 'tool' role messages must be preceded by 'assistant' with tool_calls
		// Azure OpenAI is strict about this ordering
		const allMessages: ChatCompletionMessageParam[] = [
			{ role: 'system' as const, content: finalSystemContent },
			...otherMessages
		];
		const validatedMessages: ChatCompletionMessageParam[] = [];
		for (let i = 0; i < allMessages.length; i++) {
			const msg = allMessages[i];
			if (msg.role === 'tool') {
				// Check that previous message is assistant with tool_calls
				const prev = validatedMessages[validatedMessages.length - 1];
				if (!prev || prev.role !== 'assistant' || !(prev as any).tool_calls?.length) {
					// Skip orphaned tool messages — they cause the empty response error
					console.warn('[Azure AI] Skipping orphaned tool message (no preceding assistant tool_call)');
					continue;
				}
			}
			validatedMessages.push(msg);
		}

		console.log(`[Azure AI] Sending ${validatedMessages.length} validated messages`);

		const chatCompletion = await azureClient.chat.completions.create({
			messages: validatedMessages,
			model: process.env.AZURE_OPENAI_DEPLOYMENT_NAME || '',
			tools: TOOLS,
			tool_choice: 'auto'
		});

		const choice = chatCompletion.choices[0];
		const message = choice?.message;
		const finish_reason = choice?.finish_reason;
		const tool_calls = message?.tool_calls || [];
		const content = message?.content || '';

		console.log(`[Azure AI] finish_reason: ${finish_reason}, tool_calls: ${tool_calls.length}, content_len: ${content.length}`);

		if (tool_calls.length > 0) {
			console.log(`[Azure AI] Tool calls: ${tool_calls.map((tc: any) => tc.function?.name).filter(Boolean).join(', ')}`);
		}

		// Guard: if both are empty (model misfired), return a safe fallback
		if (!content && tool_calls.length === 0) {
			console.warn('[Azure AI] Empty response from model — returning safe fallback');
			return {
				response: 'I encountered an issue processing that request. Please try again.',
				tool_calls: []
			};
		}

		return {
			response: content,
			tool_calls: tool_calls
		};
	}

	static async generateEmbeddings(text: string | string[]) {
		try {
			const extractor = await this.getExtractor();
			const input = Array.isArray(text) ? text : [text];
			const results: number[][] = [];

			for (const t of input) {
				const output = await extractor(t, { pooling: 'mean', normalize: true });
				results.push(Array.from(output.data));
			}

			return Array.isArray(text) ? results : results[0];
		} catch (err: unknown) {
			throw new Error(`Local Embedding Error: ${err instanceof Error ? err.message : String(err)}`);
		}
	}
}
