import type { Platform } from './index';

export const brightsignPlatform: Platform = {
  name: 'brightsign',
  init() {
    console.info('[Perform6] Running on BrightSign player');
  },
};
