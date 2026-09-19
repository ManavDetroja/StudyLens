# StudyLens development rules

- Preserve the vanilla HTML, CSS, and ES module architecture; do not add frontend frameworks.
- Keep TypeScript limited to shared type declarations.
- Keep all persistence in IndexedDB and access it only through repository modules.
- Do not introduce a backend, secrets, API keys, or raw IndexedDB calls in UI code.
- Keep feature modules focused, retain accessible semantic markup, and update documentation when architecture changes.
- Do not implement future roadmap features unless the active task explicitly includes them.
