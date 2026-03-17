/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { AzureOpenAI, OpenAI } from 'openai';
import Anthropic from '@anthropic-ai/sdk';
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

const anthropic = new Anthropic({
	apiKey: process.env.ANTHROPIC_API_KEY || '',
});

const openAI = new OpenAI({
	apiKey: process.env.OPENAI_API_KEY || '',
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

		const baseSystemPrompt = `You are CogniAI, an autonomous senior software engineer.`; // Truncated for brevity in this example replacement

		const finalSystemContent = baseSystemPrompt + (systemMessages.length > 0 ? '\n\nContext:\n' + systemMessages.map(m => m.content).join('\n') : '');

		const validatedMessages: ChatCompletionMessageParam[] = [
			{ role: 'system' as const, content: finalSystemContent }
		];

		// CRITICAL: Ensure alternating user/assistant roles and valid tool sequence for Azure
		for (let i = 0; i < otherMessages.length; i++) {
			const msg = otherMessages[i];
			const prev = validatedMessages[validatedMessages.length - 1];

			if (msg.role === 'tool') {
				if (prev.role !== 'assistant' || !prev.tool_calls?.length) continue;
			}

			// Prevent consecutive assistant messages (Azure restriction)
			if (msg.role === 'assistant' && prev.role === 'assistant') {
				// Merge content if possible, or skip
				if (msg.content && !prev.content) {
					prev.content = msg.content;
				}
				if (msg.tool_calls && !prev.tool_calls) {
					prev.tool_calls = msg.tool_calls;
				}
				continue;
			}

			validatedMessages.push(msg);
		}

		const chatCompletion = await azureClient.chat.completions.create({
			messages: validatedMessages,
			model: process.env.AZURE_OPENAI_DEPLOYMENT_NAME || '',
			tools: TOOLS,
			tool_choice: 'auto'
		});

		const choice = chatCompletion.choices[0];
		return {
			response: choice?.message?.content || '',
			tool_calls: choice?.message?.tool_calls || []
		};
	}

	static async generateEmbeddings(text: string | string[]) {
		try {
			const extractor = await this.getExtractor();
			const input = Array.isArray(text) ? text : [text];

			// Parallelize embedding generation
			const results = await Promise.all(input.map(async (t) => {
				const output = await extractor(t, { pooling: 'mean', normalize: true });
				return Array.from(output.data) as number[];
			}));

			return Array.isArray(text) ? results : results[0];
		} catch (err: unknown) {
			throw new Error(`Local Embedding Error: ${err instanceof Error ? err.message : String(err)}`);
		}
	}

	/**
	 * Generates an AI inline code completion using a Fill-In-the-Middle (FIM) prompt.
	 *
	 * @param prefix  - All code before the cursor position
	 * @param suffix  - All code after the cursor position
	 * @param language - Language ID (e.g. 'typescript', 'python')
	 * @param filePath - Relative file path for context
	 * @param context  - Assembled semantic context from SemanticContextService
	 * @param stream   - If true, returns an AsyncIterable of string tokens; otherwise returns full string
	 */
	static async generateCompletion(
		prefix: string,
		suffix: string,
		language: string,
		filePath: string,
		context: string,
		stream: true
	): Promise<AsyncIterable<string>>;
	static async generateCompletion(
		prefix: string,
		suffix: string,
		language: string,
		filePath: string,
		context: string,
		stream?: false
	): Promise<string>;
	static async generateCompletion(
		prefix: string,
		suffix: string,
		language: string,
		filePath: string,
		context: string,
		stream = false
	): Promise<string | AsyncIterable<string>> {

		const provider = process.env.AI_PROVIDER || 'azure';
		const model = process.env.AI_MODEL || process.env.AZURE_OPENAI_DEPLOYMENT_NAME || 'gpt-4o';

		const trimmedPrefix = prefix.slice(-3000);
		const trimmedSuffix = suffix.slice(0, 500);
		const trimmedContext = context.slice(0, 4000);

		const systemPrompt = `You are a professional ${language} engineer. Complete the code at <FILL_IN_THE_MIDDLE>. Raw code only.`;
		const userPrompt = `${trimmedContext ? `CONTEXT:\n${trimmedContext}\n\n` : ''}FILE: ${filePath}\nPREFIX:\n${trimmedPrefix}\n<FILL_IN_THE_MIDDLE>\nSUFFIX:\n${trimmedSuffix}`;

		const messages = [
			{ role: 'system' as const, content: systemPrompt },
			{ role: 'user' as const, content: userPrompt },
		];

		if (provider === 'anthropic') {
			const anthropicResponse = await anthropic.messages.create({
				model: model,
				max_tokens: 256,
				system: systemPrompt,
				messages: [{ role: 'user', content: userPrompt }],
				stream: stream as any,
			});

			if (stream) {
				async function* anthropicGenerator(): AsyncIterable<string> {
					for await (const chunk of anthropicResponse as any) {
						if (chunk.type === 'content_block_delta' && chunk.delta.text) yield chunk.delta.text;
					}
				}
				return anthropicGenerator();
			}
			return (anthropicResponse as any).content[0].text;
		}

		// OpenAI / Azure Shared Path
		const client = provider === 'openai' ? openAI : azureClient;
		const completion = await client.chat.completions.create({
			model,
			messages,
			max_tokens: 256,
			temperature: 0.1,
			stream: stream as any,
		});

		if (stream) {
			async function* openaiGenerator(): AsyncIterable<string> {
				for await (const chunk of completion as any) {
					const token = chunk.choices[0]?.delta?.content ?? '';
					if (token) { yield token; }
				}
			}
			return openaiGenerator();
		}

		return (completion as any).choices[0]?.message?.content ?? '';
	}
}
