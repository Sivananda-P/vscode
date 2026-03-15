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
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

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
		// The frontend (customAgent.ts) now always sends a complete messages array
		// with the current user message already appended as the LAST item.
		// We just need to ensure the system prompt is at the front.
		const messages: any[] = clientMessages || [];

		// Inject system prompt if missing (first turn or fallback)
		const hasSystemMessage = messages.some(m => m.role === 'system');
		if (!hasSystemMessage) {
			messages.unshift({
				role: 'system',
				content: 'You are CogniAI, an autonomous senior software engineer. Execute tasks immediately using tools. Never say "I cannot" — always use tools to find and fix the issue.'
			});
		}

		// Safety: validate we have at least one user message
		const hasUserMessage = messages.some(m => m.role === 'user');
		if (!hasUserMessage) {
			return res.status(400).json({ error: 'No user message in messages array.' });
		}

		// Log last user message for debugging
		const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
		console.log(`[AI] Processing request. Last user msg: "${String(lastUserMsg?.content || '').substring(0, 80)}..."`);
		console.log(`[AI] Total messages: ${messages.length}`);

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
		console.log(`[Vector] Semantic search: '${query}' in project: ${projectId}`);
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

app.post('/terminal/run', async (req: Request, res: Response) => {
	const { command, cwd } = req.body;

	if (!command || typeof command !== 'string') {
		return res.status(400).json({ error: 'Missing or invalid "command"' });
	}

	// Sanitize: disallow dangerous commands in production
	const blocked = ['rm -rf /', 'format', 'del /f /s /q C:\\'];
	if (blocked.some(b => command.includes(b))) {
		return res.status(403).json({ error: 'Command blocked for safety.' });
	}

	try {
		console.log(`[Terminal] Running: ${command}`);
		const { stdout, stderr } = await execAsync(command, {
			cwd: cwd || process.cwd(),
			timeout: 30000,
			maxBuffer: 1024 * 1024 * 5 // 5MB
		});
		res.json({ stdout, stderr, exitCode: 0 });
	} catch (err: unknown) {
		const e = err as { stdout?: string; stderr?: string; code?: number; message?: string };
		res.json({
			stdout: e.stdout || '',
			stderr: e.stderr || e.message || String(err),
			exitCode: e.code || 1
		});
	}
});

app.listen(PORT, () => {
	console.log(`AI Backend running on http://localhost:${PORT}`);
});
