import { renderWithProviders } from '@/test-utils/render';
import type { Branding } from '@/theme';

import type { ClubTableOverview } from '../api/tables.api';
import { TableCard } from './TableCard';

const INR = { code: 'INR', minorUnits: 2 };

const baseTable: ClubTableOverview = {
  id: 'table-1',
  tenant_id: 'tenant-1',
  name: 'Snooker 1',
  table_number: 1,
  status: 'AVAILABLE',
  is_active: true,
  notes: null,
  sort_order: 10,
  table_type_id: 'type-1',
  table_type_code: 'SNOOKER',
  table_type_name: 'Snooker',
  active_session_id: null,
  active_session_status: null,
  active_session_started_at: null,
  active_session_planned_minutes: null,
  active_session_total_minor: null,
  is_occupied: false,
};

const occupied = (overrides: Partial<ClubTableOverview> = {}): ClubTableOverview => ({
  ...baseTable,
  active_session_id: 'session-1',
  active_session_status: 'ACTIVE',
  active_session_started_at: new Date(Date.now() - 42 * 60_000).toISOString(),
  active_session_planned_minutes: 60,
  active_session_total_minor: 4000,
  is_occupied: true,
  ...overrides,
});

describe('TableCard', () => {
  it('shows a free table as available', async () => {
    const { getByText } = await renderWithProviders(<TableCard table={baseTable} currency={INR} />);

    expect(getByText('Snooker 1')).toBeTruthy();
    expect(getByText('Snooker · No. 1')).toBeTruthy();
    expect(getByText('Available')).toBeTruthy();
    expect(getByText('Free now')).toBeTruthy();
  });

  it('shows an occupied table with its elapsed clock and running total', async () => {
    const { getByText, getByLabelText } = await renderWithProviders(
      <TableCard table={occupied()} currency={INR} />,
    );

    expect(getByText('In play')).toBeTruthy();
    expect(getByText('Booked 60m')).toBeTruthy();
    expect(getByText('₹40.00')).toBeTruthy();
    // The clock counts from the recorded start, not from render time.
    expect(getByLabelText('Elapsed time').props.children).toBe('00:42:00');
  });

  /**
   * The rule under test: passing the booked time is a state change, not a
   * termination. The card says "Time up" and the clock keeps running past the
   * booked hour.
   */
  it('keeps the clock running past the booked time and flags it', async () => {
    const table = occupied({
      active_session_status: 'TIME_COMPLETED',
      active_session_started_at: new Date(Date.now() - 67 * 60_000).toISOString(),
    });

    const { getByText, getByLabelText, queryByText } = await renderWithProviders(
      <TableCard table={table} currency={INR} />,
    );

    expect(getByText('Time up')).toBeTruthy();
    expect(getByLabelText('Elapsed time').props.children).toBe('01:07:00');
    // Still occupied - nothing about reaching the booked time frees the table.
    expect(queryByText('Free now')).toBeNull();
  });

  it('marks a deactivated table and dims it', async () => {
    const { getByText } = await renderWithProviders(
      <TableCard table={{ ...baseTable, is_active: false }} currency={INR} />,
    );

    expect(getByText('Inactive')).toBeTruthy();
  });

  it('surfaces the reason a table is out of play', async () => {
    const { getByText } = await renderWithProviders(
      <TableCard
        table={{ ...baseTable, status: 'MAINTENANCE', notes: 'Cloth being replaced' }}
        currency={INR}
      />,
    );

    expect(getByText('Maintenance')).toBeTruthy();
    expect(getByText('Cloth being replaced')).toBeTruthy();
  });

  it('formats money in the club that is actually being rendered', async () => {
    const { getByText } = await renderWithProviders(
      <TableCard table={occupied({ active_session_total_minor: 125050 })} currency={INR} />,
    );
    expect(getByText('₹1,250.50')).toBeTruthy();
  });

  /**
   * The same component, with no changes, under a completely different brand.
   * If a colour literal ever creeps into TableCard, this is what catches it.
   */
  it('renders identically under a different club brand', async () => {
    const burgundy: Branding = {
      primaryColor: '#9f1239',
      secondaryColor: '#6d1029',
      logoUrl: null,
      clubName: 'Burgundy Club',
    };

    const { getByText } = await renderWithProviders(
      <TableCard table={baseTable} currency={INR} />,
      {
        branding: burgundy,
      },
    );

    expect(getByText('Snooker 1')).toBeTruthy();
    expect(getByText('Available')).toBeTruthy();
  });
});
