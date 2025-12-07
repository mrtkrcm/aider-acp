# Agent Guidelines for aider-acp

## Build Commands
- `pnpm install` - Install dependencies
- `pnpm run build` - Compile TypeScript to JavaScript
- `node dist/index.js` - Run the compiled agent

## Code Style Guidelines
- **Language**: TypeScript with strict type checking
- **Imports**: Use ES6 imports, group by external libraries first, then internal modules
- **Naming**: camelCase for variables/functions, PascalCase for classes/interfaces
- **Types**: Use explicit types, avoid `any`, prefer interfaces over types for objects
- **Error Handling**: Use try/catch with specific error types, throw descriptive errors
- **Formatting**: 2-space indentation, single quotes for strings, semicolons required
- **Async**: Use async/await over Promises, handle rejections properly
- **Comments**: JSDoc for public APIs, inline comments for complex logic only

## Testing
- **Framework**: Vitest with v8 coverage
- `pnpm test` - Run all tests once
- `pnpm test:watch` - Run tests in watch mode
- `pnpm test:coverage` - Run tests with coverage report
- Run single test file: `pnpm test src/prompt-parser.test.ts`
- Run specific test: `pnpm test -t "parses valid /add command"`
- Tests are co-located with source (`*.test.ts` suffix)
- Coverage threshold: aim for >70% on parser modules

## Git Workflow
- Use `git diff` to track changes after Aider modifications
- Commit messages: imperative mood, start with action verb
- Branch naming: feature/, bugfix/, refactor/ prefixes
