import type { NodeFs } from '../platform/brightSignNode';

export type AssetPoolDirectoryResult = {
  ready: boolean;
  created: boolean;
  reason?: string;
};

/**
 * Make the empty AssetPool root that is absent after a clean SD format.
 * This is deliberately non-destructive: it never removes or rewrites an
 * existing pool, media object, startup file, or OTA file.
 */
export function ensureAssetPoolDirectory(
  fs: NodeFs | null,
  path: string,
): AssetPoolDirectoryResult {
  if (!fs) {
    return { ready: false, created: false, reason: 'Node fs unavailable' };
  }

  try {
    if (fs.existsSync(path)) {
      if (!fs.statSync(path).isDirectory()) {
        return {
          ready: false,
          created: false,
          reason: 'AssetPool path exists but is not a directory',
        };
      }
      return { ready: true, created: false };
    }

    fs.mkdirSync(path, { recursive: true });
    if (!fs.existsSync(path) || !fs.statSync(path).isDirectory()) {
      return {
        ready: false,
        created: false,
        reason: 'Directory creation did not produce a readable directory',
      };
    }
    return { ready: true, created: true };
  } catch (error) {
    return {
      ready: false,
      created: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}
