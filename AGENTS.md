# Tuyile repository instructions

Read docs/product-baseline.md, docs/architecture.md, docs/delivery-roadmap.md and the active engineering plan before product work. docs/development.md defines local commands and isolation.

- Main agent implements each complete stage personally. One stage, one commit, then self-review and one independent reviewer; fixes amend the stage commit. Do not delegate implementation or split stages into smaller deliveries.
- Node version is pinned in .node-version; pnpm is pinned in package.json. Use corepack pnpm when the host's pnpm wrapper selects another runtime.
- Before completing a code stage run typecheck/build and relevant unit, real PostgreSQL integration, browser and Docker checks. Never report a blocked check as passed.
- Tests use only the dedicated tuyile_test database on loopback port 55440. Do not point reset/seed scripts at any other database. Never run integration and browser tests concurrently because both reset this database.
- The old project and LaunchAgent are preserved. Never build in the original checkout, migrate its data, or copy its .env/data/dist/node_modules into this project.
- Reuse approved engineering-blue tokens and page behavior, preserving license notices; replace global fetch interception, implicit project state and browser-owned execution.
- Private data, credentials, logs, generated files and screenshots stay outside Git, normally in ignored .codex-temp/ or runtime volumes. Never print environment files or expanded Compose config. Use docker compose config --quiet --no-env-resolution.
- Public deployment, real private-data migration and paid model calls require their corresponding explicit authorization. Local synthetic development/testing is authorized.

- Use mature mainstream UI components for standard controls and interactions. Ant Design owns inputs, selects, tables, upload triggers, alerts and confirmation dialogs; shared wrappers provide product tokens and layout, not replacement widget implementations. Custom components are for domain behavior and the canvas.

- UI targets medium and large desktop screens. Follow the approved A mockup and B collapsed rail described in docs/ui-direction.md. Do not add small-screen-specific work or substitute a new layout direction.
