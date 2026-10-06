# Contributing

Bug reports, feature requests and pull requests are welcome.

Before opening a PR, run what CI runs:

```bash
npm run build:all   # lint, then build (plugin + webapp typecheck + vite), then tests
```

`npm run format` before committing — `format:check` is enforced separately.

**One logical change per PR.** Refactors, behaviour changes, doc updates and
dependency bumps belong in separate PRs; a version bump is its own PR again.
Commits follow [Angular conventional commit](https://www.conventionalcommits.org/)
format, and branch names use hyphens rather than slashes.

## Licensing of contributions

signalk-espos-hmi-designer is licensed under the Apache License 2.0. By
submitting a pull request or patch, you agree that your contribution is
licensed under the same licence, as section 5 of it provides, and confirm that
you have the right to do so.
