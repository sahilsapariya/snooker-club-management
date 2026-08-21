import { Building2, Check } from 'lucide-react-native';
import { Pressable, View } from 'react-native';

import { Badge, Text } from '@/components/ui';
import { useTheme } from '@/theme';

import type { AccessibleClub } from '../model/types';

export interface ClubPickerProps {
  readonly clubs: readonly AccessibleClub[];
  readonly activeTenantId: string | null;
  readonly onSelect: (tenantId: string) => void;
  readonly testID?: string;
}

/**
 * The list an owner chooses a club from.
 *
 * Each row carries the club's own primary colour, because the entire app is
 * about to change colour to match. Showing that at the moment of choosing makes
 * the switch feel deliberate rather than surprising - and, for someone who runs
 * three clubs, the colour is the fastest way to tell at a glance which one they
 * are in later.
 *
 * The role is shown per club, not per person: the same login can be the owner
 * of one club and reception at another.
 */
export function ClubPicker({ clubs, activeTenantId, onSelect, testID }: ClubPickerProps) {
  const theme = useTheme();

  return (
    <View style={{ gap: theme.spacing.sm }} testID={testID}>
      {clubs.map((club) => {
        const isActive = club.tenant.id === activeTenantId;
        const accent = club.tenant.primary_color || theme.colors.primary;

        return (
          <Pressable
            key={club.tenant.id}
            accessibilityRole="button"
            accessibilityState={{ selected: isActive }}
            accessibilityLabel={`${club.tenant.name}, ${club.role === 'OWNER' ? 'owner' : 'reception'}`}
            testID={`club-option-${club.tenant.slug}`}
            onPress={() => onSelect(club.tenant.id)}
            style={({ pressed }) => ({
              flexDirection: 'row',
              alignItems: 'center',
              gap: theme.spacing.md,
              padding: theme.spacing.md,
              borderRadius: theme.radius.lg,
              borderWidth: isActive ? 2 : 1,
              borderColor: isActive ? accent : theme.colors.border,
              backgroundColor: pressed ? theme.colors.surfaceSunken : theme.colors.surface,
            })}
          >
            <View
              style={{
                width: 44,
                height: 44,
                borderRadius: theme.radius.md,
                backgroundColor: accent,
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Building2 color={theme.colors.textInverse} size={22} />
            </View>

            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="titleSm" numberOfLines={1}>
                {club.tenant.name}
              </Text>
              <Text variant="caption" color="textMuted" numberOfLines={1}>
                {[club.tenant.city, club.tenant.slug].filter(Boolean).join(' · ')}
              </Text>
            </View>

            <View style={{ alignItems: 'flex-end', gap: theme.spacing.xs }}>
              <Badge
                label={club.role === 'OWNER' ? 'Owner' : 'Reception'}
                tone={club.role === 'OWNER' ? 'brand' : 'neutral'}
              />
              {club.tenant.status === 'TRIAL' ? <Badge label="Trial" tone="warning" /> : null}
            </View>

            {isActive ? <Check color={accent} size={20} /> : null}
          </Pressable>
        );
      })}
    </View>
  );
}
