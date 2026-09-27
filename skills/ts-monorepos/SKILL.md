---
name: ts-monorepos
description: "Use when structuring TypeScript monorepos with pnpm workspaces, Turborepo, and tsup, or when debugging source across workspace packages."
---

## Overview

Structure TypeScript monorepos so you can debug source directly, share config without copy-paste, and keep bundles lean with explicit exports. The two failures to avoid: stepping into compiled JS instead of source, and running stale build artifacts.

## Layout

```
monorepo/
├── apps/web/
├── packages/sdk/
├── packages/config/          # optional shared configs
├── turbo.json
├── pnpm-workspace.yaml
├── tsconfig.json             # base config
└── eslint.config.js          # base rules
```

## TS Paths: Debug Source, Not Dist

Point consuming apps at `src/`, not `dist/`, so the debugger shows TypeScript. TypeScript 7 removed `baseUrl`; keep path values relative to the config file (`./src/*`, `../../packages/...`).

```json
// apps/web/tsconfig.json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "paths": {
      "@myorg/sdk/*": ["../../packages/sdk/src/*"],
      "@/*": ["./src/*"]
    }
  }
}
```

Your bundler must resolve the same paths:

- **Next.js**: `transpilePackages: ['@myorg/sdk']`
- **Vite**: `resolve: { tsconfigPaths: true }` (opt-in; default `false`)

Root config: `module` / `moduleResolution` of `ESNext` / `bundler` for apps; `nodenext` for Node packages.

Inside a package, use relative imports (`../logger`), not self-referencing path aliases.

For CI/production, use a `tsconfig.prod.json` that removes workspace paths so builds consume `dist/`.

## Shared Config: Extend and Override

Root `tsconfig.json` sets strict defaults with `noEmit: true`. Packages extend and override:

```json
// packages/sdk/tsconfig.json
{
  "extends": "../../tsconfig.json",
  "compilerOptions": {
    "noEmit": false,
    "outDir": "./dist",
    "rootDir": "./src",
    "declaration": true
  },
  "include": ["src/**/*"]
}
```

ESLint v9 flat config: import root config, spread, then add package-specific rules.

## Explicit Exports with tsup (No Barrels)

Ban `export * from` at package boundaries. Define explicit entry points:

```ts
// packages/sdk/tsup.config.ts
export default defineConfig({
  entry: {
    db: 'src/db/index.ts',
    customers: 'src/customers/index.ts',
    queries: 'src/queries/index.ts',
    logger: 'src/logger/index.ts',
  },
  format: ['esm'],
  dts: true,
  clean: true,
  sourcemap: true,
});
```

Map in `package.json` exports field (no root `"."` export):

```json
{
  "exports": {
    "./db": { "import": "./dist/db.js", "types": "./dist/db.d.ts" },
    "./queries": { "import": "./dist/queries.js", "types": "./dist/queries.d.ts" }
  },
  "sideEffects": false
}
```

Consumers import explicitly: `import { getOrder } from '@myorg/sdk/queries'`.

## pnpm Workspaces + Turborepo

```yaml
# pnpm-workspace.yaml
packages:
  - 'packages/*'
  - 'apps/*'
```

```json
// turbo.json
{
  "tasks": {
    "build": { "dependsOn": ["^build"], "outputs": ["dist/**", ".next/**"] },
    "test": { "dependsOn": ["build"] },
    "dev": { "cache": false, "persistent": true }
  }
}
```

`"^build"` means "build my dependencies first." Turborepo handles ordering and caching.

## Rules

1. **TS paths for source debugging**: apps point to `src/`, not `dist/`. Use relative imports within a package.
2. **Extend, don't copy**: root configs for tsconfig/ESLint/Prettier; packages extend and add specifics.
3. **Duplicate first, extract later**: wait for 3 proven uses and a stable interface before creating shared packages.
4. **Explicit exports only**: tsup entry points per module. Ban `export *` via ESLint `no-restricted-syntax`.
5. **Orchestrate with Turborepo**: `dependsOn: ["^build"]` for automatic dependency ordering.
