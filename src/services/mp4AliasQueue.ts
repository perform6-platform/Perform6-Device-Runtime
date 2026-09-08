/**
 * Eager .mp4 play-alias queue for extensionless AssetPool paths.
 *
 * Node cannot CopyFile pool sha256 blobs (EPERM). JS enqueues the pool path;
 * autorun drains SD:/perform6-mp4-alias-queue.json with BrightScript CopyFile
 * off the PlayFile hot path so first play is usually alias-hit.
 */
import { getNodeFs, toNodeSdPath } from '../platform/brightSignNode';

const QUEUE_SD = 'SD:/perform6-mp4-alias-queue.json';
const MEDIA_STORE = '/storage/sd/perform6-media';

type NodeFsLink = {
  linkSync?: (existing: string, newPath: string) => void;
  copyFileSync?: (src: string, dest: string) => void;
};

function normalizePoolPath(sdPath: string): string {
  let p = sdPath.trim().replace(/\\/g, '/');
  if (p.startsWith('file:///SD:/') || p.startsWith('file:///sd:/')) {
    p = `SD:/${p.slice('file:///SD:/'.length)}`;
  } else if (p.startsWith('/storage/sd/')) {
    p = `SD:/${p.slice('/storage/sd/'.length)}`;
  } else if (/^sd:/i.test(p)) {
    p = `SD:/${p.replace(/^sd:\/*/i, '')}`;
  }
  return p;
}

function isExtensionlessPoolPath(sdPath: string): boolean {
  const low = sdPath.toLowerCase();
  if (!low.includes('perform6-media-pool')) return false;
  const leaf = sdPath.split('/').pop() ?? '';
  if (!leaf || leaf.includes('.')) return false;
  return true;
}

function aliasDestForPool(poolSd: string): string | null {
  const leaf = poolSd.split('/').pop() ?? '';
  if (!leaf || leaf.toLowerCase().endsWith('.mp4')) return null;
  return `${MEDIA_STORE}/${leaf}.mp4`;
}

function tryLocalAlias(poolSd: string): boolean {
  const fs = getNodeFs() as (ReturnType<typeof getNodeFs> & NodeFsLink) | null;
  if (!fs) return false;
  const dest = aliasDestForPool(poolSd);
  if (!dest) return false;
  try {
    if (!fs.existsSync(MEDIA_STORE)) {
      fs.mkdirSync(MEDIA_STORE, { recursive: true });
    }
    if (fs.existsSync(dest) && fs.statSync(dest).size > 0) return true;
    const src = toNodeSdPath(poolSd);
    if (!fs.existsSync(src) || fs.statSync(src).size <= 0) return false;
    // Prefer hardlink (no CopyFile tax). Falls through on EXDEV/EPERM.
    if (typeof fs.linkSync === 'function') {
      try {
        fs.linkSync(src, dest);
        if (fs.existsSync(dest) && fs.statSync(dest).size > 0) {
          console.info('[Perform6] mp4 alias hardlink OK', dest);
          return true;
        }
      } catch {
        /* copy / autorun queue */
      }
    }
    if (typeof fs.copyFileSync === 'function') {
      try {
        fs.copyFileSync(src, dest);
        if (fs.existsSync(dest) && fs.statSync(dest).size > 0) {
          console.info('[Perform6] mp4 alias copy OK', dest);
          return true;
        }
      } catch {
        /* AssetPool blobs often EPERM — autorun CopyFile */
      }
    }
  } catch (e) {
    console.warn(
      '[Perform6] mp4 alias local create failed',
      e instanceof Error ? e.message : e,
    );
  }
  return false;
}

function readQueue(): string[] {
  const fs = getNodeFs();
  if (!fs) return [];
  try {
    const path = toNodeSdPath(QUEUE_SD);
    if (!fs.existsSync(path)) return [];
    const raw = fs.readFileSync(path, 'utf8');
    const text = typeof raw === 'string' ? raw : raw.toString('utf8');
    const parsed = JSON.parse(text) as { paths?: unknown };
    if (!Array.isArray(parsed.paths)) return [];
    return parsed.paths.filter((p): p is string => typeof p === 'string' && p.length > 0);
  } catch {
    return [];
  }
}

function writeQueue(paths: string[]): void {
  const fs = getNodeFs();
  if (!fs) return;
  try {
    const finalPath = toNodeSdPath(QUEUE_SD);
    const tmpPath = `${finalPath}.tmp`;
    const body = JSON.stringify({ type: 'mp4-alias-queue', paths });
    fs.writeFileSync(tmpPath, body, 'utf8');
    try {
      const fsAny = fs as { renameSync?: (a: string, b: string) => void };
      if (typeof fsAny.renameSync === 'function') {
        fsAny.renameSync(tmpPath, finalPath);
      } else {
        fs.writeFileSync(finalPath, body, 'utf8');
        try {
          fs.unlinkSync(tmpPath);
        } catch {
          /* ignore */
        }
      }
    } catch {
      fs.writeFileSync(finalPath, body, 'utf8');
    }
  } catch (e) {
    console.warn(
      '[Perform6] mp4 alias queue write failed',
      e instanceof Error ? e.message : e,
    );
  }
}

/**
 * After AssetPool marks a playable path: create .mp4 alias now (link/copy) or
 * enqueue for autorun CopyFile so PlayLocalFile can alias-hit on first play.
 */
export function enqueueMp4PlayAlias(poolPath: string): void {
  const normalized = normalizePoolPath(poolPath);
  if (!isExtensionlessPoolPath(normalized)) return;
  if (tryLocalAlias(normalized)) return;

  const existing = readQueue();
  if (existing.includes(normalized)) return;
  writeQueue([...existing, normalized]);
  console.info('[Perform6] mp4 alias queued for autorun', normalized);
}
