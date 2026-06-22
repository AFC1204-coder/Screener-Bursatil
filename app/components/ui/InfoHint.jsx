export function InfoHint({ text, tone = "" }) {
  if (!text) return null;
  return <span className={`infoHint ${tone}`} tabIndex="0" aria-label={text}>
    <span aria-hidden="true">i</span>
    <em aria-hidden="true">{text}</em>
  </span>;
}
