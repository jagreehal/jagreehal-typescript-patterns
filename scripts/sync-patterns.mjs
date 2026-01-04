import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const POSTS_DIR = '/Users/jreehal/dev/js/typescript-classes-functions/src/posts';
const __dirname = dirname(fileURLToPath(import.meta.url));
const DOCS_DIR = join(__dirname, '..', 'src', 'content', 'docs', 'patterns');

const metadata = {
  testing: {
    title: 'Why This Pattern Exists',
    description: 'Learn why testability drives design and how explicit dependency injection makes testing simpler than vi.mock.',
  },
  functions: {
    title: 'Functions Over Classes',
    description: 'Learn the fn(args, deps) pattern for explicit dependency injection, making your code testable and composable.',
  },
  validation: {
    title: 'Validation at the Boundary',
    description: 'Use Zod schemas to validate input at the edges of your system, keeping business functions focused on logic.',
  },
  errors: {
    title: 'Typed Errors',
    description: 'Make failure explicit with Result types instead of throwing exceptions. Composable error handling with railway-oriented programming.',
  },
  opentelemetry: {
    title: 'Functions + OpenTelemetry',
    description: 'Add observability to your functions without cluttering business logic. Distributed tracing with the trace() wrapper pattern.',
  },
  resilience: {
    title: 'Resilience Patterns',
    description: 'Add retries, timeouts, and circuit breakers to handle transient failures without cluttering your business logic.',
  },
  configuration: {
    title: 'Configuration at the Boundary',
    description: 'Validate and type configuration at startup. Handle secrets securely with secret managers.',
  },
  'typescript-config': {
    title: 'Enforcing Patterns with TypeScript',
    description: 'Use strict TypeScript compiler flags to enforce patterns at compile time. Beyond strict mode with noUncheckedIndexedAccess.',
  },
  eslint: {
    title: 'Enforcing Patterns with ESLint',
    description: 'Use ESLint rules to enforce architectural boundaries, function signatures, and import patterns at lint time.',
  },
  performance: {
    title: 'Performance Testing',
    description: 'Use load tests to find bottlenecks and chaos tests to verify resilience patterns work under pressure.',
  },
  conclusion: {
    title: 'What We\'ve Built',
    description: 'A complete architecture for TypeScript applications with testability, observability, and enforcement built in.',
  },
};

function slugFromFile(filename) {
  const noPrefix = filename.replace(/^\d+-/, '').replace(/\.md$/, '');
  return noPrefix.startsWith('patterns-') ? noPrefix.slice('patterns-'.length) : noPrefix;
}

function normalizeLinks(markdown) {
  return markdown.replace(/\(\/patterns-/g, '(/patterns/');
}

const files = readdirSync(POSTS_DIR).filter((file) => file.endsWith('.md')).sort();

for (const file of files) {
  const slug = slugFromFile(file);
  const meta = metadata[slug];

  if (!meta) {
    throw new Error(`Missing metadata for slug "${slug}" (source file: ${file})`);
  }

  const sourcePath = join(POSTS_DIR, file);
  const targetPath = join(DOCS_DIR, `${slug}.md`);

  const body = normalizeLinks(readFileSync(sourcePath, 'utf8')).trimStart();
  const frontmatter = [
    '---',
    `title: ${meta.title}`,
    `description: ${meta.description}`,
    '---',
    '',
  ].join('\n');

  writeFileSync(targetPath, `${frontmatter}\n${body}\n`, 'utf8');
  console.log(`Synced ${file} -> ${slug}.md`);
}
