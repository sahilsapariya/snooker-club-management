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
    types: (tenantId: string) => ['tenant', tenantId, 'table-types'] as const,
  },

  sessions: {
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

  notifications: {
    inbox: (tenantId: string) => ['tenant', tenantId, 'notifications'] as const,
    unreadCount: (tenantId: string) => ['tenant', tenantId, 'notifications', 'unread'] as const,
  },

  platform: {
    tenants: () => ['platform', 'tenants'] as const,
    tenant: (tenantId: string) => ['platform', 'tenants', tenantId] as const,
  },
} as const;
