"""
Lightweight deterministic vector(384) embedding utility for pgvector hybrid search.

Generates L2-normalized 384-dimensional embeddings combining word tokens,
character 3-grams (for Roman Urdu spelling tolerance), and bilingual
clinic/business semantic concept anchors without heavy ML runtime dependencies.
"""
import hashlib
import math
import re
from typing import Any, Dict, List

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


_QUERY_STOPWORDS = {
    "a", "an", "the", "is", "are", "was", "were", "be", "been", "do", "does", "did",
    "can", "could", "will", "would", "should", "may", "might", "what", "which", "who",
    "when", "where", "why", "how", "this", "that", "these", "those", "there", "here",
    "you", "your", "we", "our", "they", "me", "my", "i", "it", "its",
    "in", "on", "at", "by", "for", "with", "from", "to", "of", "and", "or", "if",
    "have", "has", "had", "any", "all", "some", "please", "tell", "about", "get",
    "ka", "ki", "ke", "ko", "mein", "me", "se", "par", "pe", "tak", "hai", "hain",
    "ho", "tha", "thi", "kya", "liye", "leay", "aur", "ya", "ye", "wo", "hum", "aap",
    "kuch", "koi", "mil", "sakta", "sakti", "chahiye", "bataein", "batao", "kar", "karein",
    "alpha", "clinic", "hospital", "centre", "center", "medical",
}

_QUERY_SYNONYMS: Dict[str, str] = {
    "kahan": "address location gulberg map",
    "kidhar": "address location gulberg map",
    "jagah": "address location",
    "pata": "address location",
    "waqt": "timing hours schedule",
    "khula": "open timing hours",
    "kab": "timing schedule hours",
    "baje": "timing hours",
    "paise": "fee charges payment pkr",
    "kharcha": "fee charges pkr",
    "kitne": "fee charges",
    "khoon": "blood lab diagnostic cbc",
    "test": "lab diagnostic test report",
    "nahar": "fasting empty stomach prep",
    "roza": "fasting empty stomach prep",
    "bhuka": "fasting empty stomach",
    "mansookh": "cancel cancellation policy",
    "tabdeel": "reschedule change slot",
    "dawai": "pharmacy medicine",
    "gadi": "parking vehicle car",
    "parking": "parking vehicle car",
    "card": "card payment debit credit",
    "cash": "cash payment counter",
    "jazzcash": "jazzcash payment counter",
    "easypaisa": "easypaisa payment counter",
}


def normalize_rag_query(query: str) -> Dict[str, Any]:
    """
    Normalizes Roman Urdu, Urdu script, and English queries for hybrid RAG:
    - removes stopwords and generic brand boilerplate tokens
    - tracks distinctive concept groups for threshold coverage verification
    - expands Roman Urdu / clinic synonyms into canonical bilingual terms
    """
    raw = (query or "").strip()
    cleaned = re.sub(r"[^a-z0-9\u0600-\u06ff\s]", " ", raw.lower())
    all_tokens = [t for t in cleaned.split() if len(t) >= 2]
    substantive = [t for t in all_tokens if t not in _QUERY_STOPWORDS and not t.isdigit()]
    if not substantive:
        substantive = [t for t in all_tokens if t not in _QUERY_STOPWORDS]

    expanded: List[str] = []
    concept_groups: List[List[str]] = []
    seen = set()
    for tok in substantive:
        group = [tok]
        if tok not in seen:
            expanded.append(tok)
            seen.add(tok)
        syn = _QUERY_SYNONYMS.get(tok)
        if syn:
            for s_tok in syn.split():
                group.append(s_tok)
                if s_tok not in seen:
                    expanded.append(s_tok)
                    seen.add(s_tok)
        concept_groups.append(group)

    return {
        "raw": raw,
        "cleaned": " ".join(substantive) or " ".join(all_tokens),
        "normalized_text": " ".join(expanded),
        "tokens": substantive,
        "expanded_tokens": expanded,
        "concept_groups": concept_groups,
    }


