# Tuyile repository instructions

Read docs/README.md, docs/product-baseline.md, docs/architecture.md and docs/delivery-roadmap.md before product work. Read an active engineering plan when one is listed in docs/delivery-roadmap.md; completed plans in Git history are historical evidence, not pending instructions. docs/development.md defines local commands and isolation.

- Main agent implements each complete stage personally. One stage, one commit, then self-review and one independent reviewer; fixes amend the stage commit. Do not delegate implementation or split stages into smaller deliveries.
- Node version is pinned in .node-version; pnpm is pinned in package.json. Use corepack pnpm when the host's pnpm wrapper selects another runtime.
- Choose verification by change risk using docs/development.md#验证选择. Start with the smallest check that reproduces the issue; run only affected checks during iteration. Full build, database, browser and Docker suites are not mandatory for every change. Run broader regression at integration/release boundaries or when shared behavior is affected. Report what ran, what was intentionally omitted and why; never report a blocked check as passed.
- Tests use only the dedicated tuyile_test database on loopback port 55440. Do not point reset/seed scripts at any other database. Never run integration and browser tests concurrently because both reset this database.
- The old project and LaunchAgent are preserved. Never build in the original checkout, migrate its data, or copy its .env/data/dist/node_modules into this project.
- Reuse approved engineering-blue tokens and page behavior, preserving license notices; replace global fetch interception, implicit project state and browser-owned execution.
- Private data, credentials, logs, generated files and screenshots stay outside Git, normally in ignored .codex-temp/ or runtime volumes. Never print environment files or expanded Compose config. Use docker compose config --quiet --no-env-resolution.
- Public deployment, real private-data migration and paid model calls require their corresponding explicit authorization. Local synthetic development/testing is authorized.

- Use mature mainstream UI components for standard controls and interactions. Ant Design owns inputs, selects, tables, upload triggers, alerts and confirmation dialogs; shared wrappers provide product tokens and layout, not replacement widget implementations. Custom components are for domain behavior and the canvas.

- UI targets medium and large desktop screens. Follow the approved A mockup and B collapsed rail described in docs/ui-direction.md. Do not add small-screen-specific work or substitute a new layout direction.

- Original contributions are Apache-2.0; preserve upstream MIT and all dependency notices. Run check:release and redacted Gitleaks checks for publication changes. Do not rewrite Git history, publish a remote repository/image, or treat ignored working files as safe to upload without the corresponding authorization.
