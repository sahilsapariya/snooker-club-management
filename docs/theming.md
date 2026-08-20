# Theming

Each club has one brand colour, set by the platform super admin. Everything the
app renders is derived from it. Club staff cannot change it — the database
revokes the privilege (see [security.md](security.md)).

---

## Flow

```
tenants row                    (platform controlled)
   primary_color   #059669
   secondary_color #0f766e
   theme_preset    'emerald'
   logo_url
        │
        ▼  brandingFromTenant()
   Branding
        │
        ▼  buildTheme(branding, 'light' | 'dark')
   Theme { colors, spacing, radius, typography, touchTarget, motion, elevation() }
        │
        ▼  <ThemeProvider>
   useTheme() in every component
```

`buildTheme` is pure: same branding in, same theme out. It is memoised on the
tenant row, and the light/dark choice follows the device unless overridden.

The app boots with the product default (emerald) and re-themes once the club is
known. Because components only read semantic token names, that transition needs
no component to be aware of it. The login screen deliberately shows the
product's identity, not a club's — branding is not known before sign-in, and
guessing would mean flashing the wrong colours.

---

## Tokens

Components reference these names and never a literal colour.

### Surfaces

| Token             | Use                                |
| ----------------- | ---------------------------------- |
| `background`      | screen background                  |
| `surface`         | cards, inputs, tab bar             |
| `surfaceElevated` | cards that float above other cards |
| `surfaceSunken`   | wells, inset rows, neutral badges  |

### Text

| Token           | Use                     |
| --------------- | ----------------------- |
| `textPrimary`   | body and headings       |
| `textSecondary` | labels, secondary lines |
| `textMuted`     | captions, placeholders  |
| `textInverse`   | text on a strong fill   |

### Brand

| Token                | Use                                                |
| -------------------- | -------------------------------------------------- |
| `primary`            | primary button fill, accent bars                   |
| `primaryForeground`  | text/icons on `primary` — chosen for contrast      |
| `primaryContainer`   | soft brand fill (secondary buttons, brand badges)  |
| `onPrimaryContainer` | text on `primaryContainer`                         |
| `primaryOnSurface`   | brand colour adjusted to read as text on `surface` |
| `primaryPressed`     | pressed state                                      |
| `secondary`          | secondary brand colour                             |

### Lines

`border` · `borderStrong` · `divider`

### Status — never derived from the brand

`success` · `successContainer` · `onSuccessContainer`
`warning` · `warningContainer` · `onWarningContainer`
`error` · `errorContainer` · `onErrorContainer`
`info` · `infoContainer` · `onInfoContainer`

### Other

`overlay` · `skeleton` · `shadow`

Non-colour tokens live in `src/theme/tokens.ts` and do not vary by club:
`spacing` (4pt grid), `radius`, `typography` (10 variants), `touchTarget`
(44pt minimum), `motion`, `elevation(0–3)`.

---

## The two rules

### Contrast is computed

`primaryForeground` is chosen by WCAG relative luminance, not assumed to be
white. `primaryOnSurface` and every `on*Container` token are pushed through
`ensureContrast(color, background, 4.5)`, which blends toward black or white in
5% steps until the ratio is met — preserving hue, moving only lightness.

A club that picks pale amber (`#fde68a`) gets dark text on its buttons and a
darkened accent for text, automatically.

### Status colours are fixed

Red means "unpaid" in every club, including one whose brand colour is red.
Success, warning, error and info come from a fixed per-scheme palette and are
only nudged for contrast against the (slightly brand-tinted) surface.

Both rules are enforced by `src/theme/build-theme.test.ts`, which runs every
preset plus `#000000` and `#fde68a` through both schemes and asserts the ratios.

---

## Presets

`src/theme/presets.ts`:

| id         | Label    | Primary   | Secondary |
| ---------- | -------- | --------- | --------- |
| `emerald`  | Emerald  | `#059669` | `#0f766e` |
| `midnight` | Midnight | `#1f2937` | `#4b5563` |
| `ocean`    | Ocean    | `#2563eb` | `#1e40af` |
| `amber`    | Amber    | `#d97706` | `#b45309` |
| `burgundy` | Burgundy | `#9f1239` | `#6d1029` |
| `violet`   | Violet   | `#7c3aed` | `#5b21b6` |

An explicit `primary_color` on the tenant row always wins; the preset is a
convenient starting point for the platform admin. A seventh palette is a row in
this array — no component changes.

---

## Using it

```tsx
import { useTheme } from '@/theme';
import { Text, Card, Button } from '@/components/ui';

function Example() {
  const theme = useTheme();

  return (
    <Card style={{ gap: theme.spacing.md }}>
      <Text variant="titleMd">Snooker 1</Text>
      <Text variant="bodySm" color="textMuted">
        Free now
      </Text>
      <Button label="Start session" />
    </Card>
  );
}
```

Do **not** write `color: '#059669'`, `backgroundColor: 'white'`, or
`fontSize: 14`. If a token is missing, add it to `ThemeColors` and derive it in
`buildTheme` so every club gets it.

---

## Changing a club's branding

Branding is not writable through the table. Use the RPC:

```sql
select public.platform_update_tenant(
  '<tenant-uuid>',
  p_primary_color => '#9f1239',
  p_theme_preset  => 'burgundy',
  p_logo_url      => 'https://cdn.example.com/club-logo.png'
);
```

Or from the app as a platform admin — `useUpdateTenantBranding()`. Club users
pick up the change on their next session-context refresh.

Note that `platform_update_tenant` coalesces its arguments onto the existing
row, so passing `null` means "leave unchanged" rather than "clear". Clearing an
optional field (removing a logo) needs an explicit clear flag on the function
and is not supported yet.
