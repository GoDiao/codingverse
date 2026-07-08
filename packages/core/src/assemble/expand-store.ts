import { randomBytes } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { STATE_DIR, type ExpandEntry } from "@codingverse/shared";

/**
 * Persistent sidecar for the skeleton expand map.
 *
 * `cv pack` writes the last pack's expandMap here so that a later `cv expand
 * <id>` — a separate process with no in-memory state — can resolve skeleton
 * ids back to source spans without re-packing.
 *
 * Same atomic tmp+rename pattern as ParseCache / TokenCache.
 */

const STORE_VERSION = 1;
const FILE_NAME = "expand-map.json";

interface StoreData {
  version: number;
  /** Pack metadata for debugging / display in `cv expand --list`. */
  pack: {
    budget: number;
    strategy: string;
    timestamp: number;
    fileCount: number;
    tokenCount: number;
  };
  entries: Record<string, ExpandEntry>;
}

export interface ExpandMapMeta {
  budget: number;
  strategy: string;
  timestamp: number;
  fileCount: number;
  tokenCount: number;
  expandableCount: number;
}

export interface ExpandMapSnapshot {
  entries: Record<string, ExpandEntry>;
  meta: ExpandMapMeta;
}

export class ExpandMapStore {
  private readonly filePath: string;

  constructor(repoRoot: string) {
    this.filePath = path.join(repoRoot, STATE_DIR, FILE_NAME);
  }

  /** Persist the expand map + pack metadata. Atomic tmp+rename. */
  async save(
    entries: Record<string, ExpandEntry>,
    meta: Omit<ExpandMapMeta, "expandableCount">,
  ): Promise<void> {
    try {
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
      const data: StoreData = {
        version: STORE_VERSION,
        pack: {
          budget: meta.budget,
          strategy: meta.strategy,
          timestamp: meta.timestamp,
          fileCount: meta.fileCount,
          tokenCount: meta.tokenCount,
        },
        entries,
      };
      const tmp = `${this.filePath}.${process.pid}.${randomBytes(4).toString("hex")}.tmp`;
      await fs.writeFile(tmp, JSON.stringify(data), { mode: 0o600 });
      await fs.rename(tmp, this.filePath);
    } catch {
      // expand map is a convenience, not correctness — degrade silently
    }
  }

  /** Load the persisted expand map + metadata. Missing/corrupt → null. */
  async load(): Promise<ExpandMapSnapshot | null> {
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      const data = JSON.parse(raw) as StoreData;
      if (data?.version !== STORE_VERSION || !data.entries || !data.pack) return null;
      return {
        entries: data.entries,
        meta: {
          ...data.pack,
          expandableCount: Object.keys(data.entries).length,
        },
      };
    } catch {
      return null;
    }
  }
}
