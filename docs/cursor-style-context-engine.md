# Cursor-Style Context Engine — Architecture

A layered semantic code intelligence system built into the VS Code fork.

---

## Architecture Overview

```
Workspace Files
      │
      ▼
SemanticIndexer (AST + fallback chunking)
      │ ICodeChunk { id, symbolName, symbolType, ... }
      ▼
IEmbeddingProvider ─── TransformersEmbeddingProvider  (Xenova – DEFAULT ✓)
      │                 OllamaEmbeddingProvider        (local Ollama)
      │                 RemoteAPIEmbeddingProvider     (OpenAI-compat REST)
      │                 MockEmbeddingProvider          (unit tests only – NOT for production)
      ▼
VectorStore (SQLite – semantic_context_v2.vscdb)
      │ cosine similarity search
      ▼
DependencyGraph ◄─── ILanguageFeaturesService
      │ BFS symbol expansion
      ▼
ContextRetriever
      │  1. embed query
      │  2. top-K vector search
      │  3. dependency graph expand
      │  4. cursor-local context
      │  5. deduplication
      ▼
ContextRanker
      │  score = 0.60×semantic + 0.25×dependency + 0.10×recency + 0.05×importance
      │  → 6-12 chunks
      ▼
PromptAssembler   ◄─── CursorContextExtractor
      │  token-budget-aware (8000 tokens)
      │  [System] [Cursor] [Semantic] [Deps] [UserPrompt]
      ▼
ILayeredContext
      │  assembledPrompt, semanticMatches, dependencyContext, ...
      ▼
AI Completion / Chat / Edit


Background: IndexWatcher (file changes → incremental re-index, 500ms debounce)
Status Bar: $(sync~spin) Building  |  $(check) Ready  |  $(lightbulb~spin) Updating
```

---

## File Map

| File | Purpose |
|---|---|
| `common/semanticContext.ts` | Core interfaces: `ISemanticContextService`, `ILayeredContext`, `ICursorContext` |
| `common/semanticIndexer.ts` | AST + fallback chunking, `getSymbolAtPosition` |
| `common/embeddings.ts` | `IEmbeddingProvider` interface |
| `common/mockEmbeddings.ts` | **Test-only** deterministic mock (128-dim, no model needed) — **NOT registered in production** |
| `common/dependencyGraph.ts` | BFS symbol graph, `getRelatedSymbols(id, depth)` |
| `common/contextRetriever.ts` | 5-stage retrieval pipeline |
| `common/contextRanker.ts` | Composite scoring, 6-12 chunk limit |
| `common/cursorContext.ts` | Symbol hierarchy, imports, ±20 surrounding lines |
| `common/promptAssembler.ts` | Token-budget-aware 5-section prompt builder |
| `common/vectorStore.ts` | `IVectorStoreService` interface |
| `common/vectorStoreIpc.ts` | `VectorStoreChannel` for IPC |
| `common/nativeEmbeddingService.ts` | `INativeEmbeddingService` interface (IPC bridge to Shared Process) |
| `browser/vectorStoreService.ts` | `VectorStoreServiceClient` proxy |
| `node/vectorStoreService.ts` | SQLite implementation in Shared Process |
| `browser/embeddingProviders/transformersEmbeddingProvider.ts` | **DEFAULT** — Xenova proxy → Shared Process via `INativeEmbeddingService` |
| `browser/embeddingProviders/ollamaEmbeddingProvider.ts` | Ollama REST + LRU cache |
| `browser/embeddingProviders/remoteAPIEmbeddingProvider.ts` | OpenAI-compat REST + batch + LRU |
| `browser/indexWatcher.ts` | File change debouncer (500ms) |
| `browser/semanticContextService.ts` | Orchestrator — wires all layers |
| `browser/semanticContext.contribution.ts` | VS Code registration, status bar, commands |

---

## Commands

