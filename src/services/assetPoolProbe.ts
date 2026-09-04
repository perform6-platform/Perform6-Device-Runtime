/**
 * Probe BrightSign asset-pool modules once at boot.
 * Media uses /storage/sd/perform6-media-pool; OTA uses /storage/sd/perform6-ota-pool.
 * Clear-cache never wipes OTA pool.
 */
export type AssetPoolProbeResult = {
  assetpool: boolean;
  assetpoolfetcher: boolean;
  error?: string;
};

let cached: AssetPoolProbeResult | null = null;

export function probeBrightSignAssetPool(): AssetPoolProbeResult {
  if (cached) return cached;

  const result: AssetPoolProbeResult = {
    assetpool: false,
    assetpoolfetcher: false,
  };

  try {
    const req =
      typeof (globalThis as { require?: (id: string) => unknown }).require ===
      'function'
        ? (globalThis as { require: (id: string) => unknown }).require
        : typeof window !== 'undefined' &&
            typeof (window as unknown as { require?: (id: string) => unknown })
              .require === 'function'
          ? (window as unknown as { require: (id: string) => unknown }).require
          : null;

    if (!req) {
      result.error = 'require() unavailable (Node.js not enabled on HtmlWidget)';
      cached = result;
      console.info('[Perform6] Asset pool probe', result);
      return result;
    }

    try {
      req('@brightsign/assetpool');
      result.assetpool = true;
    } catch (e) {
      result.error = e instanceof Error ? e.message : String(e);
    }

    try {
      req('@brightsign/assetpoolfetcher');
      result.assetpoolfetcher = true;
    } catch (e) {
      if (!result.error) {
        result.error = e instanceof Error ? e.message : String(e);
      }
    }
  } catch (e) {
    result.error = e instanceof Error ? e.message : String(e);
  }

  cached = result;
  console.info('[Perform6] Asset pool probe', result);
  return result;
}
