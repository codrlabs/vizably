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
          { html: '<h1 style="background:url(hero.jpg)">Hi</h1>', failureSummary: 'Fix any of the following:\n  Element has a background image' },
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
  assert.equal(check.rootCause, 'Element has a background image');
});

// Copied from a real axe-core 4.11 run in Chromium: a heading over a background
// image, plus a paragraph under an overlay. Hand-written fixtures hid the fact
// that these fields don't mean the same thing as they do on a violation.
const REAL_INCOMPLETE_COLOR_CONTRAST = {
  id: 'color-contrast',
  impact: 'serious',
  tags: ['cat.color', 'wcag2aa', 'wcag143', 'TTv5', 'TT13.c', 'EN-301-549', 'EN-9.1.4.3', 'ACT', 'RGAAv4', 'RGAA-3.2.1'],
  description: 'Ensure the contrast between foreground and background colors meets WCAG 2 AA minimum contrast ratio thresholds',
  help: 'Elements must meet minimum color contrast ratio thresholds',
  helpUrl: 'https://dequeuniversity.com/rules/axe/4.11/color-contrast?application=axeAPI',
  nodes: [
    {
      any: [
        {
          id: 'color-contrast',
          data: { contrastRatio: 0, fontSize: '24.0pt (32px)', fontWeight: 'bold', messageKey: 'bgImage', expectedContrastRatio: '3:1' },
          relatedNodes: [],
          impact: 'serious',
          message: "Element's background color could not be determined due to a background image",
        },
      ],
      all: [],
      none: [],
      impact: 'serious',
      html: '<h1 style="color:#fff;background-image:url(hero.jpg)">Welcome</h1>',
      target: ['h1'],
      failureSummary: "Fix any of the following:\n  Element's background color could not be determined due to a background image",
    },
    {
      any: [
        {
          id: 'color-contrast',
          data: { contrastRatio: 0, fontSize: '12.0pt (16px)', fontWeight: 'normal', messageKey: 'bgOverlap', expectedContrastRatio: '4.5:1' },
          relatedNodes: [],
          impact: 'serious',
          message: "Element's background color could not be determined because it is overlapped by another element",
        },
      ],
      all: [],
      none: [],
      impact: 'serious',
      html: '<p style="color:#777">Overlapped text</p>',
      target: ['p'],
      failureSummary: "Fix any of the following:\n  Element's background color could not be determined because it is overlapped by another element",
    },
  ],
};

test('a real axe incomplete result gives the actual reason and something to check', () => {
  const [check] = transform({ incomplete: [REAL_INCOMPLETE_COLOR_CONTRAST] }).needsManualReview;

  // Why it couldn't be checked: the reason, not what the rule checks in general.
  assert.equal(check.rootCause, "Element's background color could not be determined due to a background image");
  assert.doesNotMatch(check.rootCause, /fix any/i);

  // What to check: guidance for a person, not axe's reason repeated.
  assert.ok(check.solution.length > 0);
  for (const step of check.solution) {
    assert.doesNotMatch(step, /fix any of the following|could not be determined/i);
  }
  assert.match(check.solution[0], /contrast checker/);
});

test('review reasons drop every "Fix ... of the following" heading and keep all the reasons', () => {
  const [check] = transform({
    incomplete: [{
      id: 'some-rule',
      nodes: [{ failureSummary: 'Fix any of the following:\n  First reason\n  Second reason\n\nFix all of the following:\n  Third reason' }],
    }],
  }).needsManualReview;
  assert.equal(check.rootCause, 'First reason; Second reason; Third reason');
});

test('review items for other rules name the rule, and survive a missing failureSummary', () => {
  const [check] = transform({
    incomplete: [{ id: 'aria-valid-attr-value', help: 'ARIA attributes must conform to valid values', nodes: [{ html: '<div></div>' }] }],
  }).needsManualReview;
  assert.equal(check.rootCause, 'The scanner could not get a result for this element.');
  assert.match(check.solution[0], /ARIA attributes must conform to valid values/);
});

test('violations keep failureSummary as the fix', () => {
  const summary = 'Fix any of the following:\n  Element does not have an alt attribute';
  const out = transform({
    violations: [{ id: 'image-alt', description: 'Images need alt text', tags: ['cat.text-alternatives'], nodes: [{ failureSummary: summary }] }],
  });
  const [problem] = out.problems.multimedia;
  assert.equal(problem.rootCause, 'Images need alt text');
  assert.deepEqual(problem.solution, [summary]);
});

test('transform returns an empty needsManualReview when axe reports none', () => {
  assert.deepEqual(transform({ violations: [], passes: [] }).needsManualReview, []);
  assert.deepEqual(transform(null).needsManualReview, []);
});
