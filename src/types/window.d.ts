/**
 * @file window.d.ts
 * @brief Global window.ccmon typing for the preload bridge.
 * @author Iskandar Putra <www.iskandarputra.com>
 */

import type { CcmonApi } from '../../shared/ipc';

declare global {
  interface Window {
    /** IPC bridge exposed by electron/preload.ts — absent in a bare browser. */
    ccmon?: CcmonApi;
  }
}

export {};
