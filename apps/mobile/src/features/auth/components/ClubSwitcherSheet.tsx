import { useQueryClient } from '@tanstack/react-query';
import { View } from 'react-native';

import { Sheet, Text, useToast } from '@/components/ui';
import { useTheme } from '@/theme';

import { useSwitchClub } from '../hooks/use-active-club';
import type { AccessibleClub } from '../model/types';
import { ClubPicker } from './ClubPicker';

export interface ClubSwitcherSheetProps {
  readonly visible: boolean;
  readonly onClose: () => void;
  readonly clubs: readonly AccessibleClub[];
  readonly activeTenantId: string;
}

/**
 * Moving an owner between their clubs.
 *
 * The switch does three things in order, and the order matters: evict the
 * outgoing club's cached rows, record the new choice, then refetch. Doing it
 * the other way round would leave a window in which the previous club's
 * numbers render under the new club's name and colours - the one failure mode
 * that would make a multi-club owner distrust every figure in the app.
 */
export function ClubSwitcherSheet({
  visible,
  onClose,
  clubs,
  activeTenantId,
}: ClubSwitcherSheetProps) {
  const theme = useTheme();
  const toast = useToast();
  const switchClub = useSwitchClub();
  const queryClient = useQueryClient();

  async function handleSelect(tenantId: string): Promise<void> {
    if (tenantId === activeTenantId) {
      onClose();
      return;
    }

    const club = clubs.find((c) => c.tenant.id === tenantId);
    await switchClub(tenantId);

    // Closing first would unmount the sheet mid-transition; the toast confirms
    // the change once the new club is the one on screen.
    onClose();
    if (club) toast.success(`Now working in ${club.tenant.name}`);
    await queryClient.invalidateQueries({ queryKey: ['tenant', tenantId] });
  }

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="Switch club"
      subtitle="Everything on screen changes to the club you pick"
      testID="club-switcher"
    >
      <View style={{ gap: theme.spacing.lg }}>
        <ClubPicker
          clubs={clubs}
          activeTenantId={activeTenantId}
          onSelect={(id) => void handleSelect(id)}
        />
        <Text variant="caption" color="textMuted">
          Sessions, cash, reports and settings are separate for each club. Nothing is shared between
          them.
        </Text>
      </View>
    </Sheet>
  );
}
