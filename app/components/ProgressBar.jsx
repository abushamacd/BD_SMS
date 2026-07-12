// Polaris has no progress component, so this is built from Box primitives —
// a subdued track with a filled bar sized as a percentage of it.
export function ProgressBar({ value, total, tone = "success" }) {
  const percent = total > 0 ? Math.min(100, Math.round((value / total) * 100)) : 0;

  return (
    <s-stack direction="block" gap="small-300">
      <s-box background="subdued" borderRadius="max" padding="none" blockSize="8px">
        <s-box
          background="strong"
          borderRadius="max"
          blockSize="8px"
          inlineSize={`${percent}%`}
          accessibilityRole="presentation"
        />
      </s-box>

      <s-stack direction="inline" gap="small" justifyContent="space-between">
        <s-text color="subdued">
          {value.toLocaleString()} of {total.toLocaleString()} sent
        </s-text>
        <s-badge tone={tone}>{percent}%</s-badge>
      </s-stack>
    </s-stack>
  );
}
