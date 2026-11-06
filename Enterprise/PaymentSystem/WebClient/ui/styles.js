'use strict';

const styles = `
:root { color-scheme: light dark; --accent: #2563eb; --muted: #6b7280; }
* { box-sizing: border-box; }
body { margin: 0; font: 14px/1.45 system-ui, sans-serif; }
main { max-width: 980px; margin: 0 auto; padding: 16px; }
header {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
  justify-content: space-between;
}
h1 { font-size: 20px; margin: 0; }
h2 { font-size: 15px; margin: 0 0 8px; }
section {
  border: 1px solid color-mix(in srgb, currentColor 15%, transparent);
  border-radius: 8px;
  padding: 12px;
  margin-top: 12px;
}
form, .row { display: flex; flex-wrap: wrap; gap: 8px; align-items: end; }
label { display: grid; gap: 2px; font-size: 12px; color: var(--muted); }
input, select, button {
  font: inherit;
  padding: 6px 8px;
  border-radius: 6px;
  border: 1px solid color-mix(in srgb, currentColor 25%, transparent);
  background: transparent;
  color: inherit;
}
button {
  cursor: pointer;
  background: var(--accent);
  color: white;
  border-color: var(--accent);
}
button.secondary { background: transparent; color: inherit; }
button:disabled { opacity: .5; cursor: default; }
table { width: 100%; border-collapse: collapse; }
th, td {
  text-align: left;
  padding: 6px 4px;
  border-bottom: 1px solid color-mix(in srgb, currentColor 10%, transparent);
}
.tokens { display: flex; flex-wrap: wrap; gap: 6px; }
.token {
  padding: 2px 8px;
  border-radius: 999px;
  border: 1px solid color-mix(in srgb, currentColor 25%, transparent);
}
.status { font-weight: 600; }
.message { padding: 8px; border-radius: 6px; margin-top: 12px; }
.message.error { background: color-mix(in srgb, #dc2626 15%, transparent); }
.message.info { background: color-mix(in srgb, #16a34a 15%, transparent); }
.muted { color: var(--muted); }
.scroll { overflow-x: auto; }
`;

module.exports = { styles };
