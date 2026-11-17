/**
 * Backend-shaped ScanResult fixture (see shared/types.js) used by the
 * adapter and view tests.
 */
export const scanResultFixture = {
  problems: {
    visualAccessibility: [
      {
        id: 'color-contrast',
        name: 'Elements must meet minimum color contrast ratio thresholds',
        category: 'visualAccessibility',
        rootCause: 'Text and background colors do not have sufficient contrast.',
        codeSnippet: '<p style="color:#999; background:#eee;">Hours</p>',
        solution: ['Increase the contrast ratio to at least 4.5:1.'],
        count: 6,
        impact: 'serious',
        helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/color-contrast',
        tags: ['cat.color', 'wcag2aa', 'wcag143'],
      },
    ],
    structureAndSemantics: [
      {
        id: 'image-alt',
        name: 'Images must have alternate text',
        category: 'structureAndSemantics',
        rootCause: 'The hero image has no alt attribute.',
        codeSnippet: '<img src="/hero.jpg">',
        solution: ['Add a concise, descriptive alt for meaningful images.'],
        count: 3,
        impact: 'critical',
        helpUrl: 'https://dequeuniversity.com/rules/axe/4.10/image-alt',
        tags: ['cat.text-alternatives', 'wcag2a', 'wcag111'],
      },
      {
        id: 'heading-order',
        name: 'Heading levels should only increase by one',
        category: 'structureAndSemantics',
        rootCause: 'The page jumps from <h1> straight to <h3>.',
        codeSnippet: '<h1>Title</h1>\n<h3>Section</h3>',
        solution: ['Use heading levels in order without skipping.'],
        count: 2,
        impact: 'moderate',
        helpUrl: null,
        tags: ['cat.semantics', 'best-practice'],
      },
    ],
    multimedia: [],
  },
  whatsGood: [
    'Page declares a language with lang="en" on <html>.',
    'All form inputs have associated <label> elements.',
  ],
}
