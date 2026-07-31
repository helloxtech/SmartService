import { createHash } from "node:crypto";
import {
    mkdir,
    readFile,
    writeFile,
} from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
    Document,
    HeadingLevel,
    Packer,
    Paragraph,
    TextRun,
} from "docx";
import JSZip from "jszip";
import {
    PDFDocument,
    StandardFonts,
    rgb,
} from "pdf-lib";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, "../..");
const fixtureRoot = resolve(repositoryRoot, "docs/spec/fixtures/generated/ingestion");
const manualPath = resolve(
    repositoryRoot,
    "docs/spec/fixtures/knowledge/demo_company_product_manual.md",
);
const faqPath = resolve(
    repositoryRoot,
    "docs/spec/fixtures/knowledge/demo_company_faq.md",
);

/**
 * normalizePdfText
 * ----------------
 * Replaces characters unsupported by PDF base fonts while preserving the fixture's factual meaning.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 2 Knowledge Ingestion
 */
function normalizePdfText(text)
{
    return text
        .replace(/[–—]/gu, "-")
        .replace(/[“”]/gu, "\"")
        .replace(/[‘’]/gu, "'")
        .replace(/≤/gu, "<=")
        .replace(/≥/gu, ">=")
        .replace(/×/gu, "x")
        .replace(/[^\u0020-\u007E\u00A0-\u00FF]/gu, "?");
}

/**
 * wrapText
 * ----------------
 * Wraps fixture text by measured PDF width so generated pages remain extractable and readable.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 2 Knowledge Ingestion
 */
function wrapText(text, font, size, width)
{
    const words = normalizePdfText(text).split(/\s+/u);
    const lines = [];
    let current = "";

    for (const word of words)
    {
        const candidate = current.length === 0 ? word : `${current} ${word}`;

        if (font.widthOfTextAtSize(candidate, size) > width && current.length > 0)
        {
            lines.push(current);
            current = word;
            continue;
        }

        current = candidate;
    }

    if (current.length > 0)
    {
        lines.push(current);
    }

    return lines;
}

/**
 * createPdfFixture
 * ----------------
 * Generates a real text-layer PDF from the locked fictional product manual with stable metadata.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 2 Knowledge Ingestion
 */
async function createPdfFixture(markdown)
{
    const pdf = await PDFDocument.create();
    const regular = await pdf.embedFont(StandardFonts.Helvetica);
    const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
    const fixedDate = new Date("2026-07-26T12:00:00.000Z");
    pdf.setTitle("XFlow NF-Series Product Manual");
    pdf.setAuthor("SmartService Fixture Generator");
    pdf.setCreationDate(fixedDate);
    pdf.setModificationDate(fixedDate);
    let page;
    let y = 0;

    /**
     * addPage
     * ----------------
     * Adds one letter-size fixture page and resets the text cursor.
     *
     * July 26, 2026: Created by Forrest Zhang for SmartService Day 2 Knowledge Ingestion
     */
    function addPage()
    {
        page = pdf.addPage([612, 792]);
        y = 744;
    }

    /**
     * writeWrapped
     * ----------------
     * Writes a wrapped block and creates continuation pages before text reaches the footer.
     *
     * July 26, 2026: Created by Forrest Zhang for SmartService Day 2 Knowledge Ingestion
     */
    function writeWrapped(text, font, size, spacing)
    {
        for (const line of wrapText(text, font, size, 516))
        {
            if (y < 54)
            {
                addPage();
            }

            page.drawText(line, {
                color: rgb(0.08, 0.12, 0.18),
                font,
                size,
                x: 48,
                y,
            });
            y -= spacing;
        }
    }

    addPage();

    for (const rawLine of markdown.split(/\r?\n/u))
    {
        const line = rawLine.trim();

        if (line.length === 0)
        {
            y -= 7;
            continue;
        }

        if (line.startsWith("# "))
        {
            writeWrapped(line.slice(2), bold, 18, 23);
            y -= 8;
            continue;
        }

        if (line.startsWith("## "))
        {
            if (y < 650)
            {
                addPage();
            }

            writeWrapped(line.slice(3), bold, 14, 19);
            y -= 5;
            continue;
        }

        if (line.startsWith("### "))
        {
            writeWrapped(line.slice(4), bold, 12, 17);
            continue;
        }

        const body = line.replace(/^[-*>]\s*/u, "");
        writeWrapped(body, regular, 10, 14);
        y -= 3;
    }

    return {
        bytes: await pdf.save({
            addDefaultPage: false,
            updateFieldAppearances: false,
            useObjectStreams: false,
        }),
        pageCount: pdf.getPageCount(),
    };
}

