/**
 * Every query key in one place.
 *
 * Keys are tenant-scoped so that switching account never serves another club's
 * cached rows out of memory. The database would refuse the data anyway; this
 * stops it being *displayed* from cache in the moment between sign-ins.
 */
export const queryKeys = {
  sessionContext: (userId: string) => ['session-context', userId] as const,

  tables: {
    all: (tenantId: string) => ['tenant', tenantId, 'tables'] as const,
    overview: (tenantId: string) => ['tenant', tenantId, 'tables', 'overview'] as const,
    managed: (tenantId: string) => ['tenant', tenantId, 'tables', 'managed'] as const,
    types: (tenantId: string) => ['tenant', tenantId, 'table-types'] as const,
  },

  sessions: {
    all: (tenantId: string) => ['tenant', tenantId, 'sessions'] as const,
    open: (tenantId: string) => ['tenant', tenantId, 'sessions', 'open'] as const,
    recent: (tenantId: string) => ['tenant', tenantId, 'sessions', 'recent'] as const,
    byId: (tenantId: string, sessionId: string) =>
      ['tenant', tenantId, 'sessions', sessionId] as const,
  },

  products: {
    all: (tenantId: string) => ['tenant', tenantId, 'products'] as const,
    categories: (tenantId: string) => ['tenant', tenantId, 'product-categories'] as const,
    lowStock: (tenantId: string) => ['tenant', tenantId, 'products', 'low-stock'] as const,
  },

  pricing: {
    rules: (tenantId: string) => ['tenant', tenantId, 'pricing-rules'] as const,
  },

  equipment: {
    all: (tenantId: string) => ['tenant', tenantId, 'equipment'] as const,
  },

  payments: {
    outstanding: (tenantId: string) => ['tenant', tenantId, 'payments', 'outstanding'] as const,
    forSession: (tenantId: string, sessionId: string) =>
      ['tenant', tenantId, 'payments', sessionId] as const,
  },

  billing: {
    settings: (tenantId: string) => ['tenant', tenantId, 'billing-settings'] as const,
  },

  staff: {
    list: (tenantId: string) => ['tenant', tenantId, 'staff'] as const,
  },

  activity: {
    all: (tenantId: string) => ['tenant', tenantId, 'activity'] as const,
    recent: (tenantId: string, limit: number) => ['tenant', tenantId, 'activity', limit] as const,
  },

  expenses: {
    list: (tenantId: string) => ['tenant', tenantId, 'expenses'] as const,
    categories: (tenantId: string) => ['tenant', tenantId, 'expense-categories'] as const,
  },

  cash: {
    summary: (tenantId: string, businessDate: string) =>
      ['tenant', tenantId, 'cash', 'summary', businessDate] as const,
    closing: (tenantId: string, businessDate: string) =>
      ['tenant', tenantId, 'cash', 'closing', businessDate] as const,
    recent: (tenantId: string) => ['tenant', tenantId, 'cash', 'recent'] as const,
  },

  notifications: {
    inbox: (tenantId: string) => ['tenant', tenantId, 'notifications'] as const,
    unreadCount: (tenantId: string) => ['tenant', tenantId, 'notifications', 'unread'] as const,
  },

  platform: {
    overview: () => ['platform', 'overview'] as const,
    owners: () => ['platform', 'owners'] as const,
    ownerClubs: (ownerUserId: string) => ['platform', 'owners', ownerUserId, 'clubs'] as const,
    clubs: () => ['platform', 'clubs'] as const,
    tenants: () => ['platform', 'tenants'] as const,
    tenant: (tenantId: string) => ['platform', 'tenants', tenantId] as const,
  },
} as const;
