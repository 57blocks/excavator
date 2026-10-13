// The page's search service interface, and its main-thread implementation
// (used when no Worker is available, and by views given data without one).
import { QueryEngine, type Query, type QueryResult } from '../model/engine';

/** Answers search queries; `onProgress` reports a long first build (the identifier term index). */
export interface QueryService {
  run(query: Query, onProgress?: (done: number, total: number) => void): Promise<QueryResult>;
}

/** The query engine on the main thread, yielding once so a caller can render its "building" state first. */
export function mainThreadQueries(segments: Record<string, unknown>): QueryService {
  let engine: QueryEngine | null = null;
  return {
    run(query, onProgress) {
      return new Promise((resolve, reject) => {
        setTimeout(() => {
          try {
            engine ??= new QueryEngine(segments);
            resolve(engine.run(query, onProgress));
          } catch (error) {
            reject(error);
          }
        }, 0);
      });
    },
  };
}
