// Stage ③ Index: SQLite store, embedding + binarize, reference resolution.
// Modules (v1): db.ts · store.ts · embed.ts · resolve.ts
// Dir named `indexdb` to avoid clashing with package entry `index.ts`.
export { IndexDb, type DbOptions } from "./db.js";
export { IndexStore, type StoreInput, type StoreStats } from "./store.js";
export { RefResolver, type ResolveStats } from "./resolve.js";
export { SearchEngine, type SearchParams, type SearchRow } from "./search.js";
export { CallGraph, type GraphResult } from "./graph.js";
export { PageRank, type RankOptions, type RankStats } from "./rank.js";
export { symbolId, chunkId, qualifiedName } from "./ids.js";
