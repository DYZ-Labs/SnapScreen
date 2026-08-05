import { defineConfig } from 'vite';
import { crx } from '@crxjs/vite-plugin';
import manifest from './src/manifest.json';

export default defineConfig({
  plugins: [crx({ manifest })],
  // Vite 8 uses Rolldown. Both packaged pages must be explicit HTML entries;
  // only the injected result frame is web-accessible.
  build: {
    rolldownOptions: {
      input: {
        resultFrame: 'src/ui/result-frame.html',
        workspace: 'src/workspace/workspace.html',
      },
    },
  },
});
