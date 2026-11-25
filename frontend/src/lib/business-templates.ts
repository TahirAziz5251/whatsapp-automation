export interface BusinessTemplateMeta {
  id: string;
  subtitle: string;
  tokenLabel: string;
  providerLabel: string;
  locationLabel: string;
  feeLabel: string;
  steps: { key: string; label: string }[];
  completedTitle: string;
  servingLabel: string;
  servingAction: string;
  accentGradient: string;
}

const TEMPLATE_MAP: Record<string, BusinessTemplateMeta> = {
  CLINIC_OPD: {
    id: "CLINIC_OPD",
    subtitle: "Live OPD Queue & WhatsApp Pass",
    tokenLabel: "Your Token Number",
    providerLabel: "Consulting Doctor",
    locationLabel: "Room",
    feeLabel: "Consultation Fee",
    steps: [
      { key: "BOOKED", label: "Booked" },
      { key: "CHECKED_IN", label: "Checked In" },
      { key: "IN_CONSULTATION", label: "In Cabin" },
      { key: "COMPLETED", label: "Completed" },
    ],
    completedTitle: "Consultation Completed",
    servingLabel: "It's Your Turn!",
    servingAction: "Please proceed directly to",
    accentGradient: "from-emerald-500 via-teal-400 to-cyan-300",
  },
  DENTAL_CLINIC: {
    id: "DENTAL_CLINIC",
    subtitle: "Dental Appointment & Chair Tracker",
    tokenLabel: "Your Queue Token",
    providerLabel: "Dental Surgeon",
    locationLabel: "Suite",
    feeLabel: "Consultation Fee",
    steps: [
      { key: "BOOKED", label: "Booked" },
      { key: "CHECKED_IN", label: "Arrived" },
      { key: "IN_CONSULTATION", label: "In Chair" },
      { key: "COMPLETED", label: "Done" },
    ],
    completedTitle: "Dental Visit Completed",
    servingLabel: "Your Dental Suite Is Ready!",
    servingAction: "Please proceed to",
    accentGradient: "from-cyan-500 via-sky-400 to-blue-400",
  },
  BEAUTY_SALON: {
    id: "BEAUTY_SALON",
    subtitle: "Live Salon Booking & Stylist Queue",
    tokenLabel: "Service Token",
    providerLabel: "Stylist",
    locationLabel: "Station",
    feeLabel: "Service Charge",
    steps: [
      { key: "BOOKED", label: "Booked" },
      { key: "CHECKED_IN", label: "Checked In" },
      { key: "IN_CONSULTATION", label: "In Session" },
      { key: "COMPLETED", label: "Finished" },
    ],
    completedTitle: "Service Completed",
    servingLabel: "Your Stylist Is Ready!",
    servingAction: "Please proceed to",
    accentGradient: "from-pink-500 via-rose-400 to-amber-300",
  },
  RESTAURANT_DELIVERY: {
    id: "RESTAURANT_DELIVERY",
    subtitle: "Live Order & Kitchen Tracker",
    tokenLabel: "Order Token",
    providerLabel: "Kitchen / Rider",
    locationLabel: "Counter",
    feeLabel: "Order Total",
    steps: [
      { key: "BOOKED", label: "Confirmed" },
      { key: "CHECKED_IN", label: "Preparing" },
      { key: "IN_CONSULTATION", label: "Ready / En Route" },
      { key: "COMPLETED", label: "Delivered" },
    ],
    completedTitle: "Order Completed",
    servingLabel: "Your Order Is Ready!",
    servingAction: "Please collect from",
    accentGradient: "from-orange-500 via-amber-400 to-yellow-300",
  },
  MOBILE_REPAIR: {
    id: "MOBILE_REPAIR",
    subtitle: "Live Repair Job Ticket Tracker",
    tokenLabel: "Job Ticket",
    providerLabel: "Technician",
    locationLabel: "Bench",
    feeLabel: "Estimated Cost",
    steps: [
      { key: "BOOKED", label: "Logged" },
      { key: "CHECKED_IN", label: "Diagnosing" },
      { key: "IN_CONSULTATION", label: "Repairing" },
      { key: "COMPLETED", label: "Ready for Pickup" },
    ],
    completedTitle: "Device Ready for Pickup",
    servingLabel: "Repair In Progress / Update!",
    servingAction: "Please check at",
    accentGradient: "from-indigo-500 via-blue-400 to-cyan-300",
  },
};

const DEFAULT_TEMPLATE_META: BusinessTemplateMeta = {
  id: "GENERIC_BUSINESS",
  subtitle: "Live Client Booking & Queue Pass",
  tokenLabel: "Your Reference Token",
  providerLabel: "Assigned Specialist",
  locationLabel: "Desk / Bay",
  feeLabel: "Estimated Fee",
  steps: [
    { key: "BOOKED", label: "Confirmed" },
    { key: "CHECKED_IN", label: "Checked In" },
    { key: "IN_CONSULTATION", label: "In Progress" },
    { key: "COMPLETED", label: "Completed" },
  ],
  completedTitle: "Service Completed",
  servingLabel: "It's Your Turn!",
  servingAction: "Please proceed to",
  accentGradient: "from-emerald-500 via-teal-400 to-cyan-300",
};

export function getBusinessTemplateMeta(templateId?: string): BusinessTemplateMeta {
  if (!templateId) return TEMPLATE_MAP.CLINIC_OPD;
  return TEMPLATE_MAP[templateId] || DEFAULT_TEMPLATE_META;
}
