/**
 * TTS Audio Cache — file-based LRU cache for any TTS backend.
 *
 * Caches generated audio on disk keyed by SHA256 hash of TTS parameters.
 * Supports TTL expiration, max file count, and max total size eviction.
 * Works with ElevenLabs, Qwen3, or any future TTS provider.
 */

import { createHash } from "crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync, unlinkSync, statSync } from "fs";
import { join } from "path";
import { homedir } from "os";

interface CacheEntry {
  path: string;
  created_at: number;
  last_accessed: number;
  size_bytes: number;
  text_preview: string;
  engine: string;
  voice_id: string;
  pinned?: boolean;
}

interface CacheIndex {
  [key: string]: CacheEntry;
}

interface CacheConfig {
  enabled: boolean;
  cacheDir: string;
  ttlSeconds: number;
  maxFiles: number;
  maxSizeMB: number;
}

interface CacheStats {
  enabled: boolean;
  entries: number;
  hits: number;
  misses: number;
  hit_rate: string;
  total_size_mb: number;
}

const DEFAULT_CONFIG: CacheConfig = {
  enabled: true,
  cacheDir: join(homedir(), ".claude", "cache", "tts"),
  ttlSeconds: 86400, // 24 hours
  maxFiles: 500,
  maxSizeMB: 500,
};

export class TTSCache {
  private config: CacheConfig;
  private index: CacheIndex = {};
  private stats = { hits: 0, misses: 0 };
  private indexFile: string;

  constructor(config?: Partial<CacheConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.indexFile = join(this.config.cacheDir, "cache-index.json");

    if (this.config.enabled) {
      mkdirSync(this.config.cacheDir, { recursive: true });
      this.loadIndex();
    }
  }

  // ── Cache key ──────────────────────────────────────────────

  static makeKey(text: string, engine: string, voiceId: string, extra: string = ""): string {
    const raw = `${text}|${engine}|${voiceId}|${extra}`;
    return createHash("sha256").update(raw).digest("hex");
  }

  // ── Public API ─────────────────────────────────────────────

  /**
   * Look up cached audio. Returns the audio Buffer or null on miss.
   */
  get(text: string, engine: string, voiceId: string, extra: string = ""): Buffer | null {
    if (!this.config.enabled) return null;

    const key = TTSCache.makeKey(text, engine, voiceId, extra);
    const entry = this.index[key];

    if (!entry) {
      this.stats.misses++;
      return null;
    }

    // Check file exists
    if (!existsSync(entry.path)) {
      console.warn(`[cache] STALE: file missing ${entry.path}`);
      delete this.index[key];
      this.saveIndex();
      this.stats.misses++;
      return null;
    }

    // Check TTL (pinned entries never expire)
    if (!entry.pinned) {
      const age = (Date.now() / 1000) - entry.created_at;
      if (age > this.config.ttlSeconds) {
        console.log(`[cache] EXPIRED: ${key.slice(0, 12)}... age=${age.toFixed(0)}s > ttl=${this.config.ttlSeconds}s`);
        this.evictEntry(key);
        this.stats.misses++;
        return null;
      }
    }

    // Cache hit — update LRU timestamp
    entry.last_accessed = Date.now() / 1000;
    this.saveIndex();

    try {
      const audio = readFileSync(entry.path);
      this.stats.hits++;
      const total = this.stats.hits + this.stats.misses;
      console.log(
        `[cache] HIT: ${key.slice(0, 12)}... text='${text.slice(0, 40)}' ` +
        `(${this.stats.hits}/${total} = ${((this.stats.hits / total) * 100).toFixed(1)}% hit rate)`
      );
      return audio;
    } catch (e) {
      console.error(`[cache] READ ERROR:`, e);
      this.evictEntry(key);
      this.stats.misses++;
      return null;
    }
  }

  /**
   * Store audio in cache. Returns the file path or null on error.
   */
  put(
    text: string,
    engine: string,
    voiceId: string,
    audio: Buffer,
    ext: string = "mp3",
    extra: string = "",
  ): string | null {
    if (!this.config.enabled) return null;

    const key = TTSCache.makeKey(text, engine, voiceId, extra);
    const filePath = join(this.config.cacheDir, `${key}.${ext}`);

    try {
      writeFileSync(filePath, audio);
      const size = statSync(filePath).size;

      this.index[key] = {
        path: filePath,
        created_at: Date.now() / 1000,
        last_accessed: Date.now() / 1000,
        size_bytes: size,
        text_preview: text.slice(0, 80),
        engine,
        voice_id: voiceId,
      };
      this.saveIndex();

      console.log(`[cache] STORE: ${key.slice(0, 12)}... text='${text.slice(0, 40)}' size=${(size / 1024).toFixed(1)}KB`);

      this.enforceLimits();
      return filePath;
    } catch (e) {
      console.error(`[cache] WRITE ERROR:`, e);
      return null;
    }
  }

