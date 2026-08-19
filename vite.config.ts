import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * BrightSign loads via file:/// — ES modules + crossorigin often leave a stuck boot screen.
 * Ship a single classic IIFE script (deferred) so the HTML widget can execute offline.
 * Stable filenames (app.js / style.css) avoid hash mismatch when copying packages.
 */
function brightsignHtmlPlugin() {
  return {
    name: 'brightsign-html',
    transformIndexHtml(html) {
      let next = html
        .replace(/\s+crossorigin(?:="[^"]*")?/gi, '')
        .replace(/\s+type="module"/gi, '')
        .replace(/<link[^>]*rel="modulepreload"[^>]*>/gi, '');

      // Classic scripts in <head> run before #root exists — move + defer them.
      const moved = [];
      next = next.replace(
        /<script(?![^>]*\bdefer\b)([^>]*\ssrc="\.\/assets\/[^"]+\.js"[^>]*)><\/script>/gi,
        (_m, attrs) => {
          moved.push(
            `<script defer src="./assets/app.js" onerror="window.__perform6ScriptFailed&&window.__perform6ScriptFailed()"></script>`,
          );
          return '';
        },
      );

      // Prefer stable CSS name when present
      next = next.replace(
        /href="\.\/assets\/[^"]+\.css"/gi,
        'href="./assets/style.css"',
      );

      // Ensure deferred app.js has a hard failure path on BrightSign file://
      next = next.replace(
        /<script([^>]*\ssrc="\.\/assets\/app\.js"[^>]*)><\/script>/gi,
        '<script defer src="./assets/app.js" onerror="window.__perform6ScriptFailed&&window.__perform6ScriptFailed()"></script>',
      );

      if (moved.length > 0) {
        next = next.replace(/<\/body>/i, `${moved.join('\n    ')}\n  </body>`);
      }

      return next;
    },
  };
}

export default defineConfig({
  plugins: [tailwindcss(), react(), brightsignHtmlPlugin()],
  base: './',
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    emptyOutDir: true,
    target: 'es2017',
    cssCodeSplit: false,
    modulePreload: false,
    rollupOptions: {
      output: {
        format: 'iife',
        inlineDynamicImports: true,
        entryFileNames: 'assets/app.js',
        assetFileNames: (info) => {
          const name = info.name ?? '';
          if (name.endsWith('.css')) return 'assets/style.css';
          return 'assets/[name]-[hash][extname]';
        },
      },
    },
  },
  server: {
    port: 5173,
    host: true,
  },
});
