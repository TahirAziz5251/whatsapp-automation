// Dynamic API resolution for Client and Server environments
export function getApiBase(): string {
  if (typeof window !== "undefined") {
    const protocol = window.location.protocol;
    const hostname = window.location.hostname;
    const envUrl = process.env.NEXT_PUBLIC_API_URL;
    // If explicit non-localhost URL is provided, use it
    if (envUrl && !envUrl.includes("localhost") && !envUrl.includes("127.0.0.1") && envUrl.includes("://")) {
      return envUrl;
    }
    // Automatically match the current browser host on port 8001
    return `${protocol}//${hostname}:8001/api/v1`;
  }
  return process.env.NEXT_PUBLIC_API_URL || "http://127.0.0.1:8001/api/v1";
}

export const DEFAULT_TENANT_ID = process.env.NEXT_PUBLIC_TENANT_ID || "11111111-1111-1111-1111-111111111111";

export async function fetchFromApi<T = any>(
  endpoint: string,
  options: RequestInit = {},
  tenantId: string = DEFAULT_TENANT_ID
): Promise<T> {
  const apiBase = getApiBase();
  const headers = new Headers(options.headers || {});
  headers.set("Content-Type", "application/json");
  headers.set("X-Tenant-ID", tenantId);

  const res = await fetch(`${apiBase}${endpoint}`, {
    ...options,
    headers,
  });

  if (!res.ok) {
    const errorText = await res.text();
    throw new Error(`API Error (${res.status}): ${errorText}`);
  }

  return res.json();
}

// Clinic Endpoints
export const clinicApi = {
  getDoctors: (tenantId: string = DEFAULT_TENANT_ID) =>
    fetchFromApi<any[]>("/clinic/doctors", { method: "GET" }, tenantId),

  getAppointments: (tenantId: string = DEFAULT_TENANT_ID) =>
    fetchFromApi<any[]>("/clinic/appointments", { method: "GET" }, tenantId),

  getLiveQueue: (tenantId: string = DEFAULT_TENANT_ID) =>
    fetchFromApi<any>("/clinic/queue/live", { method: "GET" }, tenantId),

  checkIn: (appointmentId: string, tenantId: string = DEFAULT_TENANT_ID) =>
    fetchFromApi(`/clinic/appointments/${appointmentId}/check-in`, { method: "POST" }, tenantId),

  walkIn: (data: { patient_name: string; patient_phone: string; doctor_id: string; symptoms?: string }, tenantId: string = DEFAULT_TENANT_ID) =>
    fetchFromApi("/clinic/walk-in", { method: "POST", body: JSON.stringify(data) }, tenantId),

  callNext: (doctorId: string, tenantId: string = DEFAULT_TENANT_ID) =>
    fetchFromApi("/clinic/doctor/call-next", { method: "POST", body: JSON.stringify({ doctor_id: doctorId }) }, tenantId),

  startConsultation: (appointmentId: string, tenantId: string = DEFAULT_TENANT_ID) =>
    fetchFromApi("/clinic/doctor/start-consultation", { method: "POST", body: JSON.stringify({ appointment_id: appointmentId }) }, tenantId),

  completeConsultation: (appointmentId: string, notes?: string, tenantId: string = DEFAULT_TENANT_ID) =>
    fetchFromApi("/clinic/doctor/complete-consultation", { method: "POST", body: JSON.stringify({ appointment_id: appointmentId, notes }) }, tenantId),

  assignFollowUpTask: (appointmentId: string, task: string, tenantId: string = DEFAULT_TENANT_ID) =>
    fetchFromApi("/clinic/doctor/follow-up-task", { method: "POST", body: JSON.stringify({ appointment_id: appointmentId, task }) }, tenantId),

  toggleDoctorBreak: (doctorId: string, onBreak: boolean, reason?: string, tenantId: string = DEFAULT_TENANT_ID) =>
    fetchFromApi("/clinic/doctor/toggle-break", { method: "POST", body: JSON.stringify({ doctor_id: doctorId, on_break: onBreak, reason }) }, tenantId),

  broadcastDelay: (doctorId: string, delayMinutes: number, reason?: string, tenantId: string = DEFAULT_TENANT_ID) =>
    fetchFromApi("/clinic/queue/delay-broadcast", { method: "POST", body: JSON.stringify({ doctor_id: doctorId, delay_minutes: delayMinutes, reason }) }, tenantId),

  getTicket: (ticketId: string, tenantId: string = DEFAULT_TENANT_ID) =>
    fetchFromApi(`/clinic/patient/ticket/${ticketId}`, { method: "GET" }, tenantId),

  getPatientTicket: (ticketId: string, tenantId: string = DEFAULT_TENANT_ID) =>
    fetchFromApi(`/clinic/patient/ticket/${ticketId}`, { method: "GET" }, tenantId),

  getOwnerAnalytics: (tenantId: string = DEFAULT_TENANT_ID) =>
    fetchFromApi("/clinic/owner/analytics", { method: "GET" }, tenantId),

  sendSimulatedWhatsApp: (data: {
    tenant_id: string;
    instance: string;
    phone: string;
    message: string;
    push_name?: string;
  }) => {
    const apiBase = getApiBase();
    return fetch(`${apiBase}/channels/whatsapp/evolution`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event: "messages.upsert",
        instance: data.instance,
        data: {
          key: {
            remoteJid: `${data.phone}@s.whatsapp.net`,
            fromMe: false,
            id: `SIM_${Date.now()}`
          },
          pushName: data.push_name || "Patient",
          message: {
            conversation: data.message
          },
          messageTimestamp: Math.floor(Date.now() / 1000)
        }
      })
    }).then(async r => {
      if (!r.ok) {
        const text = await r.text();
        throw new Error(text || "Failed to send simulated message");
      }
      return r.json();
    });
  }
};

// Billing & Metering Endpoints
export const billingApi = {
  getSubscription: (tenantId: string = DEFAULT_TENANT_ID) =>
    fetchFromApi<any>("/billing/subscription", { method: "GET" }, tenantId),

  getUsage: (tenantId: string = DEFAULT_TENANT_ID) =>
    fetchFromApi<any>("/billing/usage", { method: "GET" }, tenantId),

  getPlans: () =>
    fetchFromApi<any[]>("/billing/plans", { method: "GET" })
};

// CRM & Audit Endpoints
export const crmApi = {
  getAuditEvents: (tenantId: string = DEFAULT_TENANT_ID) =>
    fetchFromApi<any[]>("/crm/audit-events", { method: "GET" }, tenantId),

  getConversations: (tenantId: string = DEFAULT_TENANT_ID) =>
    fetchFromApi<any[]>("/crm/conversations", { method: "GET" }, tenantId)
};
