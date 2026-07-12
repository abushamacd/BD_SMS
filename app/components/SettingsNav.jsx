// Sub-navigation shared by the Settings pages. The app nav has a single
// "Settings" entry; these are its sections.
const LINKS = [
  { href: "/app/settings", label: "Automations" },
  { href: "/app/settings/gateway", label: "SMS gateway" },
  { href: "/app/settings/blacklist", label: "Blacklist" },
];

export function SettingsNav({ current }) {
  return (
    <s-stack direction="inline" gap="base" alignItems="center">
      {LINKS.map((link) =>
        link.href === current ? (
          <s-text key={link.href} type="strong">
            {link.label}
          </s-text>
        ) : (
          <s-link key={link.href} href={link.href}>
            {link.label}
          </s-link>
        ),
      )}
    </s-stack>
  );
}
