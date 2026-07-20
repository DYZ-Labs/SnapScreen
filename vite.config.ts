import { defineConfig } from 'vite';
import { crx } from '@crxjs/vite-plugin';
import manifest from './src/manifest.json';

export default defineConfig({
  plugins: [crx({ manifest })],
  // Vite 8 uses Rolldown. The frame is also listed as a web-accessible
  // resource, but it must be an explicit HTML entry so its TS/CSS is bundled.
  build: {
    rolldownOptions: {
      input: {
        resultFrame: 'src/ui/result-frame.html',
      },
    },
  },
});
