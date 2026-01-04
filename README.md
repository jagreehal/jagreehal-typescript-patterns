# TypeScript Patterns

Production-ready patterns for building **testable**, **type-safe**, and **observable** TypeScript applications.

This documentation site is built with [Astro Starlight](https://starlight.astro.build/) and covers a complete architecture for TypeScript applications, from testing and dependency injection to observability and performance.

## 🚀 Getting Started

### Prerequisites

- Node.js 18+ 
- pnpm (recommended) or npm

### Installation

```bash
pnpm install
```

### Development

Start the local development server:

```bash
pnpm dev
```

The site will be available at `http://localhost:4321/`

For local development without the base path, use:

```bash
BASE=/ pnpm dev
```

### Build

Build the site for production:

```bash
pnpm build
```

The output will be in the `dist/` directory.

### Preview

Preview the production build locally:

```bash
pnpm preview
```

## 📚 Documentation Structure

The documentation is organized into three main sections:

### Core Patterns
- **Testing & Testability**: Understanding why these patterns exist
- **Functions Over Classes**: The `fn(args, deps)` pattern for explicit dependencies
- **Validation at the Boundary**: Using Zod schemas for input validation
- **Typed Errors**: Result types for explicit error handling
- **Observability**: OpenTelemetry integration
- **Resilience**: Retries, timeouts, and circuit breakers

### Enforcement
- **Configuration**: Environment variable validation at startup
- **TypeScript Config**: Strict compiler flags
- **ESLint Rules**: Pattern enforcement through linting

### Verification
- **Performance Testing**: Load testing and chaos engineering
- **Conclusion**: Complete architecture overview

## 🛠️ Tech Stack

- [Astro](https://astro.build/) - Static site generator
- [Starlight](https://starlight.astro.build/) - Documentation framework
- [Tailwind CSS](https://tailwindcss.com/) - Styling
- [Mermaid](https://mermaid.js.org/) - Diagram rendering
- [Starlight Theme Nova](https://github.com/withastro/starlight-theme-nova) - Theme

## 📖 Key Concepts

Everything starts with a simple function signature:

```typescript
fn(args, deps)
```

- **args**: What varies per call (userId, input data)
- **deps**: Injected collaborators (database, logger, other functions)

This single pattern unlocks testability, composability, and clarity.

## 🌐 Deployment

This site is automatically deployed to GitHub Pages using GitHub Actions.

### Automatic Deployment

When you push to the `main` branch, the site will automatically build and deploy to:
https://jagreehal.github.io/jagreehal-typescript-patterns/

The deployment workflow (`.github/workflows/deploy.yml`) will:
1. Build the Astro site with the correct base path
2. Deploy it to GitHub Pages

### Manual Deployment

You can also trigger a deployment manually:
1. Go to the **Actions** tab in your GitHub repository
2. Select **Deploy to GitHub Pages** workflow
3. Click **Run workflow**

### GitHub Pages Settings

Make sure GitHub Pages is configured in your repository settings:
1. Go to **Settings** → **Pages**
2. Under **Source**, select **GitHub Actions**

The base path (`/jagreehal-typescript-patterns`) is automatically configured in `astro.config.mjs` for production builds.

## 📝 Contributing

This is a documentation site. Content is in `src/content/docs/`. Each markdown file represents a page in the documentation.

## 🔗 Links

- [Live Site](https://jagreehal.github.io/jagreehal-typescript-patterns/)
- [GitHub Repository](https://github.com/jagreehal/jagreehal-typescript-patterns)
- [Starlight Documentation](https://starlight.astro.build/)
- [Astro Documentation](https://docs.astro.build/)
