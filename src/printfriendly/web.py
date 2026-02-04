"""
PrintFriendly Web Interface - Browser-based UI for article conversion.

A simple FastAPI application providing a web interface for converting
newsletter URLs to magazine-quality PDFs.
"""

import asyncio
import io
from pathlib import Path
from typing import Optional
from urllib.parse import urlparse

from fastapi import FastAPI, HTTPException, Request, Form, BackgroundTasks
from fastapi.responses import HTMLResponse, StreamingResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel, HttpUrl

from . import __version__
from .extractor import ContentExtractor
from .analyzer import ContentAnalyzer
from .renderer import PDFRenderer


# Initialize FastAPI app
app = FastAPI(
    title="PrintFriendly",
    description="Convert web newsletters into magazine-quality PDFs",
    version=__version__,
)

# Set up templates
templates_dir = Path(__file__).parent / "web_templates"
templates = Jinja2Templates(directory=str(templates_dir))


class ConversionRequest(BaseModel):
    """Request model for article conversion."""

    url: HttpUrl
    style: str = "magazine"
    include_images: bool = True
    include_pull_quotes: bool = True


class ConversionStatus(BaseModel):
    """Status response for conversion progress."""

    status: str  # pending, processing, completed, error
    message: str
    progress: int  # 0-100
    pdf_url: Optional[str] = None


def generate_filename(url: str, title: Optional[str] = None) -> str:
    """Generate a clean ASCII filename from URL or title."""
    if title:
        # Only allow ASCII alphanumeric characters and basic punctuation
        clean = "".join(c if c.isascii() and (c.isalnum() or c in " -_") else "" for c in title)
        clean = clean.strip().replace(" ", "-")[:50]
        if clean:
            return f"{clean}.pdf"

    parsed = urlparse(str(url))
    domain = parsed.netloc.replace("www.", "").split(".")[0]
    path = parsed.path.strip("/").split("/")[-1] if parsed.path else "article"
    path = "".join(c if c.isascii() and (c.isalnum() or c in "-_") else "" for c in path)[:30]

    return f"{domain}-{path}.pdf" if path else f"{domain}-article.pdf"


@app.get("/", response_class=HTMLResponse)
async def home(request: Request):
    """Render the home page with conversion form."""
    return templates.TemplateResponse(
        "index.html",
        {
            "request": request,
            "version": __version__,
        },
    )


@app.post("/convert")
async def convert_article(
    url: str = Form(...),
    style: str = Form("magazine"),
    include_images: bool = Form(True),
    include_pull_quotes: bool = Form(True),
):
    """
    Convert an article URL to PDF and return it for download.

    This endpoint fetches the article, processes it, and returns
    the PDF file directly.
    """
    try:
        # Validate URL
        parsed = urlparse(url)
        if not parsed.scheme:
            url = f"https://{url}"

        # Extract content
        extractor = ContentExtractor()
        try:
            content = extractor.extract(url, include_images=include_images)
        finally:
            extractor.close()

        # Analyze content
        analyzer = ContentAnalyzer()
        analyzed = analyzer.analyze(
            content,
            num_pull_quotes=2 if include_pull_quotes else 0,
        )

        # Generate PDF
        renderer = PDFRenderer()
        pdf_bytes = renderer.render(
            analyzed,
            output_path=None,  # Return bytes
            style=style,
            include_images=include_images,
            include_pull_quotes=include_pull_quotes,
        )

        # Generate filename
        filename = generate_filename(url, analyzed.title)

        # Return PDF as download
        return StreamingResponse(
            io.BytesIO(pdf_bytes),
            media_type="application/pdf",
            headers={
                "Content-Disposition": f'attachment; filename="{filename}"',
                "Content-Length": str(len(pdf_bytes)),
            },
        )

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/convert", response_class=JSONResponse)
async def api_convert(request: ConversionRequest):
    """
    API endpoint for article conversion.

    Returns JSON with PDF bytes encoded as base64.
    """
    import base64

    try:
        # Extract content
        extractor = ContentExtractor()
        try:
            content = extractor.extract(
                str(request.url),
                include_images=request.include_images,
            )
        finally:
            extractor.close()

        # Analyze content
        analyzer = ContentAnalyzer()
        analyzed = analyzer.analyze(
            content,
            num_pull_quotes=2 if request.include_pull_quotes else 0,
        )

        # Generate PDF
        renderer = PDFRenderer()
        pdf_bytes = renderer.render(
            analyzed,
            output_path=None,
            style=request.style,
            include_images=request.include_images,
            include_pull_quotes=request.include_pull_quotes,
        )

        # Generate filename
        filename = generate_filename(str(request.url), analyzed.title)

        return {
            "success": True,
            "title": analyzed.title,
            "author": analyzed.author,
            "word_count": analyzed.word_count,
            "reading_time": analyzed.reading_time_minutes,
            "filename": filename,
            "pdf_base64": base64.b64encode(pdf_bytes).decode("ascii"),
        }

    except Exception as e:
        return JSONResponse(
            status_code=500,
            content={"success": False, "error": str(e)},
        )


@app.get("/api/preview")
async def preview_article(url: str, style: str = "magazine"):
    """
    Generate a preview of the first page of the PDF.

    Returns the PDF bytes for preview display.
    """
    try:
        # Validate URL
        parsed = urlparse(url)
        if not parsed.scheme:
            url = f"https://{url}"

        # Extract content (with images for preview)
        extractor = ContentExtractor()
        try:
            content = extractor.extract(url, include_images=True)
        finally:
            extractor.close()

        # Analyze content
        analyzer = ContentAnalyzer()
        analyzed = analyzer.analyze(content, num_pull_quotes=1)

        # Generate preview PDF
        renderer = PDFRenderer()
        pdf_bytes = renderer.render_preview(analyzed, style=style, max_pages=1)

        return StreamingResponse(
            io.BytesIO(pdf_bytes),
            media_type="application/pdf",
        )

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/health")
async def health_check():
    """Health check endpoint."""
    return {"status": "healthy", "version": __version__}
