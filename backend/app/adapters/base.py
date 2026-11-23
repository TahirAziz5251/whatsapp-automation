from abc import ABC, abstractmethod
from typing import Optional, Dict, Any
from dataclasses import dataclass

@dataclass
class NormalizedInboundMessage:
    provider: str
    instance_name: str
    provider_message_id: str
    customer_phone: str
    push_name: str
    message_type: str
    text: str
    media_url: Optional[str] = None
    raw_payload: Optional[Dict[str, Any]] = None

class BaseChannelAdapter(ABC):
    @abstractmethod
    def normalize_inbound(self, payload: Dict[str, Any]) -> Optional[NormalizedInboundMessage]:
        """Normalize vendor-specific webhook payload into standard NormalizedInboundMessage."""
        pass

    @abstractmethod
    def send_text_message(self, recipient_phone: str, text: str, **kwargs) -> Dict[str, Any]:
        """Dispatch text message to recipient via provider API."""
        pass

    @abstractmethod
    def get_connection_status(self) -> Dict[str, Any]:
        """Check provider connection status."""
        pass
