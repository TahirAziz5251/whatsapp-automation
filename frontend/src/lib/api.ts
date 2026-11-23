const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000/api/v1";
export const DEFAULT_TENANT_ID = process.env.NEXT_PUBLIC_TENANT_ID || "11111111-1111-1111-1111-111111111111";

export async function fetchFromApi<T = any>(
  endpoint: string,
  options: RequestInit = {},
  tenantId: string = DEFAULT_TENANT_ID
): Promise<T> {
  const headers = new Headers(options.headers || {});
  headers.set("Content-Type", "application/json");
  headers.set("X-Tenant-ID", tenantId);

  const res = await fetch(`${API_BASE}${endpoint}`, {
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

  broadcastDelay: (doctorId: string, delayMinutes: number, reason?: string, tenantId: string = DEFAULT_TENANT_ID) =>
    fetchFromApi("/clinic/queue/delay-broadcast", { method: "POST", body: JSON.stringify({ doctor_id: doctorId, delay_minutes: delayMinutes, reason }) }, tenantId),

  getLiveQueue: (tenantId: string = DEFAULT_TENANT_ID) =>
    fetchFromApi("/clinic/queue/live", { method: "GET" }, tenantId),

  getPatientTicket: (identifier: string, tenantId: string = DEFAULT_TENANT_ID) =>
    fetchFromApi(`/clinic/patient/ticket/${identifier}`, { method: "GET" }, tenantId),
};

// CRM Endpoints
export const crmApi = {
  getConversations: (params: { status?: string; ai_paused?: boolean; search?: string } = {}, tenantId: string = DEFAULT_TENANT_ID) => {
    const query = new URLSearchParams();
    if (params.status) query.set("status", params.status);
    if (params.ai_paused !== undefined) query.set("ai_paused", String(params.ai_paused));
    if (params.search) query.set("search", params.search);
    return fetchFromApi<any[]>(`/crm/conversations?${query.toString()}`, { method: "GET" }, tenantId);
  },

  getConversation: (id: string, tenantId: string = DEFAULT_TENANT_ID) =>
    fetchFromApi(`/crm/conversations/${id}`, { method: "GET" }, tenantId),

  pauseAi: (id: string, staffUserId?: string, tenantId: string = DEFAULT_TENANT_ID) =>
    fetchFromApi(`/crm/conversations/${id}/pause-ai${staffUserId ? `?staff_user_id=${staffUserId}` : ""}`, { method: "POST" }, tenantId),

  resumeAi: (id: string, staffUserId?: string, tenantId: string = DEFAULT_TENANT_ID) =>
    fetchFromApi(`/crm/conversations/${id}/resume-ai${staffUserId ? `?staff_user_id=${staffUserId}` : ""}`, { method: "POST" }, tenantId),

  sendMessage: (id: string, message: string, staffUserId?: string, tenantId: string = DEFAULT_TENANT_ID) =>
    fetchFromApi(`/crm/conversations/${id}/messages`, {
      method: "POST",
      body: JSON.stringify({ message, staff_user_id: staffUserId }),
    }, tenantId),

  getAuditEvents: (tenantId: string = DEFAULT_TENANT_ID) =>
    fetchFromApi<any[]>("/crm/audit-events", { method: "GET" }, tenantId),
};

// Billing & Owner Metering Endpoints
export const billingApi = {
  getSubscription: (tenantId: string = DEFAULT_TENANT_ID) =>
    fetchFromApi<any>("/billing/subscription", { method: "GET" }, tenantId),

  getUsage: (tenantId: string = DEFAULT_TENANT_ID) =>
    fetchFromApi<any>("/billing/usage", { method: "GET" }, tenantId),

  getPlans: () =>
    fetchFromApi<any[]>("/billing/plans", { method: "GET" }),

  subscribe: (planId: string, tenantId: string = DEFAULT_TENANT_ID) =>
    fetchFromApi("/billing/subscribe", { method: "POST", body: JSON.stringify({ plan_id: planId }) }, tenantId),
};
