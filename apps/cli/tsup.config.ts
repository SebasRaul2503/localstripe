import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { main: 'src/main.ts' },
  format: ['esm'],
  platform: 'node',
  target: 'node20',
  clean: true,
  sourcemap: false,
  // Standalone single file: it is copied into the API Docker image without node_modules.
  noExternal: [/.*/],
  splitting: false,
  banner: {
    js: [
      '#!/usr/bin/env node',
      "import { createRequire as __localstripeCreateRequire } from 'node:module';",
      'const require = __localstripeCreateRequire(import.meta.url);',
    ].join('\n'),
  },
});
