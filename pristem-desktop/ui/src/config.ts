// Build-time provider discriminator. The kernel owns model access; the UI only
// renders an honest label. No key is ever read here.
export const PROVIDER: 'demo' | 'byok' =
  (import.meta.env.VITE_PRISTEM_PROVIDER as 'demo' | 'byok' | undefined) ?? 'demo';

export const IS_DEMO = PROVIDER === 'demo';
