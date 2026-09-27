// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import starlightThemeNova from 'starlight-theme-nova';
import tailwindcss from '@tailwindcss/vite';
import astroMermaid from 'astro-mermaid';

// Use base path for GitHub Pages deployment
// For local development, you can override with: BASE=/ pnpm dev
const base = process.env.BASE || '/jagreehal-typescript-patterns';

// https://astro.build/config
export default defineConfig({
  site: 'https://jagreehal.github.io',
  base,
  // The ESLint chapter became the Oxlint chapter; keep the old URL working
  redirects: {
    '/patterns/eslint': `${base.replace(/\/$/, '')}/patterns/lint`,
  },
  integrations: [
    astroMermaid(),
    starlight({
      title: 'TypeScript Patterns',
      description: 'Production-ready patterns for testable, type-safe TypeScript applications',
      plugins: [starlightThemeNova()],
      tableOfContents: false,
      components: {
        // Adds a "copy page as Markdown" button beside every chapter title
        PageTitle: './src/components/PageTitle.astro',
      },
      social: [
        { icon: 'github', label: 'GitHub', href: 'https://github.com/jagreehal/jagreehal-typescript-patterns' },
      ],
      sidebar: [
        {
          label: 'Core Patterns',
          items: [
            { label: 'Testing & Testability', slug: 'patterns/testing' },
            { label: 'Testing Levels', slug: 'patterns/testing-levels' },
            { label: 'Browser Journeys', slug: 'patterns/browser-journeys' },
            { label: 'Test Data and Fakes', slug: 'patterns/test-data' },
            { label: 'Testing External Infrastructure', slug: 'patterns/testing-external-services' },
            { label: 'Simulating Third-Party Services', slug: 'patterns/third-party-doubles' },
            { label: 'Testing Failure Scenarios', slug: 'patterns/testing-failure-scenarios' },
            { label: 'Test Quality', slug: 'patterns/test-quality' },
            { label: 'CI Gates and Triage', slug: 'patterns/ci-gates' },
            { label: 'Functions Over Classes', slug: 'patterns/functions' },
            { label: 'Validation at the Boundary', slug: 'patterns/validation' },
            { label: 'Typed Errors', slug: 'patterns/errors' },
            { label: 'Composing Workflows', slug: 'patterns/workflows' },
            { label: 'Composition Patterns', slug: 'patterns/composition' },
            { label: 'Observability with OpenTelemetry', slug: 'patterns/opentelemetry' },
            { label: 'Point-in-Time Capture', slug: 'patterns/point-in-time-capture' },
            { label: 'Resilience Patterns', slug: 'patterns/resilience' },
            { label: 'API Design Patterns', slug: 'patterns/api' },
          ],
        },
        {
          label: 'Enforcement',
          items: [
            { label: 'Configuration at Startup', slug: 'patterns/configuration' },
            { label: 'TypeScript Config', slug: 'patterns/typescript-config' },
            { label: 'Lint Rules', slug: 'patterns/lint' },
            { label: 'Monorepo Patterns', slug: 'patterns/monorepos' },
          ],
        },
        {
          label: 'Verification',
          items: [
            { label: 'Performance Testing', slug: 'patterns/performance' },
            { label: 'Conclusion', slug: 'patterns/conclusion' },
          ],
        },
        {
          label: 'Bonus',
          items: [
            { label: 'AI Coding Agents', slug: 'patterns/ai-agents' },
            { label: 'React Architecture', autogenerate: { directory: 'patterns/react' } },
          ],
        },
      ],
    }),
  ],
  vite: {
    plugins: [tailwindcss()],
  },
});