ALPHA_CLINIC_KB_SEED = [
    {
        "doc_title": "OPD Clinic Timings & Specialty Directory",
        "doc_type": "POLICY",
        "business_code": "HOSP_HEALTH",
        "metadata": {"valid_from": "2026-01-01T00:00:00Z", "published": True},
        "chunks": [
            (
                "Doctor OPD Clinic Days, Rooms & Hours",
                "Alpha Clinic OPD doctors and exact timings: "
                "Dr. Tariq Mahmood (Cardiology, MBBS FCPS, Room 101) — Monday to Friday 10:00 AM to 02:00 PM (Fee PKR 2,500). "
                "Dr. Ayesha Malik (General Medicine, MBBS MRCP, Room 102) — Monday, Wednesday, Friday 04:00 PM to 08:00 PM (Fee PKR 1,800). "
                "Dr. Bilal Asghar (Pediatrics, MBBS FCPS, Room 103) — Monday 06:00 PM to 09:00 PM (Fee PKR 2,000)."
            ),
            (
                "Alpha Clinic Address, Map & Operating Hours",
                "Alpha Clinic & Diagnostic Centre is located at Plot 45-B, Main Boulevard, Gulberg III, Lahore (near Kalma Chowk). "
                "Google Maps Pin: https://www.google.com/maps?q=29.410876883940837,71.70442811315009 . "
                "OPD clinic operates Monday to Saturday 09:00 AM - 09:00 PM. Reception Desk Phone: 042-35780000."
            ),
            (
                "Patient Parking & Wheelchair Accessibility",
                "Free dedicated patient car and motorbike parking is available in front of Alpha Clinic Plot 45-B Gulberg III with security staff and step-free wheelchair access to Ground Floor Reception and OPD Rooms 101-103."
            ),
        ],
    },
    {
        "doc_title": "Consultation Fees, Payment & Emergency Policy",
        "doc_type": "POLICY",
        "business_code": "HOSP_HEALTH",
        "metadata": {"valid_from": "2026-01-01T00:00:00Z", "published": True},
        "chunks": [
            (
                "Consultation Fees & Counter Payment Methods",
                "Consultation fees at Alpha Clinic: General Physician (Dr. Ayesha Malik) PKR 1,800; Pediatrics (Dr. Bilal Asghar) PKR 2,000; "
                "Cardiology (Dr. Tariq Mahmood) PKR 2,500. Payment is collected at the clinic reception counter upon arrival — Cash, Debit/Credit Card, JazzCash, and EasyPaisa are accepted (no online prepayment required)."
            ),
            (
                "WhatsApp Booking, Arrival, Reschedule & Cancellation Policy",
                "Patients receive a Booking ID and Digital Ticket link upon confirmation. Please arrive 10-15 minutes before your appointment slot and check in at reception (or reply I have arrived). "
                "Rescheduling and cancellation are free with at least 2 hours advance notice via WhatsApp or the Digital Ticket link."
            ),
            (
                "24/7 Emergency Wing & In-House Pharmacy",
                "Alpha Clinic Emergency Stabilization Wing and In-House Pharmacy are open 24/7, including Sundays and public holidays. For life-threatening emergencies (chest pain, breathing distress, heavy bleeding, unconsciousness), call Rescue 1122 or visit the nearest hospital ER immediately."
            ),
        ],
    },
    {
        "doc_title": "Diagnostic Lab, Imaging & Preparation Instructions",
        "doc_type": "FAQ",
        "business_code": "HOSP_HEALTH",
        "metadata": {"valid_from": "2026-01-01T00:00:00Z", "published": True},
        "chunks": [
            (
                "In-House Lab Tests, Ultrasound & ECG Timings",
                "Alpha Clinic Diagnostic Lab offers CBC, Blood Sugar (Fasting/Random), HbA1c, Lipid Profile, Liver Function (LFT), Renal Function (RFT), ECG, and Ultrasound daily from 08:00 AM to 08:00 PM. Same-day digital reports are delivered at reception or via clinic desk."
            ),
            (
                "Fasting & Test Preparation Instructions",
                "Preparation instructions: Lipid Profile and Fasting Blood Sugar (FBS) require 8 to 12 hours overnight fasting (plain water is allowed). "
                "Abdominal ultrasound requires 6 hours fasting, while pelvic/kidney ultrasound requires a full bladder (drink 3-4 glasses of water 45 minutes before the scan)."
            ),
        ],
    },
]


def sync_knowledge_base_embeddings(conn: object) -> Dict[str, int]:
    """
    Ensures Alpha Clinic (HOSP_HEALTH) knowledge_documents/knowledge_chunks reflect
    accurate clinic FAQs & policies with validity metadata and backfills vector(384) embeddings.
    """
    import json
    from sqlalchemy import text

    seeded_chunks = 0
    for doc_spec in ALPHA_CLINIC_KB_SEED:
        meta_json = json.dumps(doc_spec.get("metadata") or {"valid_from": "2026-01-01T00:00:00Z", "published": True})
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
                    "UPDATE knowledge_documents SET status = 'ACTIVE', metadata = CAST(:meta AS jsonb), updated_at = NOW() WHERE id = :doc_id"
                ),
                {"doc_id": doc_id, "meta": meta_json},
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
                    "VALUES (:bcode, 'default', 'alpha_clinic_seed', :title, :dtype, '2.0', 'ACTIVE', :content, CAST(:meta AS jsonb)) "
                    "RETURNING id"
                ),
                {
                    "bcode": doc_spec["business_code"],
                    "title": doc_spec["doc_title"],
                    "dtype": doc_spec["doc_type"],
                    "content": "\n\n".join(txt for _, txt in doc_spec["chunks"]),
                    "meta": meta_json,
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
