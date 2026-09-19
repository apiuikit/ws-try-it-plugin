import { describe, expect, it } from 'vitest';

import { PLUGIN_CSS } from './styles';

describe('PLUGIN_CSS', () => {
  const rules = PLUGIN_CSS.split('\n');

  it('scopes every selector under .aws-panel, to outrank the library reset on .aui-root button', () => {
    expect(rules.length).toBeGreaterThan(20);
    for (const rule of rules) {
      const selectors = rule.slice(0, rule.indexOf('{')).split(',');
      for (const selector of selectors) {
        expect(selector.trim()).toMatch(/^\.aws-panel(\s|\[|$)/);
      }
    }
  });

  it('does not double-prefix the panel rule itself', () => {
    expect(PLUGIN_CSS).not.toContain('.aws-panel .aws-panel');
    expect(rules.some((rule) => rule.startsWith('.aws-panel {'))).toBe(true);
  });

  it('gives buttons two-class selectors', () => {
    expect(PLUGIN_CSS).toContain('.aws-panel .aws-btn {');
    expect(PLUGIN_CSS).toContain('.aws-panel .aws-btn-send {');
    expect(PLUGIN_CSS).toContain('.aws-panel .aws-btn-primary {');
  });
});
