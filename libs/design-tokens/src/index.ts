export * from './generated/tokens';
export * from './generated/roles';

// Two generated modules, both data: the primitive tier and the Semantic Role
// tier resolved once per colour mode. `generated/roles.css` is a stylesheet,
// not a module — the web application imports it from its own stylesheet, and
// nothing should reach it through this index. `generated/roles.ts` is the same
// roles for a consumer that has no stylesheet to resolve a CSS variable
// through, which on this repo means the Mobile App theme.
//
// Nothing CommonJS belongs here either. This index is reachable from browser
// bundles, and a `module.exports = {...}` re-export dragged into one of them is
// what broke the Email Shell Storybook chunk during a Storybook build with
// `Cannot set properties of undefined (setting 'exports')`. If a build config
// ever needs a CommonJS artifact from this library, import the generated file
// by path.
