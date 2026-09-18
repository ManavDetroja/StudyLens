# StudyLens

StudyLens is a client-side learning workspace that will eventually turn source material into structured study aids. Day 2 provides the responsive application shell and UI foundation only; it does not process files, video links, text, AI requests, or analytics.

## Run locally

Open index.html in a modern browser. No installation, build step, backend, or external framework is required.

For the small route-registry test, run node --test tests/routes.test.mjs from the repository root.

## Current experience

- Hash-based single-page navigation for Dashboard, Library, Notes, Flashcards, Quizzes, Analytics, and Settings.
- Responsive desktop, tablet, and mobile layout, including an accessible mobile navigation panel.
- Honest empty states, zero-valued dashboard counters, and explanatory feature placeholders.
- Shared CSS patterns for buttons, cards, forms, badges, empty states, modal dialogs, and navigation.

## Project layout

    css/             Design tokens, layout, components, and responsive rules
    js/core/         Route metadata and future shared application primitives
    js/ui/           Navigation and modal UI behaviours
    js/features/     Feature-level UI placeholders
    ts/              Minimal domain types for future storage and processing

See ARCHITECTURE.md for navigation and responsive-design decisions, and TASKS.md for planned work.

## Current limitations

No resources are saved; IndexedDB is planned but not wired. Import, extraction, OCR, AI, notes, flashcards, quizzes, analytics, search, authentication, and backend services remain intentionally out of scope for Day 2.
