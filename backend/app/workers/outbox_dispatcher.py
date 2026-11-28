import asyncio
import logging
from datetime import datetime, timedelta, timezone
from typing import Dict, Any
from sqlalchemy.orm import Session
from sqlalchemy import text

from app.core.database import SessionLocal
from app.models.tenant import PlatformTenant
from app.models.communication import TenantOutboxMessage
from app.services.channel_service import ChannelService
from app.workers.reminder_worker import run_full_reminder_cycle

logger = logging.getLogger(__name__)


def dispatch_pending_outbox_batch(db: Session, batch_size: int = 20) -> Dict[str, Any]:
    """
    Safely iterates across active tenants, locks due PENDING/FAILED outbox rows
    using SKIP LOCKED under tenant RLS context, and dispatches them via ChannelService.
    """
    tenants = db.query(PlatformTenant).filter(PlatformTenant.status.in_(["ACTIVE", "TRIAL"])).all()
    dispatched = 0
    failed = 0
    now = datetime.now(timezone.utc)

    for tenant in tenants:
        try:
            db.execute(text(f"SET app.current_tenant_id = '{tenant.id}'"))
            due_rows = (
                db.query(TenantOutboxMessage)
                .filter(
                    TenantOutboxMessage.tenant_id == tenant.id,
                    TenantOutboxMessage.status.in_(["PENDING", "FAILED"]),
                    TenantOutboxMessage.retry_count < TenantOutboxMessage.max_retries,
                    TenantOutboxMessage.next_retry_at <= now,
                )
                .order_by(TenantOutboxMessage.created_at.asc())
                .limit(batch_size)
                .with_for_update(skip_locked=True)
                .all()
            )

            for row in due_rows:
                row.status = "PROCESSING"
                db.flush()
                res = ChannelService.dispatch_outbox_message(row.id, db)
                if res.get("success"):
                    dispatched += 1
                else:
                    # Backoff next retry by 60s * retry_count
                    row.next_retry_at = datetime.now(timezone.utc) + timedelta(seconds=60 * max(1, row.retry_count))
                    db.commit()
                    failed += 1
        except Exception as e:
            logger.warning(f"Outbox batch error for tenant {tenant.id}: {e}")
            db.rollback()

    return {"dispatched": dispatched, "failed": failed}


async def run_outbox_and_reminder_loop(poll_seconds: int = 15, reminder_every_cycles: int = 4):
    """
    Background asyncio loop started during FastAPI lifespan so transactional outbox
    messages (reminders, call-next, delay alerts, ticket self-service updates) deliver reliably.
    """
    logger.info("Starting background outbox dispatcher & reminder loop...")
    cycle = 0
    # Wait briefly after startup so DB bootstrap completes cleanly
    await asyncio.sleep(5)

    while True:
        try:
            db = SessionLocal()
            try:
                stats = await asyncio.to_thread(dispatch_pending_outbox_batch, db)
                if stats["dispatched"] or stats["failed"]:
                    logger.info(f"Outbox cycle: dispatched={stats['dispatched']}, failed={stats['failed']}")

                if cycle % reminder_every_cycles == 0:
                    await asyncio.to_thread(run_full_reminder_cycle, db, None)
            finally:
                db.close()
        except asyncio.CancelledError:
            logger.info("Outbox dispatcher loop cancelled cleanly.")
            break
        except Exception as e:
            logger.error(f"Unexpected error in outbox dispatcher loop: {e}", exc_info=True)

        cycle += 1
        await asyncio.sleep(poll_seconds)
