import type { Database } from '@/types/database.types';

import { Badge, type BadgeTone } from './Badge';

type ClubTableStatus = Database['public']['Enums']['club_table_status'];
type SessionStatus = Database['public']['Enums']['session_status'];
type PaymentStatus = Database['public']['Enums']['payment_status'];
type EquipmentStatus = Database['public']['Enums']['equipment_status'];

interface Descriptor {
  readonly label: string;
  readonly tone: BadgeTone;
}

/**
 * One place that turns a database enum into words a person reads.
 *
 * Keeping these maps here rather than inline in screens means a receptionist
 * sees "Time up" in the table list, the session sheet and the notification -
 * never three different phrasings of the same state.
 */
const TABLE_STATUS: Record<ClubTableStatus, Descriptor> = {
  AVAILABLE: { label: 'Available', tone: 'success' },
  MAINTENANCE: { label: 'Maintenance', tone: 'warning' },
  OUT_OF_SERVICE: { label: 'Out of service', tone: 'error' },
};

const SESSION_STATUS: Record<SessionStatus, Descriptor> = {
  ACTIVE: { label: 'In play', tone: 'info' },
  // The booked time has elapsed. The session is still running: only a member of
  // staff ends it.
  TIME_COMPLETED: { label: 'Time up', tone: 'warning' },
  CLOSED: { label: 'Closed', tone: 'neutral' },
  CANCELLED: { label: 'Cancelled', tone: 'neutral' },
};

const PAYMENT_STATUS: Record<PaymentStatus, Descriptor> = {
  UNPAID: { label: 'Unpaid', tone: 'error' },
  PARTIALLY_PAID: { label: 'Part paid', tone: 'warning' },
  PAID: { label: 'Paid', tone: 'success' },
  WAIVED: { label: 'Waived', tone: 'neutral' },
};

const EQUIPMENT_STATUS: Record<EquipmentStatus, Descriptor> = {
  AVAILABLE: { label: 'Available', tone: 'success' },
  IN_USE: { label: 'In use', tone: 'info' },
  NEEDS_REPAIR: { label: 'Needs repair', tone: 'warning' },
  DAMAGED: { label: 'Damaged', tone: 'error' },
  RETIRED: { label: 'Retired', tone: 'neutral' },
};

export function TableStatusBadge({ status }: { readonly status: ClubTableStatus }) {
  const descriptor = TABLE_STATUS[status];
  return <Badge label={descriptor.label} tone={descriptor.tone} />;
}

export function SessionStatusBadge({ status }: { readonly status: SessionStatus }) {
  const descriptor = SESSION_STATUS[status];
  return <Badge label={descriptor.label} tone={descriptor.tone} />;
}

export function PaymentStatusBadge({ status }: { readonly status: PaymentStatus }) {
  const descriptor = PAYMENT_STATUS[status];
  return <Badge label={descriptor.label} tone={descriptor.tone} />;
}

export function EquipmentStatusBadge({ status }: { readonly status: EquipmentStatus }) {
  const descriptor = EQUIPMENT_STATUS[status];
  return <Badge label={descriptor.label} tone={descriptor.tone} />;
}

export const statusDescriptors = {
  table: TABLE_STATUS,
  session: SESSION_STATUS,
  payment: PAYMENT_STATUS,
  equipment: EQUIPMENT_STATUS,
} as const;
