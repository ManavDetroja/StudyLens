# StudyLens

StudyLens is a client-side learning workspace that will eventually turn source material into structured study aids. Day 4 lets you save, read, edit, and delete manually entered text resources in local IndexedDB.

## Run locally

Serve the repository root with any local static HTTP server, then open its local address in a modern browser. No installation, build step, backend, or external framework is required. Serving over HTTP gives IndexedDB a stable browser origin for manual testing.

Run the Node checks with:

    node --test tests/routes.test.mjs tests/resourceValidation.test.mjs tests/textResourceInput.test.mjs tests/resourceViewer.test.mjs tests/storage.browser.test.mjs

Node does not provide native IndexedDB in this project environment, so the storage browser test is reported as skipped there. To run the native IndexedDB CRUD suite, serve the repository root and open tests/storage.browser.html in a modern browser. It uses a uniquely named temporary test database and deletes it after completion.

## Current experience

- Hash-based single-page navigation for Dashboard, Library, Notes, Flashcards, Quizzes, Analytics, and Settings.
- Responsive desktop, tablet, and mobile layout, including an accessible mobile navigation panel.
- Honest empty states, zero-valued dashboard counters, and explanatory feature placeholders.
- Shared CSS patterns for buttons, cards, forms, badges, empty states, modal dialogs, and navigation.
- StudyLensDB initialises when the application starts; the Total Resources card reads the real resources count.
- Storage failures are surfaced in an accessible UI notice instead of being ignored.
- Add Text saves a title, plain-text content, and optional comma-separated tags locally.
- Dashboard recent resources and Library cards refresh after create, edit, or delete.
- A resource reader displays user content as plain text and supports editing text resources or confirming their deletion.

## Project layout

    css/             Design tokens, layout, components, and responsive rules
    js/core/         Route metadata and future shared application primitives
    js/ui/           Navigation and modal UI behaviours
    js/features/     Feature-level UI placeholders
    js/storage/      Versioned IndexedDB connection, schema, validation, and repository
    tests/           Node checks and a self-cleaning native-browser storage suite
    ts/              Minimal domain types for future storage and processing

See ARCHITECTURE.md for navigation and responsive-design decisions, and TASKS.md for planned work.

## Current limitations

Only manual text resources are available. Import, extraction, OCR, AI, notes, flashcards, quizzes, analytics, advanced search, authentication, and backend services remain intentionally out of scope.
