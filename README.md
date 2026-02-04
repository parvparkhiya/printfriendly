# PrintFriendly

Convert web newsletters into beautifully designed, magazine-quality A4 PDFs.

## Prerequisites

### macOS

Install system dependencies via Homebrew:

```bash
brew install pango gdk-pixbuf libffi
```

These are required by WeasyPrint for PDF rendering.

## Installation

```bash
# Create and activate conda environment
conda create -n printfriendly python=3.11 -y
conda activate printfriendly

# Install the package
pip install -e .
```

**Note:** On macOS, you may need to set the library path before running:

```bash
export DYLD_LIBRARY_PATH="/opt/homebrew/lib:$DYLD_LIBRARY_PATH"
```

You can add this to your shell profile (~/.zshrc or ~/.bashrc) for convenience.

## Usage

### CLI

```bash
# Basic usage
printfriendly "https://example.com/article"

# With options (options come before the URL)
printfriendly --output article.pdf --style magazine "https://example.com/article"

# Without images (faster)
printfriendly --no-images "https://example.com/article"

# Minimal style
printfriendly --style minimal "https://example.com/article"

# Show help
printfriendly --help
```

PDFs are saved to the `output/` folder by default.

### Web Interface

```bash
uvicorn printfriendly.web:app --host 127.0.0.1 --port 8000
# Open http://127.0.0.1:8000
```

## Styles

- **magazine**: Full editorial design with drop caps, pull quotes, and sophisticated typography
- **minimal**: Clean, simple layout focused on readability

## Features

- Extracts main article content using Mozilla's Readability algorithm
- Downloads and embeds images locally
- Generates magazine-quality A4 PDFs with WeasyPrint
- Beautiful typography with Playfair Display, Source Serif 4, and Inter fonts
- Pull quotes automatically extracted from compelling sentences
- Drop caps for elegant article openings
- Running headers with source name and page numbers

## License

MIT
