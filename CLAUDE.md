# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

PrintFriendly converts web newsletters and articles into magazine-quality A4 PDFs with editorial design features like drop caps, pull quotes, sophisticated typography, and strategic image placement.

## Development Commands

```bash
# Environment setup (macOS requires WeasyPrint dependencies)
conda create -n printfriendly python=3.11 -y
conda activate printfriendly
export DYLD_LIBRARY_PATH="/opt/homebrew/lib:$DYLD_LIBRARY_PATH"

# Install in development mode
pip install -e ".[dev]"

# Run linter and formatter
ruff check src tests
ruff format src tests

# Run tests
pytest tests -v

# CLI usage
printfriendly https://example.com/article --output file.pdf --style magazine
uvicorn printfriendly.web:app --host 127.0.0.1 --port 8000  # Start web interface
```

## Architecture

The codebase follows a pipeline architecture with four main stages:

1. **Extraction** (`extractor.py`) - Fetches URLs, extracts article content via Mozilla Readability, downloads/embeds images as base64 data URIs, extracts metadata (author, date, source)

2. **Analysis** (`analyzer.py`) - Identifies subtitle/deck, scores and selects pull quotes using linguistic patterns, determines image placement strategies

3. **Layout** (`layout.py`) - Applies editorial design: drop caps, pull quote distribution, image placement (hero, inset-left, inset-right, full-width), section headings

4. **Rendering** (`renderer.py`) - Converts composed HTML to PDF via WeasyPrint with embedded fonts

### Key Data Flow

```
URL → ContentExtractor → ExtractedContent → ContentAnalyzer → AnalyzedContent → LayoutComposer → HTML → PDFRenderer → PDF
```

### Dataclasses (Domain Models)

- `ExtractedContent` - Raw article data with metadata
- `AnalyzedContent` - Article with structure, pull quotes, image placements
- `PullQuote` - Candidate quote with quality score
- `ImagePlacement` - Position strategy (placement_type, paragraph_index)

## Key Directories

- `src/printfriendly/fonts/` - Embedded TTF fonts (Playfair Display, Source Serif 4, Inter)
- `src/printfriendly/styles/` - CSS stylesheets (magazine.css, minimal.css)
- `src/printfriendly/templates/` - Jinja2 templates for article rendering

## Interfaces

- **CLI** (`cli.py`): typer-based command interface
- **Web API** (`web.py`): FastAPI with endpoints `/convert`, `/api/convert`, `/api/preview`, `/health`

## Design Constraints

- Images filtered by minimum 150x150px, maximum 1200x1600px, converted to JPEG 85% quality
- Pull quotes: 8-35 words, minimum 8 paragraphs spacing between quotes
- HTML structure is preserved and cloned throughout the pipeline (never modified in place)
