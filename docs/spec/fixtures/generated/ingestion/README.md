# Day 2 Ingestion Fixtures

These files are fictional, deterministic acceptance inputs generated from the approved XFlow Markdown knowledge fixtures.

- `xflow-nf-series-manual.pdf`: real eight-page, text-layer PDF.
- `xflow-no-text.pdf`: real one-page PDF without a text layer for OCR-boundary rejection.
- `xflow-support-faq.docx`: real DOCX with headings and list content.
- `site/`: bounded three-page same-origin crawl site with one intentionally cross-origin link.
- `manifest.json`: fixed corpus version, expected extraction facts, byte sizes, and SHA-256 hashes.

Regenerate and verify the corpus:

```bash
pnpm fixtures:ingestion
pnpm --filter @smartservice/web test
```

Do not replace these inputs during model calibration. Change the corpus version and review the manifest whenever source content or generation logic changes.
