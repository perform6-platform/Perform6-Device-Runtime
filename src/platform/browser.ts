import type { Platform } from './index';
import { runtimeConfig } from '../config/runtime';

export const browserPlatform: Platform = {
  name: 'browser',
  init() {
    if (runtimeConfig.isSimulator) {
      console.info('[Perform6] Runtime Simulator Mode — browser acts as BrightSign device');
      console.info('[Perform6] Profile:', runtimeConfig.hardwareProfile);
      console.info('[Perform6] API:', runtimeConfig.apiBaseUrl);
    } else {
      console.info('[Perform6] Running in browser (no BrightSign hardware)');
    }
  },
};
