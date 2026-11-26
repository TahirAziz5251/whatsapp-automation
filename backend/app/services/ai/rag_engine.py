"""
Agentic RAG Hybrid Retrieval Engine (pgvector + Okapi BM25 + RRF + Validity Guards + Strict Threshold).

Used for clinic FAQs, preparation instructions, parking, payments, and general policies
while keeping operational data (doctors, open slots, bookings, queue) in typed PostgreSQL tools.
"""
import math
import re
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

from sqlalchemy import text

from app.services.ai.embedding_utils import (
    compute_text_embedding,
    format_pgvector_literal,
    normalize_rag_query,
)

RRF_K = 60
MIN_VEC_SIMILARITY = 0.25
MIN_BM25_SCORE = 1.00
MIN_CONFIDENCE = 0.30
MIN_GROUP_COVERAGE = 0.25


def _tokenize_lexical(value: str) -> List[str]:
    return [t for t in re.findall(r"[a-z0-9\u0600-\u06ff]+", (value or "").lower()) if len(t) >= 2]


def _parse_iso_dt(raw: Optional[str]) -> Optional[datetime]:
    if not raw:
        return None
    try:
        dt = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
        return dt if dt.tzinfo is not None else dt.replace(tzinfo=timezone.utc)
    except Exception:
        return None


def _is_metadata_valid(meta: Any, tenant_id: str, now_utc: datetime) -> bool:
    """Enforces published flag, tenant isolation override, and valid_from/valid_to date window."""
    if not isinstance(meta, dict):
        return True
    if meta.get("published") is False:
        return False
    scoped_tid = meta.get("tenant_id")
    if scoped_tid and str(scoped_tid) != str(tenant_id):
        return False
    valid_from = _parse_iso_dt(meta.get("valid_from"))
    if valid_from and now_utc < valid_from:
        return False
    valid_to = _parse_iso_dt(meta.get("valid_to"))
    if valid_to and now_utc > valid_to:
        return False
    return True


def _compute_bm25_scores(
    query_terms: List[str],
    docs_tokens: List[List[str]],
    title_tokens: List[List[str]],
    k1: float = 1.5,
    b: float = 0.75,
) -> List[float]:
    """Computes Okapi BM25 scores over candidate KB chunks (titles weighted 2.0x)."""
    n_docs = len(docs_tokens)
    if n_docs == 0 or not query_terms:
        return [0.0] * n_docs

    combined_docs = [t_toks + t_toks + c_toks for t_toks, c_toks in zip(title_tokens, docs_tokens)]
    avg_dl = sum(len(d) for d in combined_docs) / max(1, n_docs)

    unique_q = list(dict.fromkeys(query_terms))
    df: Dict[str, int] = {}
    for term in unique_q:
        df[term] = sum(1 for doc in combined_docs if term in doc)

    scores: List[float] = []
    for doc in combined_docs:
        dl = len(doc)
        if dl == 0:
            scores.append(0.0)
            continue
        tf_map: Dict[str, int] = {}
        for tok in doc:
            tf_map[tok] = tf_map.get(tok, 0) + 1

        doc_score = 0.0
        for term in unique_q:
            tf = tf_map.get(term, 0)
            if tf == 0:
                continue
            idf = math.log((n_docs - df[term] + 0.5) / (df[term] + 0.5) + 1.0)
            # Floor IDF cleanly on small candidate sets so strong single-chunk hits still score > 0
            idf = max(idf, 0.35)
            denom = tf + k1 * (1.0 - b + b * (dl / max(1.0, avg_dl)))
            doc_score += idf * ((tf * (k1 + 1.0)) / max(denom, 1e-6))
        scores.append(doc_score)
    return scores


