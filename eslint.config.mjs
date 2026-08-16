import { defineConfig, globalIgnores } from 'eslint/config';
import nextVitals from 'eslint-config-next/core-web-vitals';

export default defineConfig([
  ...nextVitals,
  globalIgnores(['.next/**', '.next_build/**', '.next_old/**', 'node_modules/**', '.builder/**', 'out/**', 'output/**', 'build/**', 'dist-desktop*/**', 'dist-worker/**', 'tmp/**', 'next-env.d.ts']),
]);
