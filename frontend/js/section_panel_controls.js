// Controls for the floating section editor. This module does not alter model geometry.
const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export function makeSectionPanelDraggable(panel, handle, viewport) {
  const margin = 8;
  let drag = null;

  function position(left, top) {
    if (panel.hidden) return;
    const viewportBox = viewport.getBoundingClientRect();
    const panelBox = panel.getBoundingClientRect();
    const maxLeft = Math.max(margin, viewportBox.width - panelBox.width - margin);
    const maxTop = Math.max(margin, viewportBox.height - panelBox.height - margin);
    panel.style.left = `${Math.round(clamp(left, margin, maxLeft))}px`;
    panel.style.top = `${Math.round(clamp(top, margin, maxTop))}px`;
  }

  function keepInView() {
    if (panel.hidden) return;
    const viewportBox = viewport.getBoundingClientRect();
    const panelBox = panel.getBoundingClientRect();
    position(panelBox.left - viewportBox.left, panelBox.top - viewportBox.top);
  }

  handle.addEventListener('pointerdown', event => {
    if (event.button !== 0 || event.target.closest('button, input, a, select')) return;
    const panelBox = panel.getBoundingClientRect();
    drag = {
      pointerId: event.pointerId,
      deltaX: event.clientX - panelBox.left,
      deltaY: event.clientY - panelBox.top,
    };
    handle.setPointerCapture?.(event.pointerId);
    handle.classList.add('is-dragging');
    event.preventDefault();
  });

  handle.addEventListener('pointermove', event => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    const viewportBox = viewport.getBoundingClientRect();
    position(event.clientX - viewportBox.left - drag.deltaX,
      event.clientY - viewportBox.top - drag.deltaY);
  });

  const finish = event => {
    if (!drag || (event.pointerId !== undefined && drag.pointerId !== event.pointerId)) return;
    if (handle.hasPointerCapture?.(drag.pointerId)) handle.releasePointerCapture(drag.pointerId);
    drag = null;
    handle.classList.remove('is-dragging');
  };
  handle.addEventListener('pointerup', finish);
  handle.addEventListener('pointercancel', finish);
  handle.addEventListener('lostpointercapture', finish);

  handle.addEventListener('keydown', event => {
    if (event.target !== handle) return;
    const steps = {ArrowLeft: [-1, 0], ArrowRight: [1, 0],
      ArrowUp: [0, -1], ArrowDown: [0, 1]};
    if (!steps[event.key]) return;
    event.preventDefault();
    const viewportBox = viewport.getBoundingClientRect();
    const panelBox = panel.getBoundingClientRect();
    const amount = event.shiftKey ? 32 : 12;
    position(panelBox.left - viewportBox.left + steps[event.key][0] * amount,
      panelBox.top - viewportBox.top + steps[event.key][1] * amount);
  });

  window.addEventListener('resize', keepInView);
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(keepInView).observe(viewport);
  return {keepInView};
}

// Major values are directly selectable. The range itself remains a 1-unit
// control, with a gentle release snap close to the reference values.
export function makeSectionSliderPresets(slider, marks, values, options = {}) {
  const tolerance = options.snapTolerance ?? 2;
  const unit = options.unit ?? '';
  marks.style.setProperty('--section-mark-count', String(values.length));
  const buttons = values.map(value => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'section-preset';
    button.textContent = `${value}${unit}`;
    button.title = `Set ${slider.getAttribute('aria-label') || 'section'} to ${value}${unit}`;
    button.setAttribute('aria-label', button.title);
    button.dataset.value = String(value);
    button.addEventListener('click', () => {
      slider.value = String(value);
      slider.dispatchEvent(new Event('input', {bubbles: true}));
      slider.focus({preventScroll: true});
    });
    marks.append(button);
    return button;
  });

  function update() {
    const value = Number(slider.value);
    for (const button of buttons) {
      const selected = value === Number(button.dataset.value);
      button.setAttribute('aria-pressed', String(selected));
    }
  }
  let pointerAdjustment = false;
  slider.addEventListener('pointerdown', () => { pointerAdjustment = true; });
  slider.addEventListener('keydown', () => { pointerAdjustment = false; });
  slider.addEventListener('input', update);
  slider.addEventListener('change', () => {
    if (!pointerAdjustment) { update(); return; }
    pointerAdjustment = false;
    const value = Number(slider.value);
    const nearest = values.reduce((best, next) =>
      Math.abs(next - value) < Math.abs(best - value) ? next : best);
    if (Math.abs(nearest - value) <= tolerance && nearest !== value) {
      slider.value = String(nearest);
      slider.dispatchEvent(new Event('input', {bubbles: true}));
    }
    update();
  });
  update();
  return {update};
}
