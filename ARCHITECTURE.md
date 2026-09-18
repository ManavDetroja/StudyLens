# Architecture overview

## Day 2 application shell

StudyLens is a client-side, framework-free single-page application. The root HTML contains the semantic, static application shell and one section per route. JavaScript changes only the active section, page metadata, and mobile navigation state; it does not generate the static UI.

## Navigation

js/core/routes.js is the single source of route metadata. js/ui/navigation.js maps the URL hash to a route, updates the active navigation item and visible page, and keeps browser back/forward navigation working without a full reload. The supported routes are #dashboard, #library, #notes, #flashcards, #quizzes, #analytics, and #settings.

This lightweight hash approach was selected over a router because the project is a static, client-side application and does not need framework routing or server rewrite rules.

## UI modules

- js/app.js only boots independent modules.
- js/ui/navigation.js owns route and responsive-navigation state.
- js/ui/modal.js exposes the shared native-dialog modal.
- js/features/resourceForm.js owns the Day 2 quick-action placeholders; it does not upload or process anything.
- CSS is split into design tokens (variables.css), layout (main.css), reusable patterns (components.css), and breakpoints (responsive.css).

## Responsive strategy

Desktop uses a persistent sidebar. Tablet preserves the compact sidebar while content cards reflow. Below 768px the sidebar becomes an off-canvas navigation panel opened by a labelled header button; the backdrop and Escape key close it. The layout has a 320px minimum width and grids collapse progressively to prevent horizontal overflow.

## Future data flow

Future source adapters and processing services will supply the currently empty resource, note, flashcard, quiz, and analytics areas. Day 3 stores resource metadata only and does not implement source ingestion, processing, or AI features.

## IndexedDB storage foundation

StudyLens uses the browser native IndexedDB API behind a storage boundary:

    UI
      ↓
    Feature logic
      ↓
    Resource repository
      ↓
    IndexedDB connection

The UI never opens IndexedDB directly. js/features/storageStatus.js coordinates application startup and Dashboard resource-count display. It calls the storage modules and renders an accessible error notice if local storage cannot be opened.

### Database schema

- Database: StudyLensDB
- Schema version: 1
- Object store: resources, keyed by the immutable Resource id
- Non-unique indexes: type, createdAt, updatedAt, and status

The indexes support future resource-type views, processing queues, chronological listings, and recent-resource sorting without adding unneeded stores today.

### Storage modules

- js/storage/databaseSchema.js owns database constants, resource-store creation, indexes, and upgrade steps.
- js/storage/indexedDB.js owns a cached, version-aware database connection and database availability errors.
- js/storage/resourceValidation.js owns resource creation, UUID generation, field validation, and immutable-field checks.
- js/storage/resourceStore.js exposes the repository API and converts native requests into clean promises.

### Migration strategy

Schema changes must increment DATABASE_VERSION and add a version-specific migration in upgradeDatabaseSchema. Later releases can add notes, flashcards, quizzes, or analytics stores through an upgrade transaction without replacing the resources store or existing user data.

### Resource model

Resource records contain id, title, type, source, content, createdAt, updatedAt, status, tags, and metadata. IDs are generated with crypto.randomUUID when a record is created. The id and createdAt fields cannot be changed by updates; updatedAt is refreshed automatically.
