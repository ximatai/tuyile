# Code and design provenance

Tuyile selectively adapts the engineering-blue visual tokens and approved sidebar layout from GPT Image Canvas (https://github.com/aruis/gpt-image-canvas), under its MIT license. The original copyright notice is retained in LICENSE.

Stage 1 reuses the approved palette (#0062B0 action, #F5F7FB background, #FFFFFF surface, #171F2A text, #E6ECF4 divider), sidebar dimensions and interaction conventions. Identity, API clients and project data flow are implemented against the new PostgreSQL architecture; the previous global request interception and SQLite runtime are not copied.

Third-party libraries retain their package licenses. No generated images, private assets or model credentials are included.

Standard UI controls use Ant Design 6.6.8 (https://github.com/ant-design/ant-design), MIT licensed. Tuyile supplies engineering-blue theme tokens and domain composition; control accessibility, dropdowns, table rendering, upload selection and confirmation dialogs use the library.

The pinned @rc-component/util 1.14.0 package (MIT) has a small tracked patch forwarding the application CSP nonce to its dynamic styles for scrollbar measurement and modal scroll locking. See patches/README.md; original package license notices remain intact.
