/**
 * Phase 23: Document Ingestion Pipeline & Embedding Generation
 * 
 * Pipeline Flow:
 * Document -> Validation -> Text Extraction -> Cleaning -> Chunking -> Metadata -> Embedding -> pgvector
 * 
 * Capabilities:
 * - Business-scoped document & chunk creation
 * - Multi-format support (Markdown, JSON, Plain Text)
 * - Semantic text cleaning and boundary-aware chunking
 * - Deterministic 384-dimensional normalized vector embedding generation
 * - Atomic transactional storage in PostgreSQL platform_db
 * - Idempotent re-ingestion, versioning, soft & hard deletion
 * - Strict multi-tenant isolation (zero namespace mixing)
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

const VALID_BUSINESS_CODES = ['POS_RETAIL', 'BISE_EDU', 'HOSP_HEALTH'];
const VALID_DOC_TYPES = ['FAQ', 'POLICY', 'SPECIFICATION', 'GUIDELINE', 'SOP', 'DIRECTORY', 'MANUAL'];
const DEFAULT_CHUNK_SIZE = 500; // characters
const DEFAULT_CHUNK_OVERLAP = 80; // characters
const EMBEDDING_DIM = 384;

/**
 * Execute psql command safely via stdin
 */
function runPsql(sql, db = 'platform_db') {
  return execSync(
    `docker exec -i evolution-postgres psql -U postgres -d ${db} -v ON_ERROR_STOP=1 -t`,
    { input: sql, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] }
  ).trim();
}

/**
 * Escape single quotes for SQL literals
 */
function sqlEscape(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/'/g, "''");
}

/**
 * Stage 1: Document Validation
 */
function validateDocument(doc) {
  const errors = [];

  if (!doc.business_code || !VALID_BUSINESS_CODES.includes(doc.business_code)) {
    errors.push(`VAL_INVALID_BUSINESS_CODE: Expected one of [${VALID_BUSINESS_CODES.join(', ')}], got '${doc.business_code}'`);
  }

  if (!doc.title || typeof doc.title !== 'string' || doc.title.trim().length === 0) {
    errors.push('VAL_INVALID_TITLE: Title must be a non-empty string');
  } else if (doc.title.length > 255) {
    errors.push('VAL_TITLE_TOO_LONG: Title exceeds 255 characters');
  }

  if (doc.doc_type && !VALID_DOC_TYPES.includes(doc.doc_type)) {
    errors.push(`VAL_INVALID_DOC_TYPE: Expected one of [${VALID_DOC_TYPES.join(', ')}], got '${doc.doc_type}'`);
  }

  if (!doc.content || typeof doc.content !== 'string' || doc.content.trim().length < 20) {
    errors.push('VAL_INSUFFICIENT_CONTENT: Document content must contain at least 20 characters');
  }

  return {
    isValid: errors.length === 0,
    errors
  };
}

/**
 * Stage 2 & 3: Text Extraction and Cleaning
 */
