import Groq from "groq-sdk";
import dotenv from "dotenv";
import { pipeline } from "@xenova/transformers";

dotenv.config();

const groq = new Groq({
	apiKey: process.env.GROQ_API_KEY || "",
});

export const TOOLS = [
	{
		type: "function",
		function: {
			name: "semantic_search",
			description: "Search the codebase using semantic context to find relevant files and code chunks.",
			parameters: {
				type: "object",
				properties: {
					query: { type: "string", description: "The natural language search query." },
					k: { type: "number", description: "Number of results to return (default 5)." }
				},
				required: ["query"]
			}
		}
	},
	{
		type: "function",
		function: {
			name: "read_file",
			description: "Read the contents of a file in the workspace.",
			parameters: {
				type: "object",
				properties: {
					path: { type: "string", description: "The relative path to the file." }
				},
				required: ["path"]
			}
		}
	},
	{
		type: "function",
		function: {
			name: "write_file",
			description: "Update or create a file in the workspace.",
			parameters: {
				type: "object",
				properties: {
					path: { type: "string", description: "The relative path to the file." },
					content: { type: "string", description: "The new content for the file." }
				},
				required: ["path", "content"]
			}
		}
	}
] as const;

export class AiService {
	private static extractor: any = null;

	private static async getExtractor() {
		if (!this.extractor) {
			this.extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
		}
		return this.extractor;
	}

	static async generateResponse(messages: any[]) {
		// Consolidate system messages into the first slot
		const systemMessages = messages.filter(m => m.role === 'system');
		const otherMessages = messages.filter(m => m.role !== 'system');

		const baseSystemPrompt = "You are a professional AI Assistant with tools to read/write files and perform semantic searches. " +
			"If you need to use a tool, use the function calling mechanism. " +
			"CRITICAL: Do not output any text or tags like <function> when calling a tool. " +
			"Provide a clear and concise response once you have the tool results.";

		const finalSystemContent = baseSystemPrompt + (systemMessages.length > 0 ? "\n\nContext and Instructions:\n" + systemMessages.map(m => m.content).join("\n") : "");

		const finalMessages = [
			{ role: "system", content: finalSystemContent },
			...otherMessages
		];

		console.log(`[Groq] Messages: ${finalMessages.length}, System Prompt Length: ${finalMessages[0].content.length}`);

		const chatCompletion = await groq.chat.completions.create({
			messages: finalMessages,
			model: "llama-3.3-70b-versatile",
			tools: TOOLS as any,
			tool_choice: "auto"
		});

		const message = chatCompletion.choices[0]?.message;

		// Fallback: If the model output a JSON string or custom tags instead of a tool call
		let tool_calls = message?.tool_calls || [];
		let content = message?.content || "";

		if (!tool_calls || tool_calls.length === 0) {
			// 1. Check for <function=name{...}</function> tags (Groq custom format)
			// Format can be: <function=read_file{"path": "..."}></function> or <function=read_file {"path": "..."}></function>
			const tagRegex = /<function=(\w+)\s*(\{[\s\S]*?\})\s*<\/function>/;
			const match = content.match(tagRegex);

			if (match) {
				const name = match[1];
				const argsText = match[2].trim();
				console.log(`[Groq Fallback] Caught custom tag: ${name}, args: ${argsText}`);
				tool_calls = [{
					id: "manual_tag_" + Date.now(),
					type: "function",
					function: {
						name: name,
						arguments: argsText
					}
				}];
				content = "";
			}
			// 2. Check for raw JSON in content
			else if (content.trim().startsWith('{') || content.includes('"name"')) {
				try {
					// Find the JSON block if there's surrounding text
					const jsonMatch = content.match(/(\{[\s\S]*\})/);
					if (jsonMatch) {
						const potentialTool = JSON.parse(jsonMatch[1]);
						const name = potentialTool.name || potentialTool.function?.name;
						const args = potentialTool.arguments || potentialTool.parameters || potentialTool.function?.arguments;

						if (name) {
							console.log(`[Groq Fallback] Manually parsed tool call: ${name}`);
							tool_calls = [{
								id: "manual_json_" + Date.now(),
								type: "function",
								function: {
									name: name,
									arguments: typeof args === 'string' ? args : JSON.stringify(args || {})
								}
							}];
							content = "";
						}
					}
				} catch { /* ignore */ }
			}
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
