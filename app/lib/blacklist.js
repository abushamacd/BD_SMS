// Blacklist display constants. Isomorphic — the page renders these, so they must
// not live in a *.server module (importing one from a component would pull Prisma
// into the browser bundle).

export const SOURCES = [
  { value: "STOP", label: "Replied STOP" },
  { value: "MANUAL", label: "Added manually" },
  { value: "DND", label: "Operator DND list" },
  { value: "BOUNCED", label: "Repeatedly undeliverable" },
];

export const SOURCE_LABEL = Object.fromEntries(
  SOURCES.map((source) => [source.value, source.label]),
);

export const SOURCE_TONE = {
  STOP: "critical",
  MANUAL: "neutral",
  DND: "warning",
  BOUNCED: "warning",
};

export const PAGE_SIZE = 100;
