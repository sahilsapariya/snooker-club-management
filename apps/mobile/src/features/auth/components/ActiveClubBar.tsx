import { Building2, ChevronsUpDown } from 'lucide-react-native';
import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { Text } from '@/components/ui';
import { useTheme } from '@/theme';

import type { AccessibleClub, Tenant } from '../model/types';
import { ClubSwitcherSheet } from './ClubSwitcherSheet';

export interface ActiveClubBarProps {
  readonly tenant: Tenant;
  readonly clubs: readonly AccessibleClub[];
  readonly canSwitch: boolean;
  readonly testID?: string;
}

/**
 * The persistent answer to "which club am I looking at?".
 *
 * A single-club user gets a plain label; the affordance to switch only appears
 * for someone who has somewhere to switch to. This is the header that makes
 * every screen below it unambiguous - without it, a takings figure is just a
 * number with no owner.
 */
export function ActiveClubBar({ tenant, clubs, canSwitch, testID }: ActiveClubBarProps) {
  const theme = useTheme();
  const [switching, setSwitching] = useState(false);
  const accent = tenant.primary_color || theme.colors.primary;

  const content = (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: theme.spacing.sm,
        paddingHorizontal: theme.spacing.lg,
        paddingVertical: theme.spacing.sm,
        backgroundColor: theme.colors.surface,
        borderBottomWidth: 1,
        borderBottomColor: theme.colors.border,
      }}
    >
      <View
        style={{
          width: 26,
          height: 26,
          borderRadius: theme.radius.sm,
          backgroundColor: accent,
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <Building2 color={theme.colors.textInverse} size={14} />
      </View>

      <Text variant="titleSm" numberOfLines={1} style={{ flex: 1 }}>
        {tenant.name}
      </Text>

      {canSwitch ? (
        <>
          <Text variant="caption" color="textMuted">
            {clubs.length} clubs
          </Text>
          <ChevronsUpDown color={theme.colors.textMuted} size={16} />
        </>
      ) : null}
    </View>
  );

  if (!canSwitch) return <View testID={testID}>{content}</View>;

  return (
    <View testID={testID}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Working in ${tenant.name}. Switch club.`}
        testID="switch-club-trigger"
        onPress={() => setSwitching(true)}
      >
        {content}
      </Pressable>

      <ClubSwitcherSheet
        visible={switching}
        onClose={() => setSwitching(false)}
        clubs={clubs}
        activeTenantId={tenant.id}
      />
    </View>
  );
}
