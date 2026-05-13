# Contributing

Contributions are welcome. Please follow these guidelines.

## Submission Guidelines

1. Fork the repo
2. Create a feature branch from `main`
3. Include tests for all changes
4. Follow the coding rules below
5. Run `npm run lint` and `npm test` and ensure both pass
6. Submit a Pull Request

## Coding Rules

- All features or bug fixes must be tested
- Follow the Prettier config in `.prettierrc`
- TypeScript strict mode is enabled (`strict: true`, `strictNullChecks: true`)
- No `any` types. Use `unknown` or proper generics
- No type assertions (`as X`). Use type guards for narrowing
- Run `npm run format` before committing

## Commit Message Format

Conventional Commits format:

```
<type>(<scope>): <subject>
```

Types: feat, fix, docs, style, refactor, perf, test, build, ci, chore

Subject: imperative, present tense, lowercase, no trailing period.

## Code of Conduct

This project follows the [Contributor Covenant v2.0](https://contributor-covenant.org/version/2/0/code_of_conduct).
