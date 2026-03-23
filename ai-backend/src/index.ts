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
import { SkillService } from './services/skill.service';
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
const startTime = Date.now();

// --- Health Check -------------------------------------------------------------
// Prevents "Cannot GET /" error when the backend URL is opened in a browser.
app.get('/', (_req: Request, res: Response) => {
	res.json({
		name: 'CogniAI Backend',
		status: 'running OK',
		uptime: `${Math.floor((Date.now() - startTime) / 1000)}s`,
		version: '1.0.0',
		endpoints: {
			'POST /ai/query': 'CogniAI agent chat (tool-calling loop)',
			'POST /ai/complete': 'Inline code completion (non-streaming)',
			'POST /ai/complete/stream': 'Inline code completion (SSE streaming)',
			'POST /embeddings/index': 'Index code chunks from frontend',
			'POST /embeddings/index-file': 'Index a file via AST parsing (server-side)',
			'POST /search': 'Semantic similarity search',
			'POST /terminal/run': 'Execute shell commands',
			'GET  /health': 'Alias for this health check',
		},
	});
});

// Alias: GET /health
app.get('/health', (_req: Request, res: Response) => {
	res.json({ status: 'ok', uptime: `${Math.floor((Date.now() - startTime) / 1000)}s` });
});

// --- AI Query Endpoint (RAG) ---
app.post('/ai/query', async (req: Request, res: Response) => {
	const { prompt, projectId = 'default_project', messages: clientMessages, skill } = req.body;

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
		console.log(`[AI] Total messages: ${messages.length}, Skill: ${skill || 'none'}`);

		const { response, tool_calls } = await AiService.generateResponse(messages, skill);
		res.json({ response, tool_calls });

	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : String(err);
		console.error('AI Query Error:', message);
		res.status(500).json({ error: message });
	}
});

// --- AI Skills List Endpoint ---
app.post('/ai/skills', (_req: Request, res: Response) => {
	const skills = SkillService.getSkills().map(s => ({
		name: s.name,
		description: s.description
	}));
	res.json({ skills });
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
	const { projectId, uri, text, languageId, skipIndexUpdate, mtime } = req.body;

	try {
		console.log(`[AI] Server-side indexing for ${uri} (${languageId})...`);

		// 1. Perform Professional AST Parsing
		const chunks = AstService.parseFile(uri, text, languageId, mtime);
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
		await VectorService.indexChunks(projectId || 'default_project', formattedChunks, skipIndexUpdate);

		res.json({ success: true, count: chunks.length });
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : String(err);
		console.error('Server-Side Indexing Error:', message);
		res.status(500).json({ error: message });
	}
});

// --- Metadata & Cleanup Endpoints ---

/**
 * POST /embeddings/mtimes
 * Returns a list of all [uri, mtime] pairs for a project.
 */
app.post('/embeddings/mtimes', async (req: Request, res: Response) => {
	const { projectId } = req.body;
	try {
		console.log(`[Vector] Fetching file mtimes for project: ${projectId}`);
		const mtimes = await VectorService.getFileMtimes(projectId || 'default_project');
		res.json({ mtimes });
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : String(err);
		console.error('Get Mtimes Error:', message);
		res.status(500).json({ error: message });
	}
});

/**
 * POST /embeddings/delete
 * Deletes all chunks for a specific file (URI).
 */
app.post('/embeddings/delete', async (req: Request, res: Response) => {
	const { projectId, uri } = req.body;
	try {
		console.log(`[Vector] Deleting chunks for URI: ${uri} in project: ${projectId}`);
		await VectorService.deleteChunks(projectId || 'default_project', uri);
		res.json({ success: true });
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : String(err);
		console.error('Delete Chunks Error:', message);
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

// --- AI Autocomplete Endpoints ------------------------------------------------

/**
 * POST /ai/complete
 * Non-streaming inline code completion.
 * Body: { prefix, suffix, language, filePath, context }
 * Response: { suggestion: string }
 */
app.post('/ai/complete', async (req: Request, res: Response) => {
	const {
		prefix = '',
		suffix = '',
		language = 'plaintext',
		filePath = 'unknown',
		context = ''
	} = req.body;

	if (typeof prefix !== 'string') {
		return res.status(400).json({ error: 'prefix must be a string' });
	}

	try {
		console.log(`[Autocomplete] Non-stream request | lang=${language} | prefix_len=${prefix.length}`);
		const suggestion = await AiService.generateCompletion(
			prefix, suffix, language, filePath, context
		);
		console.log(`[Autocomplete] Suggestion len=${suggestion.length}`);
		res.json({ suggestion });
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : String(err);
		console.error('[Autocomplete] Error:', message);
		res.status(500).json({ error: message });
	}
});

/**
 * POST /ai/complete/stream
 * SSE streaming inline code completion.
 * Body: { prefix, suffix, language, filePath, context }
 * Response: Server-Sent Events — data: {"token":"..."}\n\n ... data: [DONE]\n\n
 */
app.post('/ai/complete/stream', async (req: Request, res: Response) => {
	const {
		prefix = '',
		suffix = '',
		language = 'plaintext',
		filePath = 'unknown',
		context = ''
	} = req.body;

	if (typeof prefix !== 'string') {
		return res.status(400).json({ error: 'prefix must be a string' });
	}

	// SSE headers
	res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
	res.setHeader('Cache-Control', 'no-cache, no-transform');
	res.setHeader('Connection', 'keep-alive');
	res.setHeader('X-Accel-Buffering', 'no'); // disable nginx proxy buffering
	res.flushHeaders();

	const sendEvent = (data: string) => {
		res.write(`data: ${data}\n\n`);
	};

	try {
		console.log(`[Autocomplete/Stream] Request | lang=${language} | prefix_len=${prefix.length}`);

		const tokenStream = await AiService.generateCompletion(
			prefix, suffix, language, filePath, context, true
		);

		let totalTokens = 0;
		for await (const token of tokenStream) {
			sendEvent(JSON.stringify({ token }));
			totalTokens++;
		}

		sendEvent('[DONE]');
		console.log(`[Autocomplete/Stream] Done | tokens_sent=${totalTokens}`);
		res.end();
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : String(err);
		console.error('[Autocomplete/Stream] Error:', message);
		sendEvent(JSON.stringify({ error: message }));
		sendEvent('[DONE]');
		res.end();
	}
});

// --- Start Server -------------------------------------------------------------

app.listen(Number(PORT), '0.0.0.0', async () => {
	console.log(`AI Backend running on http://localhost:${PORT}`);
	await SkillService.loadSkills();
});