def hybrid_search(
    db: Any,
    tenant_id: str,
    business_code: str,
    template_id: str,
    query: str,
    top_k: int = 3,
    now_utc: Optional[datetime] = None,
) -> Dict[str, Any]:
    """
    Executes the 5-step Agentic RAG pipeline:
    1. Query normalization (Roman Urdu/Urdu/English synonyms)
    2. Metadata/validity-guarded candidate fetch + pgvector similarity + PostgreSQL FTS / BM25
    3. Reciprocal Rank Fusion (RRF, k=60)
    4. Exact title/phrase reranking
    5. Strict relevance threshold returning NO_EVIDENCE instead of fabricating answers
    """
    now_ts = now_utc or datetime.now(timezone.utc)
    norm = normalize_rag_query(query)
    if not norm["normalized_text"]:
        return {
            "status": "NO_EVIDENCE",
            "topic": "Empty Query",
            "source": "agentic_rag_threshold_cutoff",
            "evidence": [],
            "handoff_recommended": True,
            "information": "Please ask a clinic question so I can check our verified knowledge base.",
        }

    qvec_literal = format_pgvector_literal(compute_text_embedding(norm["normalized_text"]))
    fts_query_text = " OR ".join(norm["expanded_tokens"][:12]) or norm["cleaned"]

    raw_rows = db.execute(
        text(
            "SELECT kc.id, kd.title, COALESCE(kc.chunk_title, ''), kc.chunk_text, kd.metadata, "
            "COALESCE(1.0 - (kc.embedding <=> CAST(:qvec AS vector)), 0.0) AS vec_score, "
            "COALESCE(ts_rank_cd(to_tsvector('english', COALESCE(kc.chunk_title, '') || ' ' || kc.chunk_text), "
            "websearch_to_tsquery('english', :ftsq)), 0.0) AS fts_score "
            "FROM knowledge_chunks kc "
            "JOIN knowledge_documents kd ON kd.id = kc.document_id "
            "WHERE kd.status = 'ACTIVE' "
            "AND kc.business_code IN (:bcode, :tpl_id) "
            "ORDER BY (kc.embedding <=> CAST(:qvec AS vector)) ASC NULLS LAST, kc.id ASC "
            "LIMIT 30"
        ),
        {
            "qvec": qvec_literal,
            "ftsq": fts_query_text,
            "bcode": business_code,
            "tpl_id": template_id,
        },
    ).fetchall()

    # Step 4 (belt-and-suspenders): enforce metadata published, tenant override, and valid_from/valid_to window
    valid_rows = [r for r in raw_rows if _is_metadata_valid(r[4] if len(r) > 4 else {}, tenant_id, now_ts)]
    if not valid_rows:
        return {
            "status": "NO_EVIDENCE",
            "topic": "Not Covered in Verified Knowledge Base",
            "source": "agentic_rag_threshold_cutoff",
            "evidence": [],
            "handoff_recommended": True,
            "information": "I do not have verified information on that question right now. Would you like me to connect you with clinic reception?",
        }

    # Step 2b: Okapi BM25 lexical scoring across valid chunks
    docs_tokens = [_tokenize_lexical(r[3]) for r in valid_rows]
    title_tokens = [_tokenize_lexical(f"{r[1]} {r[2]}") for r in valid_rows]
    bm25_raw = _compute_bm25_scores(norm["expanded_tokens"], docs_tokens, title_tokens)

    candidates: List[Dict[str, Any]] = []
    concept_groups = norm.get("concept_groups") or []
    for idx, row in enumerate(valid_rows):
        vec_sim = float(row[5] or 0.0)
        fts_val = float(row[6] or 0.0)
        bm25_val = float(bm25_raw[idx]) + (fts_val * 2.0)

        doc_vocab = set(_tokenize_lexical(f"{row[1]} {row[2]} {row[3]}"))
        matched_groups = sum(1 for grp in concept_groups if any(term in doc_vocab for term in grp))
        group_cov = (matched_groups / len(concept_groups)) if concept_groups else 0.0

        candidates.append({
            "chunk_id": row[0],
            "doc_title": row[1],
            "chunk_title": row[2],
            "chunk_text": row[3],
            "vec_sim": vec_sim,
            "bm25": bm25_val,
            "group_coverage": group_cov,
        })

    # Step 3: Reciprocal Rank Fusion (RRF)
    vec_ranked = sorted([c for c in candidates if c["vec_sim"] > 0.12], key=lambda x: x["vec_sim"], reverse=True)
    bm25_ranked = sorted([c for c in candidates if c["bm25"] > 0.0], key=lambda x: x["bm25"], reverse=True)

    vec_rank_map = {c["chunk_id"]: r for r, c in enumerate(vec_ranked, start=1)}
    bm25_rank_map = {c["chunk_id"]: r for r, c in enumerate(bm25_ranked, start=1)}

    for c in candidates:
        cid = c["chunk_id"]
        rrf = 0.0
        if cid in vec_rank_map:
            rrf += 1.0 / (RRF_K + vec_rank_map[cid])
        if cid in bm25_rank_map:
            rrf += 1.0 / (RRF_K + bm25_rank_map[cid])

        # Reranker: blend RRF with semantic similarity, BM25, and distinctive concept coverage
        title_l = f"{c['doc_title']} {c['chunk_title']}".lower()
        title_hits = sum(1 for tok in norm["expanded_tokens"] if tok in title_l)
        title_boost = min(0.18, 0.06 * title_hits)
        bm25_norm = min(1.0, c["bm25"] / 4.0)
        confidence = min(
            1.0,
            (rrf * 16.0) + (0.40 * c["vec_sim"]) + (0.25 * bm25_norm) + (0.20 * c["group_coverage"]) + title_boost,
        )

        c["rrf_score"] = round(rrf, 6)
        c["confidence"] = round(confidence, 4)

    reranked = sorted(candidates, key=lambda x: (x["confidence"], x["rrf_score"], x["vec_sim"]), reverse=True)

    # Step 5: Strict Relevance Threshold Cutoff (rejects unrelated queries containing only stopwords/brand names)
    qualified = [
        c
        for c in reranked
        if c["group_coverage"] >= MIN_GROUP_COVERAGE
        and (c["vec_sim"] >= MIN_VEC_SIMILARITY or c["bm25"] >= MIN_BM25_SCORE)
        and c["confidence"] >= MIN_CONFIDENCE
    ]

    if not qualified:
        return {
            "status": "NO_EVIDENCE",
            "topic": "Not Covered in Verified Knowledge Base",
            "source": "agentic_rag_threshold_cutoff",
            "normalized_query": norm["normalized_text"],
            "best_confidence": reranked[0]["confidence"] if reranked else 0.0,
            "evidence": [],
            "handoff_recommended": True,
            "information": "I do not have verified information on that service or policy in our clinic knowledge base. Would you like me to connect you with clinic reception?",
        }

    top_hits = qualified[:max(1, top_k)]
    top_topic = f"{top_hits[0]['doc_title']} — {top_hits[0]['chunk_title']}" if top_hits[0]["chunk_title"] else top_hits[0]["doc_title"]
    return {
        "status": "FOUND",
        "topic": top_topic,
        "source": "agentic_rag_hybrid",
        "normalized_query": norm["normalized_text"],
        "confidence": top_hits[0]["confidence"],
        "similarity": round(top_hits[0]["vec_sim"], 4),
        "bm25": round(top_hits[0]["bm25"], 4),
        "rrf_score": top_hits[0]["rrf_score"],
        "evidence": [
            {
                "title": h["chunk_title"] or h["doc_title"],
                "text": h["chunk_text"],
                "confidence": h["confidence"],
                "vec_sim": round(h["vec_sim"], 4),
                "bm25": round(h["bm25"], 4),
            }
            for h in top_hits
        ],
        "information": " | ".join(h["chunk_text"] for h in top_hits),
    }
