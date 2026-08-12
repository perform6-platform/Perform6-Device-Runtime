import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * BrightSign loads via file:/// — ES modules + crossorigin often leave a stuck boot screen.
 * Ship a single classic IIFE script (deferred) so the HTML widget can execute offline.
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
          moved.push(`<script defer${attrs}></script>`);
          return '';
        },
      );

      if (moved.length > 0) {
        next = next.replace(/<\/body>/i, `${moved.join('\n    ')}\n  </body>`);
      }

      return next;
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), brightsignHtmlPlugin()],
  base: './',
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    emptyOutDir: true,
    target: 'es2018',
    cssCodeSplit: false,
    modulePreload: false,
    rollupOptions: {
      output: {
        format: 'iife',
        inlineDynamicImports: true,
        entryFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
  server: {
    port: 5173,
    host: true,
  },
});
