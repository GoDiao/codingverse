import { DEFAULT_ENCODING } from "@codingverse/shared";

/**
 * Cross-cutting A — tokenizer.
 * Thin wrapper over gpt-tokenizer with lazy per-encoding loading.
 * Pure JS (no WASM), so no resource cleanup needed.
 */

export type TokenEncoding = "o200k_base" | "cl100k_base";

type CountFn = (text: string) => number;

const encoderCache = new Map<TokenEncoding, Promise<CountFn>>();

/** Dynamically import the per-encoding countTokens fn. */
const loadEncoder = (encoding: TokenEncoding): Promise<CountFn> => {
  let p = encoderCache.get(encoding);
  if (!p) {
    p = import(`gpt-tokenizer/encoding/${encoding}`).then(
      (mod: { countTokens: CountFn }) => mod.countTokens,
    );
    encoderCache.set(encoding, p);
  }
  return p;
};

/** A ready tokenizer bound to one encoding. */
export class Tokenizer {
  private countFn: CountFn | null = null;
  readonly encoding: TokenEncoding;

  constructor(encoding: TokenEncoding = DEFAULT_ENCODING as TokenEncoding) {
    this.encoding = encoding;
  }

  async init(): Promise<void> {
    if (!this.countFn) this.countFn = await loadEncoder(this.encoding);
  }

  /** Count tokens. Returns 0 on failure (never throws). */
  count(text: string): number {
    if (!this.countFn) {
      throw new Error("Tokenizer not initialized. Call init() first.");
    }
    if (text.length === 0) return 0;
    try {
      return this.countFn(text);
    } catch {
      return 0;
    }
  }
}
