// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';
import starlightThemeNova from 'starlight-theme-nova';
import tailwindcss from '@tailwindcss/vite';
import astroMermaid from 'astro-mermaid';

// https://astro.build/config
export default defineConfig({
  site: 'https://jagreehal.github.io',
  // Use base path for GitHub Pages deployment
  // For local development, you can override with: BASE=/ pnpm dev
  base: process.env.BASE || '/jagreehal-typescript-patterns',
  integrations: [
    astroMermaid(),
    starlight({
      title: 'TypeScript Patterns',
      description: 'Production-ready patterns for testable, type-safe TypeScript applications',
      plugins: [starlightThemeNova()],
      tableOfContents: false,
      social: [
        { icon: 'github', label: 'GitHub', href: 'https://github.com/jagreehal/jagreehal-typescript-patterns' },
      ],
      sidebar: [
        {
          label: 'Core Patterns',
          items: [
            { label: 'Testing & Testability', slug: 'patterns/testing' },
            { label: 'Functions Over Classes', slug: 'patterns/functions' },
            { label: 'Validation at the Boundary', slug: 'patterns/validation' },
            { label: 'Typed Errors', slug: 'patterns/errors' },
            { label: 'Composing Workflows', slug: 'patterns/workflows' },
            { label: 'Observability with OpenTelemetry', slug: 'patterns/opentelemetry' },
            { label: 'Resilience Patterns', slug: 'patterns/resilience' },
          ],
        },
        {
          label: 'Enforcement',
          items: [
            { label: 'Configuration at Startup', slug: 'patterns/configuration' },
            { label: 'TypeScript Config', slug: 'patterns/typescript-config' },
            { label: 'ESLint Rules', slug: 'patterns/eslint' },
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
            { label: 'React Architecture', slug: 'patterns/react' },
          ],
        },
      ],
    }),
  ],
  vite: {
    plugins: [tailwindcss()],
  },
});