  /**
   * Pin a cache entry so it never expires or gets evicted.
   * Finds by text_preview substring match if exact key lookup fails.
   */
  pin(text: string, engine?: string, voiceId?: string, extra?: string): boolean {
    if (engine && voiceId) {
      const key = TTSCache.makeKey(text, engine, voiceId, extra || "");
      if (this.index[key]) {
        this.index[key].pinned = true;
        this.saveIndex();
        console.log(`[cache] PINNED: ${key.slice(0, 12)}... text='${text.slice(0, 40)}'`);
        return true;
      }
    }

    // Fallback: find by text_preview match
    for (const [key, entry] of Object.entries(this.index)) {
      if (entry.text_preview.includes(text) || text.includes(entry.text_preview)) {
        entry.pinned = true;
        this.saveIndex();
        console.log(`[cache] PINNED (by text match): ${key.slice(0, 12)}... text='${entry.text_preview.slice(0, 40)}'`);
        return true;
      }
    }

    console.warn(`[cache] PIN FAILED: no entry matching '${text.slice(0, 40)}'`);
    return false;
  }

  /**
   * Unpin a cache entry, allowing normal TTL and eviction rules.
   */
  unpin(text: string): boolean {
    for (const [key, entry] of Object.entries(this.index)) {
      if (entry.text_preview.includes(text) || text.includes(entry.text_preview)) {
        delete entry.pinned;
        this.saveIndex();
        console.log(`[cache] UNPINNED: ${key.slice(0, 12)}... text='${entry.text_preview.slice(0, 40)}'`);
        return true;
      }
    }
    return false;
  }

  /**
   * List all pinned entries.
   */
  listPinned(): { key: string; text_preview: string; size_bytes: number }[] {
    return Object.entries(this.index)
      .filter(([, entry]) => entry.pinned)
      .map(([key, entry]) => ({
        key: key.slice(0, 12),
        text_preview: entry.text_preview,
        size_bytes: entry.size_bytes,
      }));
  }

  getStats(): CacheStats {
    const total = this.stats.hits + this.stats.misses;
    return {
      enabled: this.config.enabled,
      entries: Object.keys(this.index).length,
      hits: this.stats.hits,
      misses: this.stats.misses,
      hit_rate: total > 0 ? `${((this.stats.hits / total) * 100).toFixed(1)}%` : "N/A",
      total_size_mb: this.totalSizeBytes() / (1024 * 1024),
    };
  }

  clear(): number {
    const keys = Object.keys(this.index).filter(k => !this.index[k].pinned);
    for (const key of keys) {
      this.evictEntry(key);
    }
    const pinned = Object.keys(this.index).length;
    console.log(`[cache] CLEARED: ${keys.length} entries removed (${pinned} pinned preserved)`);
    return keys.length;
  }

  // ── Index persistence ──────────────────────────────────────

  private loadIndex(): void {
    if (!existsSync(this.indexFile)) {
      this.index = {};
      return;
    }

    try {
      const content = readFileSync(this.indexFile, "utf-8");
      this.index = JSON.parse(content);

      // Prune stale entries
      const stale = Object.keys(this.index).filter(k => !existsSync(this.index[k].path));
      for (const k of stale) delete this.index[k];

      if (stale.length > 0) {
        this.saveIndex();
        console.log(`[cache] Index loaded: ${Object.keys(this.index).length} entries (${stale.length} stale pruned)`);
      } else {
        console.log(`[cache] Index loaded: ${Object.keys(this.index).length} entries`);
      }
    } catch (e) {
      console.error(`[cache] Failed to load index:`, e);
      this.index = {};
    }
  }

  private saveIndex(): void {
    try {
      writeFileSync(this.indexFile, JSON.stringify(this.index, null, 2));
    } catch (e) {
      console.error(`[cache] Failed to save index:`, e);
    }
  }

  // ── Eviction ───────────────────────────────────────────────

  private evictEntry(key: string): void {
    const entry = this.index[key];
    if (entry) {
      if (existsSync(entry.path)) {
        try { unlinkSync(entry.path); } catch {}
      }
      delete this.index[key];
      this.saveIndex();
    }
  }

  private totalSizeBytes(): number {
    return Object.values(this.index).reduce((sum, e) => sum + (e.size_bytes || 0), 0);
  }

  private entriesSortedLRU(): [string, CacheEntry][] {
    return Object.entries(this.index)
      .filter(([, entry]) => !entry.pinned)
      .sort((a, b) => (a[1].last_accessed || 0) - (b[1].last_accessed || 0));
  }

  private enforceLimits(): void {
    let evicted = 0;

    // Enforce max file count
    while (Object.keys(this.index).length > this.config.maxFiles) {
      const lru = this.entriesSortedLRU();
      if (!lru.length) break;
      this.evictEntry(lru[0][0]);
      evicted++;
    }

    // Enforce max total size
    const maxBytes = this.config.maxSizeMB * 1024 * 1024;
    while (this.totalSizeBytes() > maxBytes && Object.keys(this.index).length > 0) {
      const lru = this.entriesSortedLRU();
      if (!lru.length) break;
      this.evictEntry(lru[0][0]);
      evicted++;
    }

    if (evicted) {
      console.log(
        `[cache] EVICTION: removed ${evicted} entries ` +
        `(now ${Object.keys(this.index).length} files, ${(this.totalSizeBytes() / (1024 * 1024)).toFixed(1)}MB)`
      );
    }
  }
}
