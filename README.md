# StudyLens

StudyLens is a client-side learning workspace that will eventually turn source material into structured study aids. Day 3 adds a versioned IndexedDB persistence foundation for Resource records; it does not import or process source material.

## Run locally

Open index.html in a modern browser. No installation, build step, backend, or external framework is required.

Run the Node checks with:

    node --test tests/routes.test.mjs tests/resourceValidation.test.mjs tests/storage.browser.test.mjs

Node does not provide native IndexedDB in this project environment, so the storage browser test is reported as skipped there. To run the native IndexedDB CRUD suite, open tests/storage.browser.html in a modern browser. It uses a uniquely named temporary test database and deletes it after completion.

## Current experience

- Hash-based single-page navigation for Dashboard, Library, Notes, Flashcards, Quizzes, Analytics, and Settings.
- Responsive desktop, tablet, and mobile layout, including an accessible mobile navigation panel.
- Honest empty states, zero-valued dashboard counters, and explanatory feature placeholders.
- Shared CSS patterns for buttons, cards, forms, badges, empty states, modal dialogs, and navigation.
- StudyLensDB initialises when the application starts; the Total Resources card reads the real resources count.
- Storage failures are surfaced in an accessible UI notice instead of being ignored.

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

Resource storage is ready, but no Day 3 screen creates resources yet. Import, extraction, OCR, AI, notes, flashcards, quizzes, analytics, search, authentication, and backend services remain intentionally out of scope.
