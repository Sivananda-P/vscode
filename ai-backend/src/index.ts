import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { GeminiService } from "./services/gemini.service";
import { VectorService } from "./services/vector.service";

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

const PORT = process.env.PORT || 3000;

// --- AI Query Endpoint (RAG) ---
app.post("/ai/query", async (req: express.Request, res: express.Response) => {
	const { prompt, projectId } = req.body;

	try {
		// 1. Embed query
		const queryVector = await GeminiService.generateEmbeddings(prompt);

		// 2. Vector Search
		const contextResults = await VectorService.search(projectId, queryVector as number[]);
		const contextText = contextResults.map((r: any) => r.text).join("\n\n---\n\n");

		// 3. Generate response with context
		const response = await GeminiService.generateResponse(prompt, contextText);

		res.json({ response, contextUsed: contextResults.length });
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : String(err);
		res.status(500).json({ error: message });
	}
});

// --- Indexing Endpoint ---
app.post("/embeddings/index", async (req: express.Request, res: express.Response) => {
	const { projectId, chunks } = req.body; // chunks: Array of { text, metadata }

	try {
		const texts = chunks.map((c: any) => c.text);
		const vectors = await GeminiService.generateEmbeddings(texts);

		const formattedChunks = chunks.map((c: any, i: number) => ({
			...c,
			vector: vectors[i]
		}));

		await VectorService.indexChunks(projectId, formattedChunks);
		res.json({ success: true, count: chunks.length });
	} catch (err: unknown) {
		const message = err instanceof Error ? err.message : String(err);
		res.status(500).json({ error: message });
	}
});

app.listen(PORT, () => {
	console.log(`AI Backend running on http://localhost:${PORT}`);
});
