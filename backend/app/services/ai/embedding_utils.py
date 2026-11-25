"""
Lightweight deterministic vector(384) embedding utility for pgvector hybrid search.

Generates L2-normalized 384-dimensional embeddings combining word tokens,
character 3-grams (for Roman Urdu spelling tolerance), and bilingual
clinic/business semantic concept anchors without heavy ML runtime dependencies.
"""
import hashlib
import math
import re
from typing import Dict, List

EMBEDDING_DIMS = 384

_CONCEPT_SYNONYMS: Dict[str, List[str]] = {
    "concept_location": ["address", "location", "map", "directions", "gulberg", "lahore", "kahan", "jagah", "pata", "kidhar", "clinic"],
    "concept_timings": ["timing", "timings", "hours", "open", "schedule", "opd", "waqt", "khula", "kab", "baje"],
    "concept_fees": ["fee", "fees", "charges", "price", "cost", "pkr", "rs", "paise", "kharcha", "kitne"],
    "concept_cardiology": ["cardiologist", "cardiology", "heart", "chest", "tariq", "mahmood", "dil"],
    "concept_general": ["physician", "general", "medicine", "fever", "checkup", "ayesha", "malik", "bukhar"],
    "concept_pediatrics": ["pediatrics", "pediatrician", "child", "baby", "kids", "bilal", "asghar", "bachon", "bacha"],
    "concept_lab": ["lab", "laboratory", "test", "tests", "blood", "cbc", "ultrasound", "ecg", "xray", "diagnostic", "report"],
    "concept_emergency": ["emergency", "urgent", "1122", "pharmacy", "ambulance", "24/7", "accident", "critical"],
    "concept_booking": ["book", "appointment", "token", "queue", "cancel", "reschedule", "ticket", "slot", "waits"],
}


def _add_feature(vec: List[float], feature: str, weight: float) -> None:
    digest = hashlib.sha256(feature.encode("utf-8")).digest()
    for offset in range(0, 8, 4):
        raw_idx = int.from_bytes(digest[offset:offset + 2], "big")
        sign = 1.0 if (digest[offset + 2] & 1) == 0 else -1.0
        vec[raw_idx % len(vec)] += sign * weight


def compute_text_embedding(text: str, dims: int = EMBEDDING_DIMS) -> List[float]:
    """Computes an L2-normalized dense vector representation for PostgreSQL pgvector."""
    vec = [0.0] * dims
    cleaned = re.sub(r"[^a-z0-9\u0600-\u06ff\s]", " ", (text or "").lower()).strip()
    tokens = [t for t in cleaned.split() if len(t) >= 2]

    if not tokens:
        vec[0] = 1.0
        return vec

    for i, tok in enumerate(tokens):
        _add_feature(vec, f"w:{tok}", 2.0)
        if i + 1 < len(tokens):
            _add_feature(vec, f"bg:{tok}_{tokens[i + 1]}", 1.5)
        if len(tok) >= 3:
            padded = f"^{tok}$"
            for j in range(len(padded) - 2):
                _add_feature(vec, f"c3:{padded[j:j + 3]}", 0.45)

        for concept_key, aliases in _CONCEPT_SYNONYMS.items():
            if tok in aliases:
                _add_feature(vec, f"sem:{concept_key}", 3.0)

    norm = math.sqrt(sum(v * v for v in vec))
    if norm <= 0.0:
        vec[0] = 1.0
        return vec
    return [round(v / norm, 6) for v in vec]


def format_pgvector_literal(vec: List[float]) -> str:
    """Formats a float list into pgvector textual input '[0.1,-0.2,...]'."""
    return "[" + ",".join(f"{v:.6f}" for v in vec) + "]"