/**
 * createNoTextPdfFixture
 * ----------------
 * Generates a stable one-page PDF without a text layer for scanned/no-text rejection coverage.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 2 Knowledge Ingestion
 */
async function createNoTextPdfFixture()
{
    const pdf = await PDFDocument.create();
    const fixedDate = new Date("2026-07-26T12:00:00.000Z");
    pdf.addPage([612, 792]);
    pdf.setTitle("XFlow no-text rejection fixture");
    pdf.setAuthor("SmartService Fixture Generator");
    pdf.setCreationDate(fixedDate);
    pdf.setModificationDate(fixedDate);

    return pdf.save({
        addDefaultPage: false,
        updateFieldAppearances: false,
        useObjectStreams: false,
    });
}

/**
 * createDocxFixture
 * ----------------
 * Generates a real DOCX with headings, paragraphs, and bullets from the locked fictional FAQ.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 2 Knowledge Ingestion
 */
async function createDocxFixture(markdown)
{
    const children = [];

    for (const rawLine of markdown.split(/\r?\n/u))
    {
        const line = rawLine.trim();

        if (line.length === 0)
        {
            continue;
        }

        if (line.startsWith("# "))
        {
            children.push(new Paragraph({
                heading: HeadingLevel.HEADING_1,
                text: line.slice(2),
            }));
            continue;
        }

        if (line.startsWith("## "))
        {
            children.push(new Paragraph({
                heading: HeadingLevel.HEADING_2,
                text: line.slice(3),
            }));
            continue;
        }

        if (line.startsWith("### "))
        {
            children.push(new Paragraph({
                heading: HeadingLevel.HEADING_3,
                text: line.slice(4),
            }));
            continue;
        }

        if (line.startsWith("- "))
        {
            children.push(new Paragraph({
                bullet: {
                    level: 0,
                },
                children: [new TextRun(line.slice(2))],
            }));
            continue;
        }

        children.push(new Paragraph({
            children: [new TextRun(line.replace(/^>\s*/u, ""))],
        }));
    }

    const fixedDate = new Date("2026-07-26T12:00:00.000Z");
    const document = new Document({
        creator: "SmartService Fixture Generator",
        description: "Fictional XFlow FAQ ingestion fixture",
        lastModifiedBy: "SmartService Fixture Generator",
        sections: [{
            children,
        }],
        title: "XFlow Industrial Systems FAQ",
        created: fixedDate,
        modified: fixedDate,
    });

    const packedDocument = await Packer.toBuffer(document);
    const archive = await JSZip.loadAsync(packedDocument);
    const coreProperties = archive.file("docProps/core.xml");

    if (coreProperties === null)
    {
        throw new Error("The generated DOCX did not contain core properties.");
    }

    const normalizedCoreProperties = (await coreProperties.async("string"))
        .replace(
            /(<dcterms:(?:created|modified)[^>]*>)[^<]*(<\/dcterms:(?:created|modified)>)/gu,
            `$1${fixedDate.toISOString()}$2`,
        );
    archive.file("docProps/core.xml", normalizedCoreProperties);

    for (const entry of Object.values(archive.files))
    {
        entry.date = fixedDate;
    }

    return archive.generateAsync({
        compression: "DEFLATE",
        compressionOptions: {
            level: 6,
        },
        platform: "UNIX",
        type: "nodebuffer",
    });
}

