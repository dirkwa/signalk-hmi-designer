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

By submitting a pull request or patch, you grant Dirk Wahrheit a perpetual,
worldwide, non-exclusive, royalty-free, irrevocable license to use, reproduce,
modify, publish, sublicense and distribute your contribution, and to relicense
it under any terms, including as part of signalk-hmi-designer releases. You
confirm that you have the right to grant this.

This keeps future licensing decisions for the project in one pair of hands. It
does not affect what you may do with your own contribution elsewhere — you keep
your copyright in it.
