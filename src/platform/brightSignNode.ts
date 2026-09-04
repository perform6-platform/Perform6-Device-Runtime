/**
 * BrightSign HtmlWidget Node helpers (no autorun / BSMessagePort).
 * Used when the JS↔autorun bridge is dead so admin remote ops still work.
 */

export type BrightSignRequire = (id: string) => unknown;

export type NodeFs = {
  existsSync: (path: string) => boolean;
  mkdirSync: (path: string, opts?: { recursive?: boolean }) => void;
  readdirSync: (
    path: string,
    opts?: { withFileTypes?: boolean },
  ) => string[] | Array<{ name: string; isDirectory: () => boolean; isFile: () => boolean }>;
  statSync: (path: string) => { size: number; isDirectory: () => boolean; isFile: () => boolean };
  readFileSync: (path: string, encoding?: string) => string | Buffer;
  writeFileSync: (path: string, data: string, encoding?: string) => void;
  unlinkSync: (path: string) => void;
  rmSync?: (path: string, opts?: { recursive?: boolean; force?: boolean }) => void;
  rmdirSync: (path: string) => void;
};

export function getBrightSignRequire(): BrightSignRequire | null {
  const g = globalThis as { require?: BrightSignRequire };
  return typeof g.require === 'function' ? g.require : null;
}

export function getNodeFs(): NodeFs | null {
  const req = getBrightSignRequire();
  if (!req) return null;
  try {
    return req('fs') as NodeFs;
  } catch {
    return null;
  }
}

/** SD:/foo → /storage/sd/foo (and keep /storage/sd paths as-is). */
export function toNodeSdPath(sdPath: string): string {
  const trimmed = sdPath.trim().replace(/\\/g, '/');
  if (trimmed.startsWith('/storage/sd')) return trimmed;
  const normalized = trimmed.replace(/^sd:/i, 'SD:');
  if (normalized === 'SD:' || normalized === 'SD:/') return '/storage/sd';
  if (normalized.startsWith('SD:/')) {
    return `/storage/sd/${normalized.slice(4).replace(/^\/+/, '')}`;
  }
  if (normalized.startsWith('sd/')) {
    return `/storage/sd/${normalized.slice(3)}`;
  }
  return trimmed;
}

/** Reject paths that escape the SD mount. */
export function isSafeNodeSdPath(nodePath: string): boolean {
  const p = nodePath.replace(/\\/g, '/');
  if (p === '/storage/sd') return true;
  if (!p.startsWith('/storage/sd/')) return false;
  if (p.includes('/../') || p.endsWith('/..')) return false;
  return true;
}

/**
 * Soft reboot via @brightsign/system — works even when autorun ignores BSMessagePort.
 * Returns true if the reboot call was issued (player may reset shortly after).
 */
export function rebootViaBrightSignSystem(): boolean {
  const req = getBrightSignRequire();
  if (!req) {
    console.warn('[Perform6] Node reboot skipped — require() unavailable');
    return false;
  }
  try {
    const SystemCtor = req('@brightsign/system') as {
      new (): { reboot?: () => void | Promise<void> };
    };
    const system = new SystemCtor();
    if (typeof system.reboot !== 'function') {
      console.warn('[Perform6] Node reboot skipped — system.reboot missing');
      return false;
    }
    void Promise.resolve(system.reboot()).catch((error) => {
      console.warn('[Perform6] Node reboot promise rejected', error);
    });
    console.info('[Perform6] Node @brightsign/system.reboot() issued');
    return true;
  } catch (error) {
    console.warn('[Perform6] Node reboot failed', error);
    return false;
  }
}

/** Recursively delete a directory tree (best-effort). */
export function rmTreeSync(fs: NodeFs, dirPath: string): number {
  if (!fs.existsSync(dirPath)) return 0;
  let removed = 0;
  if (typeof fs.rmSync === 'function') {
    try {
      fs.rmSync(dirPath, { recursive: true, force: true });
      return 1;
    } catch {
      /* fall through to manual walk */
    }
  }
  try {
    const names = fs.readdirSync(dirPath) as string[];
    for (const name of names) {
      const child = `${dirPath.replace(/\/$/, '')}/${name}`;
      let isDir = false;
      try {
        isDir = fs.statSync(child).isDirectory();
      } catch {
        continue;
      }
      if (isDir) {
        removed += rmTreeSync(fs, child);
        try {
          fs.rmdirSync(child);
          removed += 1;
        } catch {
          /* ignore */
        }
      } else {
        try {
          fs.unlinkSync(child);
          removed += 1;
        } catch {
          /* ignore */
        }
      }
    }
    try {
      fs.rmdirSync(dirPath);
      removed += 1;
    } catch {
      /* root may remain */
    }
  } catch {
    /* ignore */
  }
  return removed;
}