ALPHA_CLINIC_KB_SEED = [
    {
        "doc_title": "OPD Clinic Timings & Specialty Directory",
        "doc_type": "POLICY",
        "business_code": "HOSP_HEALTH",
        "chunks": [
            (
                "Doctor OPD Clinic Days, Rooms & Hours",
                "Alpha Clinic OPD doctors and exact timings: "
                "Dr. Tariq Mahmood (Cardiology, MBBS FCPS, Room 101) — Monday to Friday 10:00 AM to 02:00 PM (Fee PKR 2,500). "
                "Dr. Ayesha Malik (General Medicine, MBBS MRCP, Room 102) — Monday, Wednesday, Friday 04:00 PM to 08:00 PM (Fee PKR 1,800). "
                "Dr. Bilal Asghar (Pediatrics, MBBS FCPS, Room 103) — Monday 06:00 PM to 09:00 PM (Fee PKR 2,000)."
            ),
            (
                "Alpha Clinic Address & Operating Hours",
                "Alpha Clinic & Diagnostic Centre is located at Plot 45-B, Main Boulevard, Gulberg III, Lahore (near Kalma Chowk). "
                "OPD clinic operates Monday to Saturday 09:00 AM - 09:00 PM. Reception Phone: 042-35889900."
            ),
        ],
    },
    {
        "doc_title": "Consultation Fees & Emergency Policy",
        "doc_type": "POLICY",
        "business_code": "HOSP_HEALTH",
        "chunks": [
            (
                "Consultation Fees, Diagnostics Lab & Emergency Wing",
                "Consultation fees at Alpha Clinic: General Physician (Dr. Ayesha Malik) PKR 1,800; Pediatrics (Dr. Bilal Asghar) PKR 2,000; "
                "Cardiology (Dr. Tariq Mahmood) PKR 2,500. In-house Diagnostic Lab (CBC, Blood Sugar, Lipid Profile, LFT) and Ultrasound "
                "operate 08:00 AM to 08:00 PM. Emergency Care & Pharmacy are open 24/7. Call Rescue 1122 for critical emergencies."
            ),
            (
                "WhatsApp Booking, Queue Token & Digital Ticket Policy",
                "Patients receive an instant Digital Ticket link and queue token (e.g. T-01) upon WhatsApp booking. "
                "Appointments can be rescheduled or cancelled anytime using the self-service Digital Ticket link or via WhatsApp chat. "
                "Reception front desk checks patients in on arrival for real-time queue updates."
            ),
        ],
    },
]


def sync_knowledge_base_embeddings(conn: object) -> Dict[str, int]:
    """
    Ensures Alpha Clinic (HOSP_HEALTH) knowledge_documents/knowledge_chunks reflect
    accurate doctor fees/timings and backfills vector(384) embeddings for all chunks.
    """
    from sqlalchemy import text

    seeded_chunks = 0
    for doc_spec in ALPHA_CLINIC_KB_SEED:
        existing_doc = conn.execute(
            text(
                "SELECT id FROM knowledge_documents "
                "WHERE business_code = :bcode AND title = :title LIMIT 1"
            ),
            {"bcode": doc_spec["business_code"], "title": doc_spec["doc_title"]},
        ).fetchone()

        if existing_doc:
            doc_id = existing_doc[0]
            conn.execute(
                text(
                    "UPDATE knowledge_documents SET status = 'ACTIVE', updated_at = NOW() WHERE id = :doc_id"
                ),
                {"doc_id": doc_id},
            )
            conn.execute(
                text("DELETE FROM knowledge_chunks WHERE document_id = :doc_id"),
                {"doc_id": doc_id},
            )
        else:
            inserted_doc = conn.execute(
                text(
                    "INSERT INTO knowledge_documents "
                    "(business_code, namespace, source, title, doc_type, version, status, content, metadata) "
                    "VALUES (:bcode, 'default', 'alpha_clinic_seed', :title, :dtype, '2.0', 'ACTIVE', :content, CAST('{}' AS jsonb)) "
                    "RETURNING id"
                ),
                {
                    "bcode": doc_spec["business_code"],
                    "title": doc_spec["doc_title"],
                    "dtype": doc_spec["doc_type"],
                    "content": "\n\n".join(txt for _, txt in doc_spec["chunks"]),
                },
            ).fetchone()
            doc_id = inserted_doc[0]

        for idx, (chunk_title, chunk_text) in enumerate(doc_spec["chunks"]):
            emb_literal = format_pgvector_literal(compute_text_embedding(f"{chunk_title} {chunk_text}"))
            conn.execute(
                text(
                    "INSERT INTO knowledge_chunks "
                    "(document_id, business_code, chunk_index, chunk_title, chunk_text, token_count, embedding, metadata) "
                    "VALUES (:doc_id, :bcode, :cidx, :ctitle, :ctext, :tok, CAST(:emb AS vector), CAST('{}' AS jsonb))"
                ),
                {
                    "doc_id": doc_id,
                    "bcode": doc_spec["business_code"],
                    "cidx": idx,
                    "ctitle": chunk_title,
                    "ctext": chunk_text,
                    "tok": len(chunk_text.split()),
                    "emb": emb_literal,
                },
            )
            seeded_chunks += 1

    # Backfill vector(384) embeddings for any remaining chunks across all verticals
    missing_rows = conn.execute(
        text(
            "SELECT id, COALESCE(chunk_title, ''), chunk_text FROM knowledge_chunks WHERE embedding IS NULL"
        )
    ).fetchall()
    backfilled = 0
    for row_id, c_title, c_text in missing_rows:
        emb_literal = format_pgvector_literal(compute_text_embedding(f"{c_title} {c_text}"))
        conn.execute(
            text("UPDATE knowledge_chunks SET embedding = CAST(:emb AS vector) WHERE id = :rid"),
            {"emb": emb_literal, "rid": row_id},
        )
        backfilled += 1

    return {"seeded_chunks": seeded_chunks, "backfilled_embeddings": backfilled}
