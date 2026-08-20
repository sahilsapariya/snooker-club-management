import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * Dynamic Expo configuration.
 *
 * Only PUBLIC values live here. `EXPO_PUBLIC_*` variables are inlined into the
 * JavaScript bundle at build time, so anything placed in them is readable by
 * anyone who has the app. The Supabase URL and anon key are designed for that:
 * the anon key carries no authority of its own, and every table it can reach is
 * behind Row Level Security.
 *
 * The service role key, the database password and any push credentials must
 * never appear in this file, in `.env`, or anywhere else under apps/mobile.
 */
const APP_VARIANT = process.env.APP_VARIANT ?? 'development';

const VARIANTS = {
  development: { name: 'Club Desk (Dev)', packageSuffix: '.dev' },
  preview: { name: 'Club Desk (Preview)', packageSuffix: '.preview' },
  production: { name: 'Club Desk', packageSuffix: '' },
} as const;

type VariantKey = keyof typeof VARIANTS;

const variant =
  VARIANTS[(APP_VARIANT as VariantKey) in VARIANTS ? (APP_VARIANT as VariantKey) : 'development'];
const BUNDLE_ID = `com.snookerclub.clubdesk${variant.packageSuffix}`;

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: variant.name,
  slug: 'snooker-club-management',
  scheme: 'snookerclub',
  version: '0.1.0',
  orientation: 'portrait',
  userInterfaceStyle: 'automatic',
  icon: './assets/images/icon.png',
  // The New Architecture is the only architecture from SDK 54 onwards; there is
  // no longer a flag for it.

  // The splash screen is configured through the expo-splash-screen plugin below
  // (the top-level `splash` key was removed in SDK 54). Its background is
  // intentionally neutral: tenant branding is not known until after sign-in, so
  // painting the club's colour here would be a guess.

  ios: {
    bundleIdentifier: BUNDLE_ID,
    supportsTablet: true,
    infoPlist: {
      ITSAppUsesNonExemptEncryption: false,
    },
  },

  android: {
    package: BUNDLE_ID,
    adaptiveIcon: {
      foregroundImage: './assets/images/android-icon-foreground.png',
      backgroundImage: './assets/images/android-icon-background.png',
      monochromeImage: './assets/images/android-icon-monochrome.png',
      backgroundColor: '#0B1220',
    },
    // Edge-to-edge is always on from SDK 54; there is no longer a flag.
    predictiveBackGestureEnabled: false,
  },

  web: {
    output: 'static',
    favicon: './assets/images/favicon.png',
  },

  plugins: [
    'expo-router',
    'expo-secure-store',
    [
      'expo-splash-screen',
      {
        image: './assets/images/splash-icon.png',
        imageWidth: 160,
        backgroundColor: '#0B1220',
      },
    ],
    [
      'expo-notifications',
      {
        color: '#059669',
      },
    ],
  ],

  experiments: {
    typedRoutes: true,
    reactCompiler: true,
  },

  extra: {
    router: {},
    eas: {
      // Filled in by `eas init`; kept here so the shape is obvious.
      projectId: process.env.EAS_PROJECT_ID,
    },
  },
});
