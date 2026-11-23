"use client";

import { useEffect, useState, useRef } from "react";
import { DEFAULT_TENANT_ID } from "./api";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api/v1";

export function useClinicSSE(
  tenantId: string = DEFAULT_TENANT_ID,
  onEvent?: (event: string, data: any) => void
) {
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [lastEvent, setLastEvent] = useState<{ event: string; data: any; timestamp: number } | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    const sseUrl = `${API_BASE}/clinic/events/stream?x_tenant_id=${tenantId}`;
    const es = new EventSource(sseUrl);
    eventSourceRef.current = es;

    es.onopen = () => {
      setIsConnected(true);
    };

    es.onerror = () => {
      setIsConnected(false);
    };

    const handleEvent = (event: string, e: MessageEvent) => {
      try {
        const parsed = JSON.parse(e.data);
        const item = { event, data: parsed, timestamp: Date.now() };
        setLastEvent(item);
        if (onEvent) {
          onEvent(event, parsed);
        }
      } catch (err) {
        console.error("SSE JSON parse error:", err);
      }
    };

    const events = [
      "CONNECTED",
      "PATIENT_CHECKED_IN",
      "WALK_IN_ADDED",
      "PATIENT_CALLED",
      "CONSULTATION_STARTED",
      "CONSULTATION_COMPLETED",
      "DELAY_BROADCASTED",
      "QUEUE_UPDATED"
    ];

    events.forEach(evName => {
      es.addEventListener(evName, (e) => handleEvent(evName, e as MessageEvent));
    });

    return () => {
      es.close();
      setIsConnected(false);
    };
  }, [tenantId, onEvent]);

  return { isConnected, lastEvent };
}
