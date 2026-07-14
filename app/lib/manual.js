// Isomorphic — the Send SMS page quotes this limit and the server enforces it, so
// the number the merchant is shown and the number we refuse at cannot drift
// apart. It must not live in manual.server.js: a component importing that would
// pull Prisma into the browser bundle.

/** Beyond this, it is a campaign: it needs pause/resume, progress and a record. */
export const MAX_RECIPIENTS = 500;
