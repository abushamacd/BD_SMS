// Mock data for the Phase 1 UI build. Every page reads from app/mock/* so the
// screens are reviewable before any backend exists. Delete these files as each
// page gets wired to a real loader.

export const LOW_BALANCE_THRESHOLD = 500;

export const credits = {
  balance: 342,
  // "default" = merchant buys credits from us. "personal" = merchant brought
  // their own gateway and pays a subscription instead.
  gatewayMode: "default",
  gatewayName: "BulkSMSBD",
};

export const stats = {
  sentToday: 128,
  sentThisMonth: 3417,
  deliveryRate: 96.4,
  creditsSpentThisMonth: 4102,
};

export const automations = [
  { key: "new_order", name: "New order", enabled: true },
  { key: "fulfillment", name: "Order fulfillment", enabled: true },
  { key: "shipment", name: "Order shipment", enabled: true },
  { key: "delivery", name: "Order delivery", enabled: false },
  { key: "cancelled", name: "Order cancelled", enabled: false },
  { key: "cod_otp", name: "COD OTP verification", enabled: true },
  { key: "abandoned_cart", name: "Abandoned cart", enabled: true },
];

export const abandonedCart = {
  smsSent: 214,
  recovered: 31,
  revenue: 87450, // BDT
};

export const recentActivity = [
  {
    id: 1,
    customer: "Rakib Hasan",
    phone: "8801712345678",
    type: "New order",
    credits: 1,
    status: "delivered",
    sentAt: "12 Jul, 2:41 PM",
  },
  {
    id: 2,
    customer: "Nusrat Jahan",
    phone: "8801812345679",
    type: "COD OTP",
    credits: 1,
    status: "delivered",
    sentAt: "12 Jul, 2:38 PM",
  },
  {
    id: 3,
    customer: "Tanvir Ahmed",
    phone: "8801912345680",
    type: "Abandoned cart",
    credits: 2,
    status: "sent",
    sentAt: "12 Jul, 2:15 PM",
  },
  {
    id: 4,
    customer: "Sadia Islam",
    phone: "8801612345681",
    type: "Shipment",
    credits: 1,
    status: "delivered",
    sentAt: "12 Jul, 1:52 PM",
  },
  {
    id: 5,
    customer: "Imran Kabir",
    phone: "8801512345682",
    type: "Campaign",
    credits: 3,
    status: "failed",
    sentAt: "12 Jul, 1:30 PM",
  },
];
