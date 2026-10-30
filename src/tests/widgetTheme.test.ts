import {describe, expect, it} from 'vitest';
import {widgetThemeDeclaration} from '@/../scripts/widget-theme-css';

function corner(selector: string, value: string, prop = 'border-radius', file = '') {
  const declaration = {prop, value, parent: {type: 'rule', selector}, source: {input: {file}}};
  widgetThemeDeclaration(declaration);
  return declaration.value;
}

describe('widget compiled corners', () => {
  it('wraps fixed UI hues with an exact original fallback', () => {
    expect(corner('.input-field', '#26962f', 'color')).toBe('var(--widget-accent-color, #26962F)');
    expect(corner('.cropper', '#F0DB56', '--cropper-color')).toBe('var(--widget-accent-color, #F0DB56)');
    // PostCSS revisits modified declarations until they stop changing.
    expect(corner('.input-field', 'var(--widget-accent-color, #26962F)', 'color')).toBe('var(--widget-accent-color, #26962F)');
  });

  it('preserves neutral checkbox borders and shadows', () => {
    expect(corner('.checkbox-box-border', '2px solid #8d969c', 'border')).toBe('2px solid #8d969c');
    for(const alpha of ['.14', '.15']) {
      const shadow = `0 1px 2px rgba(16, 35, 47, ${alpha})`;
      expect(corner('.bubble-content', shadow, 'box-shadow')).toBe(shadow);
    }
  });

  it('keeps each surface default and its asymmetric shape as the fallback', () => {
    expect(corner('.popup-container', '2.5rem')).toBe('var(--widget-popup-radius, 2.5rem)');
    expect(corner('.btn-menu', '0 0 10px 10px')).toBe('var(--widget-menu-radius, 0 0 10px 10px)');
    expect(corner('.quote-like', 'var(--border-radius)')).toBe('var(--widget-media-radius, var(--border-radius))');
  });

  it('retains square and inherited corners, and intrinsic circles', () => {
    for(const value of ['0', '0px', 'inherit', 'unset', '50%']) expect(corner('.btn-icon', value)).toBe(value);
    expect(corner('.radio-field-main:after', '50%')).toBe('50%');
    expect(corner('.preloader-circular', '50%')).toBe('50%');
    expect(corner('.progress-line__filled:after', '50%')).toBe('50%');
    expect(corner('.media-editor__range-input-thumb', '50%')).toBe('50%');
  });

  it('makes avatars, go-down and send circles configurable', () => {
    expect(corner('.avatar', '50%')).toBe('var(--widget-avatar-radius, 50%)');
    expect(corner('.bubbles-go-down', '50%')).toBe('var(--widget-pill-radius, 50%)');
    expect(corner('.btn-send', '50%')).toBe('var(--widget-composer-radius, 50%)');
  });

  it('covers CSS modules and logical corners without hashed selectors', () => {
    expect(corner('.thumb', '.25rem', 'border-radius', '/components/mediaViewer/albumThumbs.module.scss')).toBe('var(--widget-media-radius, .25rem)');
    expect(corner('.field', '4px', 'border-start-start-radius')).toBe('var(--widget-button-radius, 4px)');
  });

  it('leaves existing widget and direction-specific bubble rules alone', () => {
    expect(corner('.bubble-content', '15px')).toBe('15px');
    expect(corner('.button', 'var(--widget-button-radius, 4px)')).toBe('var(--widget-button-radius, 4px)');
    expect(corner('.button', '5px', 'border-width')).toBe('5px');
  });
});