/**
 * sha256
 * ----------------
 * Calculates a lowercase SHA-256 manifest digest for one generated fixture.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 2 Knowledge Ingestion
 */
function sha256(bytes)
{
    return createHash("sha256").update(bytes).digest("hex");
}

/**
 * createMiniSite
 * ----------------
 * Produces a fixed same-origin three-page site plus one cross-origin link used by crawl boundary tests.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 2 Knowledge Ingestion
 */
function createMiniSite()
{
    return {
        "site/index.html": `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>XFlow Industrial Systems</title></head>
<body><main><h1>XFlow Industrial Systems</h1><p>Fictional NF-Series industrial liquid-transfer pumps.</p>
<nav><a href="/products.html">Products</a><a href="/support.html">Support</a><a href="https://external.example.invalid/">External link</a></nav>
</main></body></html>
`,
        "site/products.html": `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>NF-Series Products</title></head>
<body><main><h1>NF-Series Products</h1><p>NF-200 and NF-500 are for compatible non-potable, non-flammable industrial liquids.</p>
<a href="/support.html">Support</a></main></body></html>
`,
        "site/support.html": `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>XFlow Support</title></head>
<body><main><h1>Support</h1><p>Warranty review requires model, serial number, purchase date, and issue details.</p>
<a href="/">Home</a></main></body></html>
`,
    };
}

/**
 * main
 * ----------------
 * Generates and fingerprints the fixed PDF, DOCX, and mini-site acceptance corpus.
 *
 * July 26, 2026: Created by Forrest Zhang for SmartService Day 2 Knowledge Ingestion
 */
async function main()
{
    const [manualMarkdown, faqMarkdown] = await Promise.all([
        readFile(manualPath, "utf8"),
        readFile(faqPath, "utf8"),
    ]);
    const [pdf, noTextPdf, docx] = await Promise.all([
        createPdfFixture(manualMarkdown),
        createNoTextPdfFixture(),
        createDocxFixture(faqMarkdown),
    ]);
    const files = {
        "xflow-nf-series-manual.pdf": Buffer.from(pdf.bytes),
        "xflow-no-text.pdf": Buffer.from(noTextPdf),
        "xflow-support-faq.docx": Buffer.from(docx),
        ...createMiniSite(),
    };
    await mkdir(fixtureRoot, {
        recursive: true,
    });

    for (const [relativePath, content] of Object.entries(files))
    {
        const targetPath = resolve(fixtureRoot, relativePath);
        await mkdir(dirname(targetPath), {
            recursive: true,
        });
        await writeFile(targetPath, content);
    }

    const manifest = {
        corpusVersion: "smartservice-ingestion-v1",
        generatedAt: "2026-07-26T12:00:00.000Z",
        files: Object.fromEntries(
            Object.entries(files).map(([relativePath, content]) =>
            {
                const bytes = Buffer.isBuffer(content) ? content : Buffer.from(content);

                return [relativePath, {
                    bytes: bytes.byteLength,
                    sha256: sha256(bytes),
                }];
            }),
        ),
        expectations: {
            docxTitle: faqMarkdown
                .split(/\r?\n/u)
                .find((line) => line.startsWith("# "))
                ?.slice(2) ?? "XFlow Industrial Systems FAQ",
            pdfPages: pdf.pageCount,
            sitePages: 3,
        },
    };
    await writeFile(
        resolve(fixtureRoot, "manifest.json"),
        `${JSON.stringify(manifest, null, 2)}\n`,
        "utf8",
    );

    process.stdout.write(
        `Generated ${Object.keys(files).length} ingestion fixtures; PDF pages: ${pdf.pageCount}.\n`,
    );
}

await main();
