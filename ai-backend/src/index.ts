/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import express, { Request, Response } from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import { AiService } from './services/ai.service';
import { VectorService } from './services/vector.service';
import { AstService } from './services/ast.service';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// Request Logger
app.use((req, res, next) => {
	console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
	next();
});

const PORT = process.env.PORT || 3000;

// --- AI Query Endpoint (RAG) ---
app.post('/ai/query', async (req: Request, res: Response) => {
	const { prompt, projectId = 'default_project', messages: clientMessages } = req.body;

	if (prompt === 'ping') {
		return res.json({ response: 'pong' });
	}

	try {
		let messages = clientMessages || [];

		// If it's a new request (no history), prepare the initial prompt
		if (messages.length === 0 && prompt) {
			// 1. Embed query (for initial context)
			console.log(`[AI] Generating query embedding for: ${prompt.substring(0, 50)}...`);
			const queryVector = await AiService.generateEmbeddings(prompt);

			// 2. Vector Search
			console.log(`[Vector] Searching LanceDB for project: ${projectId}...`);
			const contextResults = await VectorService.search(projectId, queryVector as number[]);
			const contextText = contextResults.map((r: any) => r.text).join('\n\n---\n\n');

			messages = [
				{
					role: 'system',
					content: 'You are a professional AI Assistant with tools to read/write files and perform semantic searches. ' +
						'Analyze the initial context provided below to answer the users query' +
						`\n\nInitial Context:\n${contextText}`
				},
				{ role: 'user', content: prompt }
			];
		}

		// 3. Generate response with context
		console.log(`[AI] Processing ${messages.length} messages...`);
		const { response, tool_calls } = await AiService.generateResponse(messages);

		res.json({ response, tool_calls });
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : String(err);
		console.error('AI Query Error:', message);
		res.status(500).json({ error: message });
	}
});

// --- Indexing Endpoint ---
app.post('/embeddings/index', async (req: Request, res: Response) => {
	const { projectId, chunks } = req.body; // chunks: Array of { text, metadata }

	try {
		const texts = chunks.map((c: any) => c.text);
		console.log(`[AI] Generating embeddings for ${texts.length} chunks...`);
		const vectors = await AiService.generateEmbeddings(texts) as number[][];

		const formattedChunks = chunks.map((c: any, i: number) => ({
			text: c.text,
			metadata: c.metadata || {},
			vector: vectors[i]
		}));

		console.log(`[Vector] Indexing ${formattedChunks.length} chunks in LanceDB...`);
		await VectorService.indexChunks(projectId, formattedChunks);
		res.json({ success: true, count: chunks.length });
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : String(err);
		console.error('Indexing Error:', message);
		res.status(500).json({ error: message });
	}
});

// --- Server-Side AST Indexing Endpoint ---
app.post('/embeddings/index-file', async (req: Request, res: Response) => {
	const { projectId, uri, text, languageId } = req.body;

	try {
		console.log(`[AI] Server-side indexing for ${uri} (${languageId})...`);

		// 1. Perform Professional AST Parsing
		const chunks = AstService.parseFile(uri, text, languageId);
		console.log(`[AI] Extracted ${chunks.length} professional chunks.`);

		// 2. Embed
		const texts = chunks.map(c => c.text);
		const vectors = await AiService.generateEmbeddings(texts) as number[][];

		const formattedChunks = chunks.map((c, i) => ({
			text: c.text,
			metadata: c.metadata,
			vector: vectors[i]
		}));

		// 3. Store
		await VectorService.indexChunks(projectId, formattedChunks);

		res.json({ success: true, count: chunks.length });
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : String(err);
		console.error('Server-Side Indexing Error:', message);
		res.status(500).json({ error: message });
	}
});

// --- Semantic Search Endpoint (for Agent Tool Use) ---
app.post('/search', async (req: Request, res: Response) => {
	const { query, projectId, k } = req.body;

	try {
		console.log(`[Vector] Semantic search: "${query}" in project: ${projectId}`);
		const queryVector = await AiService.generateEmbeddings(query);
		const results = await VectorService.search(projectId, queryVector as number[], k || 5);

		const formatted = results.map((r: any) => ({
			text: r.text,
			metadata: r.metadata || {},
			score: r._distance || 0
		}));

		res.json({ results: formatted });
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : String(err);
		console.error('Search Error:', message);
		res.status(500).json({ error: message });
	}
});

app.listen(PORT, () => {
	console.log(`AI Backend running on http://localhost:${PORT}`);
});
