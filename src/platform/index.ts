import { browserPlatform } from './browser';
import { brightsignPlatform } from './brightsign';

export interface Platform {
  name: 'browser' | 'brightsign';
  init(): void;
}

export function getPlatform(): Platform {
  const isBrightSign =
    typeof window !== 'undefined' &&
    'brightsign' in window &&
    !!(window as Window & { brightsign?: unknown }).brightsign;

  return isBrightSign ? brightsignPlatform : browserPlatform;
}
