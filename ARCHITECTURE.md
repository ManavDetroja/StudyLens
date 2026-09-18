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

Future source adapters, processing services, and IndexedDB persistence will supply the currently empty resource, note, flashcard, quiz, and analytics areas. Day 2 stores no learning data and does not implement processing or AI features.
