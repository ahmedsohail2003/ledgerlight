/** Loads the regulation corpus (GCR clauses + curated thresholds) into
 *  regulation_chunks with a precomputed term-frequency map for retrieval. */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPool, closePool } from '../db/pool.js';
import { termFreq } from './text.js';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const FILES = ['data/corpus/regulation-clauses.json', 'data/corpus/thresholds.json'];

interface RawChunk {
  chunk_id: string; doc: string; section_ref: string; title: string; text: string; source_url: string;
}

async function main(): Promise<void> {
  const pool = getPool();
  let loaded = 0;
  for (const rel of FILES) {
    const chunks: RawChunk[] = JSON.parse(await readFile(path.join(REPO_ROOT, rel), 'utf8'));
    for (const c of chunks) {
      await pool.query(
        `INSERT INTO regulation_chunks (chunk_id, doc, section_ref, title, text, source_url, term_freq)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE text = VALUES(text), term_freq = VALUES(term_freq), title = VALUES(title)`,
        [c.chunk_id, c.doc, c.section_ref, c.title, c.text, c.source_url, JSON.stringify(termFreq(`${c.title} ${c.text}`))],
      );
      loaded += 1;
    }
  }
  await pool.query(
    `INSERT INTO audit_log (actor, action, entity, entity_id, detail) VALUES ('rag:load-corpus', 'load', 'regulation_chunks', 'all', ?)`,
    [JSON.stringify({ loaded })],
  );
  console.log(`loaded ${loaded} regulation chunks`);
  await closePool();
}

main().catch((err) => { console.error(err); process.exit(1); });
