-- Regulation corpus for RAG-with-citations. Each chunk is a verbatim (or
-- clearly-labelled curated) provision with a STABLE chunk_id so a brief can
-- cite it and the grounding validator can confirm the citation resolves to a
-- chunk that was actually retrieved for that investigation.
CREATE TABLE IF NOT EXISTS regulation_chunks (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  chunk_id VARCHAR(64) NOT NULL,
  doc VARCHAR(255) NOT NULL,
  section_ref VARCHAR(128) NOT NULL,
  title VARCHAR(255) NOT NULL,
  text TEXT NOT NULL,
  source_url VARCHAR(1024) NOT NULL,
  -- Precomputed term-frequency map for deterministic lexical retrieval
  -- (no embedding API dependency).
  term_freq JSON NOT NULL,
  UNIQUE KEY uq_regchunk (chunk_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
