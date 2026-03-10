import { GoogleGenerativeAI } from "@google/generative-ai";
import dotenv from "dotenv";

dotenv.config();

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || "");
const model = genAI.getGenerativeModel({ model: "gemini-1.5-flash-latest" });
const embeddingModel = genAI.getGenerativeModel({ model: "text-embedding-004" });

export class GeminiService {
	static async generateResponse(prompt: string, context?: string) {
		const fullPrompt = context
			? `Context:\n${context}\n\nUser Question: ${prompt}`
			: prompt;

		const result = await model.generateContent(fullPrompt);
		const response = await result.response;
		return response.text();
	}

	static async generateEmbeddings(text: string | string[]) {
		try {
			if (Array.isArray(text)) {
				const result = await embeddingModel.batchEmbedContents({
					requests: text.map(t => ({
						content: { parts: [{ text: t }], role: "user" },
						model: "models/text-embedding-004"
					}))
				});
				return result.embeddings.map(e => e.values);
			} else {
				const result = await embeddingModel.embedContent({
					content: { parts: [{ text }], role: "user" }
				});
				return result.embedding.values;
			}
		} catch (err: unknown) {
			throw new Error(`Gemini Embedding Error: ${err instanceof Error ? err.message : String(err)}`);
		}
	}
}
