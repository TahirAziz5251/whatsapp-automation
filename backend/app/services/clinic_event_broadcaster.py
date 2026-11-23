import asyncio
import json
import logging
from typing import Dict, Set, AsyncGenerator, Any

logger = logging.getLogger(__name__)

class ClinicEventBroadcaster:
    """
    In-memory real-time event broadcaster for clinic queue synchronization.
    Supports Server-Sent Events (SSE) and WebSockets with sub-50ms latency.
    """
    def __init__(self):
        # tenant_id -> set of asyncio.Queue
        self._subscribers: Dict[str, Set[asyncio.Queue]] = {}

    def subscribe(self, tenant_id: str) -> asyncio.Queue:
        """Subscribes a listener queue for a specific tenant."""
        q = asyncio.Queue()
        if tenant_id not in self._subscribers:
            self._subscribers[tenant_id] = set()
        self._subscribers[tenant_id].add(q)
        logger.info(f"New subscriber connected for tenant {tenant_id}. Total: {len(self._subscribers[tenant_id])}")
        return q

    def unsubscribe(self, tenant_id: str, q: asyncio.Queue):
        """Removes a subscriber queue."""
        if tenant_id in self._subscribers:
            self._subscribers[tenant_id].discard(q)
            if not self._subscribers[tenant_id]:
                del self._subscribers[tenant_id]

    async def broadcast(self, tenant_id: str, event_type: str, data: Dict[str, Any]):
        """Broadcasts an event to all connected listeners for a tenant."""
        if tenant_id not in self._subscribers:
            return

        message = {
            "event": event_type,
            "data": data
        }

        dead_queues = set()
        for q in self._subscribers[tenant_id]:
            try:
                q.put_nowait(message)
            except asyncio.QueueFull:
                dead_queues.add(q)
            except Exception:
                dead_queues.add(q)

        for q in dead_queues:
            self.unsubscribe(tenant_id, q)

    async def event_generator(self, tenant_id: str) -> AsyncGenerator[str, None]:
        """Async generator yielding Server-Sent Events formatted strings."""
        q = self.subscribe(tenant_id)
        try:
            # Send initial ping event
            yield f"event: CONNECTED\ndata: {json.dumps({'status': 'CONNECTED', 'tenant_id': tenant_id})}\n\n"
            while True:
                msg = await q.get()
                event_name = msg.get("event", "message")
                payload = json.dumps(msg.get("data", {}))
                yield f"event: {event_name}\ndata: {payload}\n\n"
        except asyncio.CancelledError:
            pass
        finally:
            self.unsubscribe(tenant_id, q)

broadcaster = ClinicEventBroadcaster()