function cleanText(rawText) {
  if (!rawText || typeof rawText !== 'string') return '';

  return rawText
    // Normalize newlines
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    // Remove null bytes and non-printable control characters (except newline, tab)
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    // Replace multiple horizontal spaces with a single space
    .replace(/[ \t]+/g, ' ')
    // Replace 3 or more consecutive newlines with 2 newlines (preserve paragraphs)
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Stage 4: Boundary-Aware Semantic Chunking
 */
function chunkDocument(text, title, options = {}) {
  const chunkSize = options.chunkSize || DEFAULT_CHUNK_SIZE;
  const chunkOverlap = options.chunkOverlap || DEFAULT_CHUNK_OVERLAP;

  // Split on markdown headings or double newlines (paragraphs)
  const sections = text.split(/(?=^#{1,4}\s+|\n\n+)/m);
  const chunks = [];
  let currentChunk = '';
  let currentHeader = title;

  for (const section of sections) {
    const trimmed = section.trim();
    if (!trimmed) continue;

    // Check if section starts with a markdown header
    const headerMatch = trimmed.match(/^#{1,4}\s+(.+)$/m);
    if (headerMatch) {
      currentHeader = headerMatch[1].trim();
    }

    if (currentChunk.length + trimmed.length <= chunkSize) {
      currentChunk = currentChunk ? `${currentChunk}\n\n${trimmed}` : trimmed;
    } else {
      if (currentChunk.length > 0) {
        chunks.push({
          title: currentHeader,
          text: currentChunk
        });
        // Carry over overlap if possible
        const words = currentChunk.split(/\s+/);
        const overlapWords = words.slice(-Math.floor(chunkOverlap / 6)).join(' ');
        currentChunk = overlapWords ? `${overlapWords}\n\n${trimmed}` : trimmed;
      } else {
        // Single section exceeds chunk size; split by sentences or hard limit
        let start = 0;
        while (start < trimmed.length) {
          let end = Math.min(start + chunkSize, trimmed.length);
          if (end < trimmed.length) {
            const nextSpace = trimmed.lastIndexOf(' ', end);
            if (nextSpace > start + chunkOverlap) end = nextSpace;
          }
          chunks.push({
            title: currentHeader,
            text: trimmed.slice(start, end).trim()
          });
          start = end - chunkOverlap;
          if (start >= trimmed.length - chunkOverlap) break;
        }
        currentChunk = '';
      }
    }
  }

  if (currentChunk.trim().length > 0) {
    chunks.push({
      title: currentHeader,
      text: currentChunk.trim()
    });
  }

  // Final cleanup and token count estimation (~1 token ≈ 4 characters or ~0.75 words)
  return chunks.map((c, index) => {
    const wordCount = c.text.split(/\s+/).filter(Boolean).length;
    const estTokens = Math.max(1, Math.round(wordCount * 1.3));
    return {
      chunk_index: index,
      chunk_title: c.title || `${title} - Section ${index + 1}`,
      chunk_text: c.text,
      token_count: estTokens
    };
  });
}

/**
 * Stage 5: Deterministic 384-Dimensional Unit Embedding Generation
 * Produces unit-normalized dense vectors for pgvector (<=> cosine distance)
 */
function generateEmbedding(text, dim = EMBEDDING_DIM) {
  const vec = new Float64Array(dim);
  if (!text || text.trim().length === 0) {
    vec[0] = 1.0;
    return `[${Array.from(vec).join(',')}]`;
  }

  const normalized = text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ');
  const words = normalized.split(/\s+/).filter(w => w.length > 1);

  // 1. Unigram feature hashing
  for (let i = 0; i < words.length; i++) {
    const word = words[i];
    const hash = crypto.createHash('md5').update(word).digest();
    const index = hash.readUInt16BE(0) % dim;
    const sign = (hash.readUInt8(2) % 2 === 0) ? 1.0 : -1.0;
    const weight = 1.0 / Math.sqrt(i + 1);
    vec[index] += sign * weight;

    // 2. Character 3-grams
    if (word.length >= 3) {
      for (let j = 0; j <= word.length - 3; j++) {
        const trigram = word.substring(j, j + 3);
        const triHash = crypto.createHash('sha256').update(trigram).digest();
        const triIdx = triHash.readUInt16BE(0) % dim;
        const triSign = (triHash.readUInt8(2) % 2 === 0) ? 0.5 : -0.5;
        vec[triIdx] += triSign * 0.3;
      }
    }

    // 3. Word bigrams
    if (i < words.length - 1) {
      const bigram = `${word}_${words[i + 1]}`;
      const biHash = crypto.createHash('sha256').update(bigram).digest();
      const biIdx = biHash.readUInt16BE(0) % dim;
      const biSign = (biHash.readUInt8(2) % 2 === 0) ? 0.8 : -0.8;
      vec[biIdx] += biSign * 0.6;
    }
  }

  // Compute L2 Norm
  let sumSq = 0;
  for (let i = 0; i < dim; i++) {
    sumSq += vec[i] * vec[i];
  }
  const norm = Math.sqrt(sumSq) || 1.0;

  // L2 Normalize
  const unitVec = [];
  for (let i = 0; i < dim; i++) {
    unitVec.push((vec[i] / norm).toFixed(6));
  }

  return `[${unitVec.join(',')}]`;
}

/**
 * Stage 6 & 7: Parse Local Document File (Markdown or JSON)
 */
function parseDocumentFile(filePath, defaultMeta = {}) {
  const ext = path.extname(filePath).toLowerCase();
  const raw = fs.readFileSync(filePath, 'utf8');
  const baseName = path.basename(filePath, ext);

  let doc = {
    source: path.basename(filePath),
    doc_type: 'POLICY',
    version: 'v1.0',
    status: 'ACTIVE',
    ...defaultMeta
  };

  if (ext === '.json') {
    const parsed = JSON.parse(raw);
    doc = {
      ...doc,
      ...parsed
    };
  } else if (ext === '.md' || ext === '.txt') {
    // Extract title from first markdown header if present
    const headerMatch = raw.match(/^#\s+(.+)$/m);
    doc.title = defaultMeta.title || (headerMatch ? headerMatch[1].trim() : baseName.replace(/_/g, ' '));
    doc.content = raw;
  } else {
    throw new Error(`Unsupported file extension '${ext}'. Supported: .json, .md, .txt`);
  }

  // Infer business_code if directory has vertical name
  if (!doc.business_code) {
    const dirLower = path.dirname(filePath).toLowerCase();
    if (dirLower.includes('pos')) doc.business_code = 'POS_RETAIL';
    else if (dirLower.includes('bise')) doc.business_code = 'BISE_EDU';
    else if (dirLower.includes('hosp')) doc.business_code = 'HOSP_HEALTH';
  }

  if (!doc.namespace) {
    if (doc.business_code === 'POS_RETAIL') doc.namespace = 'pos_collection';
    else if (doc.business_code === 'BISE_EDU') doc.namespace = 'bise_collection';
    else if (doc.business_code === 'HOSP_HEALTH') doc.namespace = 'hosp_collection';
    else doc.namespace = 'default';
  }

  return doc;
}

/**
 * Stage 8: Ingest Document into PostgreSQL
 */
function ingestDocument(docInput, options = {}) {
  // 1. Validation
  const validation = validateDocument(docInput);
  if (!validation.isValid) {
    throw new Error(`Document Validation Failed:\n- ${validation.errors.join('\n- ')}`);
  }

  // 2. Text Cleaning
  const cleanedContent = cleanText(docInput.content);

  // 3. Chunking
  const chunks = chunkDocument(cleanedContent, docInput.title, options);
  if (chunks.length === 0) {
    throw new Error('Chunking produced zero chunks from cleaned content');
  }

  // 4. Generate Embeddings for Chunks
  for (const chunk of chunks) {
    chunk.embedding = generateEmbedding(`${chunk.chunk_title} ${chunk.chunk_text}`);
  }

  // 5. Database Transaction (Atomic Upsert)
  const metaJson = JSON.stringify({
    ingested_at: new Date().toISOString(),
    source_file: docInput.source,
    chunk_count: chunks.length,
    char_length: cleanedContent.length,
    ...(docInput.metadata || {})
  });

  const upsertDocSql = `
    INSERT INTO knowledge_documents (
      business_code, namespace, source, title, doc_type, version, status, content, metadata, updated_at
    ) VALUES (
      '${sqlEscape(docInput.business_code)}',
      '${sqlEscape(docInput.namespace)}',
      '${sqlEscape(docInput.source)}',
      '${sqlEscape(docInput.title)}',
      '${sqlEscape(docInput.doc_type || 'FAQ')}',
      '${sqlEscape(docInput.version || 'v1.0')}',
      '${sqlEscape(docInput.status || 'ACTIVE')}',
      '${sqlEscape(cleanedContent)}',
      '${sqlEscape(metaJson)}'::jsonb,
      CURRENT_TIMESTAMP
    )
    ON CONFLICT (business_code, title, version) 
    DO UPDATE SET
      content = EXCLUDED.content,
      status = EXCLUDED.status,
      metadata = EXCLUDED.metadata,
      updated_at = CURRENT_TIMESTAMP
    RETURNING id;
  `;

  // Run initial upsert to get committed document_id
  const docIdStr = runPsql(upsertDocSql);
  const docIdMatch = docIdStr.match(/(\d+)/);
  if (!docIdMatch) {
    throw new Error(`Failed to acquire document_id. Output: ${docIdStr}`);
  }
  const documentId = parseInt(docIdMatch[1], 10);

  // Replace chunks cleanly for this document in an atomic transaction
  const chunkStatements = chunks.map(chunk => {
    const chunkMeta = JSON.stringify({
      token_count: chunk.token_count,
      ingested_at: new Date().toISOString()
    });
    return `
      INSERT INTO knowledge_chunks (
        document_id, business_code, chunk_index, chunk_title, chunk_text, token_count, embedding, metadata
      ) VALUES (
        ${documentId},
        '${sqlEscape(docInput.business_code)}',
        ${chunk.chunk_index},
        '${sqlEscape(chunk.chunk_title)}',
        '${sqlEscape(chunk.chunk_text)}',
        ${chunk.token_count},
        '${chunk.embedding}'::vector,
        '${sqlEscape(chunkMeta)}'::jsonb
      );
    `;
  }).join('\n');

  const commitSql = `
    BEGIN;
    DELETE FROM knowledge_chunks WHERE document_id = ${documentId};
    ${chunkStatements}
    COMMIT;
  `;

  runPsql(commitSql);

  return {
    success: true,
    documentId,
    businessCode: docInput.business_code,
    title: docInput.title,
    version: docInput.version || 'v1.0',
    chunksCount: chunks.length
  };
}

/**
 * Soft Delete / Archive Document
 */
function softDeleteDocument(documentId, status = 'ARCHIVED') {
  const sql = `
    UPDATE knowledge_documents 
    SET status = '${sqlEscape(status)}', updated_at = CURRENT_TIMESTAMP
    WHERE id = ${parseInt(documentId, 10)}
    RETURNING id, business_code, title, status;
  `;
  return runPsql(sql);
}

/**
 * Hard Delete Document & Cascaded Chunks
 */
function hardDeleteDocument(documentId) {
  const sql = `
    DELETE FROM knowledge_documents 
    WHERE id = ${parseInt(documentId, 10)}
    RETURNING id, business_code, title;
  `;
  return runPsql(sql);
}

// Module exports for programmatic usage
module.exports = {
  VALID_BUSINESS_CODES,
  VALID_DOC_TYPES,
  validateDocument,
  cleanText,
  chunkDocument,
  generateEmbedding,
  parseDocumentFile,
  ingestDocument,
  softDeleteDocument,
  hardDeleteDocument,
  runPsql
};

// CLI Execution Support
if (require.main === module) {
  const args = process.argv.slice(2);
  const command = args[0];

  if (command === 'ingest') {
    const filePath = args[1];
    if (!filePath) {
      console.error('Usage: node scripts/ingest_documents.js ingest <filePath>');
      process.exit(1);
    }
    const doc = parseDocumentFile(filePath);
    const res = ingestDocument(doc);
    console.log(`PASS: Ingested document ID ${res.documentId} (${res.businessCode}) with ${res.chunksCount} chunks.`);
  } else if (command === 'ingest-all') {
    const dir = args[1] || 'data/sample_documents';
    console.log(`Ingesting all documents from ${dir}...`);
    let total = 0;
    function walk(d) {
      for (const item of fs.readdirSync(d)) {
        const full = path.join(d, item);
        if (fs.statSync(full).isDirectory()) walk(full);
        else if (['.json', '.md', '.txt'].includes(path.extname(full).toLowerCase())) {
          const doc = parseDocumentFile(full);
          const res = ingestDocument(doc);
          console.log(`   [INGESTED] [${res.businessCode}] ${res.title} (ID: ${res.documentId}, Chunks: ${res.chunksCount})`);
          total++;
        }
      }
    }
    walk(dir);
    console.log(`SUCCESS: Total ${total} documents ingested cleanly.`);
  } else if (command === 'delete') {
    const docId = args[1];
    const isHard = args.includes('--hard');
    if (isHard) {
      const res = hardDeleteDocument(docId);
      console.log(`HARD DELETED: ${res}`);
    } else {
      const res = softDeleteDocument(docId);
      console.log(`SOFT DELETED (ARCHIVED): ${res}`);
    }
  } else {
    console.log('Available Commands:');
    console.log('  node scripts/ingest_documents.js ingest <file>');
    console.log('  node scripts/ingest_documents.js ingest-all <dir>');
    console.log('  node scripts/ingest_documents.js delete <docId> [--hard]');
  }
}
