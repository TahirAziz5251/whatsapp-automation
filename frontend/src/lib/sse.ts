"use client";

import { useEffect, useState, useRef } from "react";
import { DEFAULT_TENANT_ID, getApiBase } from "./api";

export function useClinicSSE(
  tenantId: string = DEFAULT_TENANT_ID,
  onEvent?: (event: string, data: any) => void
) {
  const [isConnected, setIsConnected] = useState<boolean>(false);
  const [lastEvent, setLastEvent] = useState<{ event: string; data: any; timestamp: number } | null>(null);
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    const apiBase = getApiBase();
    const sseUrl = `${apiBase}/clinic/events/stream?x_tenant_id=${tenantId}`;
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
      "BOOKING_CREATED",
      "HANDOFF_REQUESTED",
      "PATIENT_CHECKED_IN",
      "WALK_IN_ADDED",
      "PATIENT_CALLED",
      "CONSULTATION_STARTED",
      "CONSULTATION_COMPLETED",
      "DELAY_BROADCASTED",
      "QUEUE_UPDATED"
    ];

    events.forEach(eventName => {
      es.addEventListener(eventName, (e: MessageEvent) => handleEvent(eventName, e));
    });

    return () => {
      es.close();
    };
  }, [tenantId, onEvent]);

  return { isConnected, lastEvent };
}
