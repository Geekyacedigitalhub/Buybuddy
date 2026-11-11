/*
 * Text size.
 *
 * The app is laid out in CSS pixels, so the phone's own "font size" slider does
 * not reach it — someone who has turned their system text up to Extra Large
 * opens BUYBUDDY and gets the same 13 px labels they could not read. There is no
 * web API to read that setting, so the app offers its own and remembers it.
 *
 * The whole page is scaled rather than the font, because a bigger font inside a
 * layout sized for a smaller one is how you get clipped prices and buttons that
 * overlap. Zooming the root and letting the layout reflow keeps every control
 * whole — which is why the sizes are modest (115% / 130%) and why each one was
 * checked for sideways scrolling at 320 px.
 */

const KEY = 'bb_textsize';

export const TEXT_SIZES = [
  { id: 'normal', label: 'Normal', hint: '100%' },
  { id: 'large', label: 'Large', hint: '115%' },
  { id: 'xlarge', label: 'Extra large', hint: '130%' },
];

export function getTextSize() {
  try {
    const v = localStorage.getItem(KEY);
    return TEXT_SIZES.some((t) => t.id === v) ? v : 'normal';
  } catch {
    return 'normal';
  }
}

export function applyTextSize(size) {
  const known = TEXT_SIZES.some((t) => t.id === size) ? size : 'normal';
  document.documentElement.setAttribute('data-textsize', known);
  try {
    localStorage.setItem(KEY, known);
  } catch {
    /* private mode: the choice lasts this session, which is better than throwing */
  }
  // the browser's own zoom and our zoom multiply; tell assistive tech the page
  // did not change meaning, only size
  window.dispatchEvent(new CustomEvent('bb:textsize', { detail: known }));
  return known;
}

export function initTextSize() {
  return applyTextSize(getTextSize());
}
