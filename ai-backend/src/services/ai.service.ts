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
					query: { type: 'string', description: 'The natural language search query.' },
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
					path: { type: 'string', description: 'The relative path to the directory.' }
				},
				required: ['path']
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
		const systemMessages = messages.filter((m): m is ChatCompletionSystemMessageParam => m.role === 'system');
		const otherMessages = messages.filter(m => m.role !== 'system');

		const baseSystemPrompt = `You are CogniAI, the world's most advanced autonomous AI software engineering agent. You are NOT a chatbot; you are a builder.
Your workspace is the user's IDE, and your tools are your hands. Your goal is to fulfill user requests by directly manipulating the codebase.

EXECUTION PROTOCOL:
1. ALWAYS ACT FIRST: If a user asks to build or fix something, do not explain how you will do it. USE YOUR TOOLS immediately.
2. MULTI-STEP REASONING: Use your 10-turn limit to perform complex workflows. (e.g., list_dir -> read_file -> analyze -> create_folder -> write_multiple_files -> verify with get_diagnostics).
3. WORKSPACE INTEGRITY: Never provide partial code or snippets in chat if they belong in a file. Use 'write_file' or 'apply_patch' for at least 90% of your output.
4. PROACTIVE EXPLORATION: If context is missing, use 'semantic_search' or 'list_dir' without asking. If you see an error, fix it.
5. NO PLACEHOLDERS: Always write complete, production-ready, professional code. Never use "implement logic here" comments.
6. IDENTITY: You are CogniAI. You are senior, precise, and autonomous.

TOOL PRIORITY:
- Use 'write_file' for new files or complete overwrites.
- Use 'apply_patch' for surgical edits.
- Use 'get_diagnostics' after every major change to ensure you haven't broken anything.

When you finish, give a 1-sentence summary of the actions taken. Let the results in the workspace speak for themselves.`;

		const finalSystemContent = baseSystemPrompt + (systemMessages.length > 0 ? '\n\nContext and Instructions:\n' + systemMessages.map(m => m.content).join('\n') : '');

		const finalMessages: ChatCompletionMessageParam[] = [
			{ role: 'system', content: finalSystemContent },
			...otherMessages
		];

		console.log(`[Azure AI] Messages: ${finalMessages.length}, System Prompt Length: ${finalMessages[0]?.content?.length ?? 0}`);

		const chatCompletion = await azureClient.chat.completions.create({
			messages: finalMessages,
			model: process.env.AZURE_OPENAI_DEPLOYMENT_NAME || '',
			tools: TOOLS,
			tool_choice: 'auto'
		});

		const message = chatCompletion.choices[0]?.message;
		const tool_calls = message?.tool_calls || [];
		const content = message?.content || '';

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
