# Dependency patches

`@rc-component/util@1.14.0` is pinned by Ant Design 6.6.8. Scrollbar measurement and modal scroll locking call its dynamic CSS helper without forwarding the application's CSP nonce. This causes production CSP violations when tables or confirmation dialogs mount.

The patch makes this library's dynamic CSS helper fall back to the per-response nonce from Tuyile's `meta[name="csp-nonce"]` when its caller supplies none, in both ESM and CommonJS builds. Explicit caller nonces still take precedence. It does not replace component behavior, patch globals or allow arbitrary inline styles. Vite development has no nonce meta and retains the library's default behavior. The original package license is retained.

`test:docker` opens the actual built application, exercises Select/Table/Modal and asserts no CSP violations. Reassess this patch when upgrading the pinned dependency; remove it when upstream supports these nonce paths.
