# Professional AI IDE: Architecture Overview

This project has been transformed from a simple API-client into a **professional-grade distributed system**. This architecture is modeled after industry standards like Cursor and GitHub Copilot.

---

## 🏗️ System Components

The system is composed of two primary layers interacting over a secure local network.

### 1. The IDE Client (VS Code Fork)
Located in: `src/vs/workbench/...`

The IDE acts as the user interface and data extractor. It no longer contains sensitive logic or API keys.
*   **`CustomAgent.ts`**: The "Chat Brain" of the IDE. Instead of calling Google directly, it sends a JSON request to `localhost:3000/ai/query`.
*   **`GeminiEmbeddingProvider.ts`**: The "Sensor". It watches your files, breaks them into chunks, and sends them to the backend for professional indexing.
*   **UI Layers**: Standard VS Code chat panels and status bars that communicate the state of the backend.

### 2. The AI Backend (Node.js & LanceDB)
Located in: `ai-backend/`

This is the centralized "Command Center" that handles all heavy lifting.
*   **Express Server (`index.ts`)**: Manages external API endpoints.
*   **Gemini Service (`gemini.service.ts`)**: The AI Orchestrator. It handles the specific formatting for Google's Gemini 1.5 Flash (for chat) and text-embedding-004 (for vectorization).
*   **Vector Service (`vector.service.ts`)**: Powered by **LanceDB**. It stores your code's "semantic meaning" (vectors) in a local database, allowing the AI to "read" your entire project.

---

## 🔄 Data Flows

### A. The "Smart" Chat Flow (RAG)
When you ask a question like *"How do I fix the login bug?"*:
1.  **IDE**: Sends the question to the Backend.
2.  **Backend (Embed)**: Converts your question into a math vector (embedding).
3.  **Backend (Search)**: Searches **LanceDB** for code snippets that are mathematically similar to your question.
4.  **Backend (Prompt)**: Combines your question + the found code snippets into one giant prompt.
5.  **Backend (AI)**: Sends this context-rich prompt to Gemini.
6.  **Backend (Response)**: Streams the refined answer back to your IDE.

### B. The Semantic Indexing Flow
When you open a project or save a file:
1.  **IDE**: Identifies new or changed code blocks.
2.  **IDE**: Sends these chunks to the Backend.
3.  **Backend**: Generates embeddings for every chunk.
4.  **Backend**: Saves the code + the vector into **LanceDB**.
5.  **Result**: Your project is now "Semantically Indexed," making it searchable by meaning rather than just keywords.

---

## 🛡️ Security & Performance Benefits

| Feature | Old Architecture | New Professional Architecture (Current) |
| :--- | :--- | :--- |
| **API Keys** | Stored in IDE Settings (Insecure) | Stored in Server `.env` (Secure) |
| **Context** | Limited to open file | Entire project context via LanceDB |
| **Speed** | Slow local processing | High-performance backend indexing |
| **Privacy** | Direct data leakage to API | Server acts as a proxy/filter for data |

---

## 🛠️ Infrastructure Stack
*   **Runtime**: Node.js (TypeScript)
*   **Web Framework**: Express.js
*   **Vector Database**: LanceDB (Native Rust core)
*   **AI Model**: Google Gemini 1.5 Flash
*   **Embeddings**: Google text-embedding-004
