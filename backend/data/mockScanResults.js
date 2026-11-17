// Mock scan data used until the real Puppeteer + axe-core scanner is wired up.
// See docs/plans/axecore-integration-roadmap.md for the replacement plan.

const mockScanResults = {
  problems: {
    visualAccessibility: [
      {
        id: 'contrast-1',
        name: 'Low contrast between text and background',
        category: 'Visual Accessibility',
        rootCause:
          'Text and background colors do not meet WCAG AA contrast requirements (4.5:1 for normal text).',
        codeSnippet: '<p style="color: #999; background: #eee;">Hard to read text</p>',
        solution: [
          'Increase the contrast ratio to at least 4.5:1 for normal text and 3:1 for large text.',
          'Use a tool or browser extension to check contrast (e.g. WebAIM Contrast Checker).',
          'Prefer dark text on light backgrounds or vice versa with sufficient difference.',
        ],
      },
      {
        id: 'focus-1',
        name: 'Focus indicator not visible',
        category: 'Visual Accessibility',
        rootCause:
          'Custom CSS removes or overrides the default focus outline, so keyboard users cannot see which element is focused.',
        codeSnippet: 'button:focus { outline: none; }',
        solution: [
          'Do not use outline: none without providing a visible alternative (e.g. outline: 2px solid currentColor).',
          'Use :focus-visible to show focus only for keyboard navigation if you want to hide it for mouse users.',
        ],
      },
    ],
    structureAndSemantics: [
      {
        id: 'heading-1',
        name: 'Heading levels skipped',
        category: 'Structure and Semantics',
        rootCause:
          'The page jumps from <h1> to <h3>, skipping <h2>. Screen readers and assistive tech rely on a logical heading order.',
        codeSnippet: '<h1>Page title</h1>\n<h3>Section</h3>',
        solution: [
          'Use heading levels in order: h1 → h2 → h3, without skipping levels.',
          'Use only one h1 per page for the main title.',
          'Use headings to outline the page structure, not for visual size alone (use CSS for styling).',
        ],
      },
      {
        id: 'landmark-1',
        name: 'Missing main landmark',
        category: 'Structure and Semantics',
        rootCause:
          'The primary content is not wrapped in a <main> element, so screen reader users cannot jump to main content easily.',
        codeSnippet: '<body>\n  <header>...</header>\n  <div class="content">...</div>\n</body>',
        solution: [
          'Wrap the primary content of the page in a <main> element.',
          'Ensure there is only one visible <main> per page.',
          'Use other landmarks (header, nav, footer, aside) where appropriate.',
        ],
      },
    ],
    multimedia: [
      {
        id: 'alt-1',
        name: 'Image missing alt text',
        category: 'Multi-media',
        rootCause:
          'An <img> has no alt attribute (or empty alt when the image is meaningful), so screen reader users get no description.',
        codeSnippet: '<img src="/hero.jpg">',
        solution: [
          'Add a descriptive alt attribute for meaningful images: alt="Brief description of the image".',
          'Use alt="" for purely decorative images so assistive tech can skip them.',
          'Avoid using alt to describe surrounding text; keep it concise and specific to the image.',
        ],
      },
    ],
  },
  whatsGood: [
    'Page has a descriptive <title> and language attribute on <html>.',
    'Form inputs have associated <label> elements.',
    'Color is not used as the only way to convey information.',
    'Interactive elements are keyboard focusable and operable.',
  ],
};

module.exports = mockScanResults;
