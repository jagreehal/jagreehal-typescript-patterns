---
name: ts-eslint
description: "Use when configuring ESLint with boundary enforcement, object params, and server import rules in TypeScript projects."
---

## Overview

Enforce architectural patterns through ESLint rules that fail the build, instead of relying on documentation or code review. Lint rules are deterministic; prompting is probabilistic. Use flat config (`eslint.config.mjs`).

## Key Plugins

| Plugin | Purpose |
|--------|---------|
| `eslint-plugin-boundaries` | Directional layer imports (domain/infra/api) |
| `eslint-plugin-prefer-object-params` | Enforce `fn(args: {...})` over positional params |
| `eslint-plugin-no-server-imports` | Prevent server code leaking to client bundles |

## Architectural Boundaries with eslint-plugin-boundaries

Define layers and directional rules. Domain is pure; dependencies point inward.

```javascript
import boundaries from 'eslint-plugin-boundaries';

// In eslint.config.mjs flat config array:
{
  plugins: { boundaries },
  settings: {
    'boundaries/elements': [
      { type: 'domain', pattern: 'src/domain/**' },
      { type: 'infra', pattern: 'src/infra/**' },
      { type: 'api', pattern: 'src/api/**' },
    ],
  },
  rules: {
    'boundaries/element-types': ['error', {
      default: 'disallow',
      rules: [
        { from: 'domain', allow: ['domain'] },
        { from: 'infra', allow: ['domain', 'infra'] },
        { from: 'api', allow: ['domain', 'infra', 'api'] },
      ],
    }],
  },
}
```

For module privacy, mark internal paths with `private: true` and enable `boundaries/no-private`.

## Object Params with eslint-plugin-prefer-object-params

```javascript
import preferObjectParams from 'eslint-plugin-prefer-object-params';

{
  plugins: { 'prefer-object-params': preferObjectParams },
  rules: {
    'prefer-object-params/prefer-object-params': 'error',
  },
}
```

Ignores single-param functions, constructors, and test files. Turn off in test overrides:

```javascript
{ files: ['**/*.test.ts', '**/*.spec.ts'], rules: { 'prefer-object-params/prefer-object-params': 'off' } }
```

## Server Import Guard with eslint-plugin-no-server-imports

Prevents importing server files (e.g., database, env access) into client code:

```javascript
import noServerImports from 'eslint-plugin-no-server-imports';

{
  plugins: { 'no-server-imports': noServerImports },
  rules: {
    'no-server-imports/no-server-imports': ['error', {
      serverFilePatterns: ['**/*.server.ts', '**/*.server.tsx', '**/server/**', '**/api/**'],
    }],
  },
}
```

Also use `import/no-nodejs-modules` scoped to client files to block `fs`, `crypto`, etc.

## Complete Flat Config Example

```javascript
// eslint.config.mjs
import js from '@eslint/js';
import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';
import preferObjectParams from 'eslint-plugin-prefer-object-params';
import globals from 'globals';

export default [
  js.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsparser,
      parserOptions: { ecmaVersion: 2022, sourceType: 'module', project: './tsconfig.json' },
      globals: { ...globals.node, ...globals.es2022 },
    },
    plugins: {
      '@typescript-eslint': tseslint,
      'prefer-object-params': preferObjectParams,
    },
    rules: {
      ...tseslint.configs.recommended.rules,
      'no-restricted-imports': ['error', {
        patterns: [{ group: ['**/infra/**'], message: 'Inject dependencies instead.' }],
      }],
      'prefer-object-params/prefer-object-params': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/no-explicit-any': 'warn',
      'prefer-const': 'error',
      'no-var': 'error',
    },
  },
  {
    files: ['**/*.test.ts', '**/*.spec.ts'],
    rules: { 'prefer-object-params/prefer-object-params': 'off' },
  },
];
```

## Rules

1. **Enforce boundaries.** Use `eslint-plugin-boundaries` or `no-restricted-imports` to block domain-to-infra imports.
2. **Enforce object params.** Use `prefer-object-params` and set it to `'error'`, not `'warn'`.
3. **Enforce server/client separation.** Use `no-server-imports` and `import/no-nodejs-modules` for client files.
4. **Fail the build.** All pattern rules must be `'error'`. Warnings get ignored.