| Command | Description |
|---|---|
| `semantic.reindexWorkspace` | Full workspace re-index with progress notification |
| `semantic.search` | **Natural-language vector search** — prompts for a query, shows ranked results in Output panel |
| `semantic.debugContext` | Dump full layered context for current cursor to Output panel |

---

## Embedding Providers

### Default — Transformer.js (Xenova) — `TransformersEmbeddingProvider`

The default provider. Runs `Xenova/all-MiniLM-L6-v2` (or similar) via `@xenova/transformers` in the
Shared Process (Node.js), keeping the browser renderer free. Communication goes over IPC via
`INativeEmbeddingService`.

- **Dimension**: 768
- **Model**: configurable in the Shared Process / `nativeEmbeddingService`
- **Batching**: up to 32 texts per call, 10ms debounce window
- **LRU cache**: 512 slots

### Switch to Ollama (recommended for privacy)

1. Install: `ollama pull nomic-embed-text && ollama serve`
2. In `semanticContext.contribution.ts`, change:

```typescript
// Replace:
registerSingleton(IEmbeddingProvider, TransformersEmbeddingProvider, ...);
// With:
registerSingleton(IEmbeddingProvider, OllamaEmbeddingProvider, ...);
```

| Model | Dim | Notes |
|---|---|---|
| `nomic-embed-text` | 768 | Best quality, good speed |
| `mxbai-embed-large` | 1024 | Higher quality, slower |
| `all-minilm` | 384 | Fastest, lower quality |

### Switch to OpenAI / Remote API

```typescript
registerSingleton(IEmbeddingProvider, RemoteAPIEmbeddingProvider, ...);
// Then call configure() with your endpoint + API key
```

Works with any OpenAI-compatible endpoint (Azure OpenAI, LM Studio, etc.).

### Other Good Embedding Options

| Provider | Model | Dim | Why Choose It |
|---|---|---|---|
| **Xenova (default)** ✓ | `all-MiniLM-L6-v2` | 384–768 | Runs locally in-process, zero infra |
| **Ollama** | `nomic-embed-text` | 768 | Best local quality, easy to swap |
| **Ollama** | `mxbai-embed-large` | 1024 | Highest local quality |
| **OpenAI** | `text-embedding-3-small` | 1536 | Cloud, best semantic quality |
| **OpenAI** | `text-embedding-3-large` | 3072 | Maximum accuracy, expensive |
| **Cohere** | `embed-english-v3.0` | 1024 | Great multilingual support |
| **Jina AI** | `jina-embeddings-v2-base-code` | 768 | Code-optimized, open weights |

> **Tip**: For code-heavy workspaces, `jina-embeddings-v2-base-code` or `nomic-embed-text` generally
> outperform general-purpose models like `all-MiniLM-L6-v2`.

---

## Scoring Formula

```
finalScore =
  0.60 × semanticSimilarity    (cosine sim from vector search, 0-1)
  0.25 × dependencyProximity   (BFS distance from cursor, 0-1)
  0.10 × fileRecency           (normalised mtime, 0-1)
  0.05 × fileImportance        (normalised import fan-in, 0-1)
```

---

## Extending

### Add a new embedding provider
1. Implement `IEmbeddingProvider` in `browser/embeddingProviders/`
2. Register with `registerSingleton(IEmbeddingProvider, MyProvider, ...)`

### Add new graph edge types
1. Extend `EdgeKind` in `dependencyGraph.ts`
2. Add resolution logic in `resolveImportsForFile()` or a new `resolveXxx()` method
3. Call the resolver in `SemanticContextService.reindexFile()`

### Adjust ranking weights
Edit the `W_*` constants in `contextRanker.ts`:
```typescript
private readonly W_SEMANTIC   = 0.60;
private readonly W_DEPENDENCY = 0.25;
private readonly W_RECENCY    = 0.10;
private readonly W_IMPORTANCE = 0.05;
```
