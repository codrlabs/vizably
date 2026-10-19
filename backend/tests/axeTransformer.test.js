const test = require('node:test');
const assert = require('node:assert/strict');

const { transform, bucketFor } = require('../services/axeTransformer');

test('bucketFor maps multimedia tags', () => {
  assert.equal(bucketFor(['cat.text-alternatives']), 'multimedia');
  assert.equal(bucketFor(['cat.media']), 'multimedia');
});

test('bucketFor maps structure/semantics tags', () => {
  assert.equal(bucketFor(['cat.structure']), 'structureAndSemantics');
  assert.equal(bucketFor(['cat.aria']), 'structureAndSemantics');
});

test('bucketFor falls back to visualAccessibility', () => {
  assert.equal(bucketFor([]), 'visualAccessibility');
  assert.equal(bucketFor(['cat.color']), 'visualAccessibility');
});

test('transform handles empty / invalid input safely', () => {
  const empty = transform(null);
  assert.deepEqual(empty.problems.visualAccessibility, []);
  assert.deepEqual(empty.whatsGood, []);
});

test('transform produces a ScanResult from a synthetic axe payload', () => {
  const fixture = {
    violations: [
      {
        id: 'color-contrast',
        help: 'Elements must have sufficient color contrast',
        description: 'Ensures the contrast between foreground and background colors meets WCAG AA',
        helpUrl: 'https://dequeuniversity.com/rules/axe/4.7/color-contrast',
        impact: 'serious',
        tags: ['cat.color', 'wcag2aa'],
        nodes: [
          {
            html: '<p style="color:#999">x</p>',
            target: ['p'],
            failureSummary: 'Fix any of the following: insufficient contrast',
          },
        ],
      },
      {
        id: 'image-alt',
        help: 'Images must have alternate text',
        description: 'Ensures <img> elements have alternate text',
        helpUrl: 'https://dequeuniversity.com/rules/axe/4.7/image-alt',
        impact: 'critical',
        tags: ['cat.text-alternatives', 'wcag2a'],
        nodes: [{ html: '<img src="x">', target: ['img'], failureSummary: 'Add alt' }],
      },
    ],
    passes: [{ id: 'document-title', help: 'Documents must have a title' }],
  };

  const out = transform(fixture);
  assert.equal(out.problems.visualAccessibility.length, 1);
  assert.equal(out.problems.multimedia.length, 1);
  assert.equal(out.problems.visualAccessibility[0].impact, 'serious');
  assert.equal(out.whatsGood[0], 'Documents must have a title');
});

test('transform puts axe incomplete checks in needsManualReview, not in problems', () => {
  const out = transform({
    violations: [],
    passes: [],
    incomplete: [
      {
        id: 'color-contrast',
        help: 'Elements must meet minimum color contrast ratio thresholds',
        description: 'Ensures the contrast between foreground and background colors meets WCAG 2 AA',
        helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast',
        impact: 'serious',
        tags: ['cat.color', 'wcag2aa', 'wcag143'],
        nodes: [
          { html: '<h1 style="background:url(hero.jpg)">Hi</h1>', failureSummary: 'Fix any of the following: element has a background image' },
          { html: '<p class="over-img">x</p>' },
        ],
      },
    ],
  });
  assert.deepEqual(out.problems.visualAccessibility, []);
  assert.equal(out.needsManualReview.length, 1);
  const [check] = out.needsManualReview;
  assert.equal(check.id, 'color-contrast');
  assert.equal(check.category, 'needsManualReview');
  assert.equal(check.count, 2);
  assert.equal(check.impact, 'serious');
  assert.match(check.solution[0], /background image/);
});

test('transform returns an empty needsManualReview when axe reports none', () => {
  assert.deepEqual(transform({ violations: [], passes: [] }).needsManualReview, []);
  assert.deepEqual(transform(null).needsManualReview, []);
});
