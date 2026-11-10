// Portable Entry Point (see CONTEXT.md): `@myorganiser/core/portable`.
//
// Carries only exports that hold on every runtime the Mobile App targets. The
// main entry point (`./index.ts`) also reaches `apiBaseUrl`, `settings` and the
// time-zone helper, which read browser globals. Mobile native code imports this
// library only through this file (ADR 0103). Anything exported here must not
// reach a browser global.
export * from './lib/time/localDateKey';
