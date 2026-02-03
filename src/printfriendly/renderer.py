"""
PDF Renderer - Generate magazine-quality PDFs from composed HTML.

Uses WeasyPrint for CSS-based PDF rendering with proper font embedding
and A4 page handling.
"""

import io
import logging
from pathlib import Path
from typing import Optional, Union

from weasyprint import HTML, CSS
from weasyprint.text.fonts import FontConfiguration

from .analyzer import AnalyzedContent
from .layout import LayoutComposer, LayoutOptions


# Suppress WeasyPrint warnings for cleaner output
logging.getLogger('weasyprint').setLevel(logging.ERROR)
logging.getLogger('fontTools').setLevel(logging.ERROR)


class PDFRenderer:
    """Render HTML content to magazine-quality PDF."""

    def __init__(self, fonts_dir: Optional[Path] = None):
        """
        Initialize the PDF renderer.

        Args:
            fonts_dir: Directory containing font files. Defaults to bundled fonts.
        """
        if fonts_dir is None:
            fonts_dir = Path(__file__).parent / "fonts"

        self.fonts_dir = fonts_dir
        self.font_config = FontConfiguration()
        self._composer = LayoutComposer()

    def render(
        self,
        content: AnalyzedContent,
        output_path: Optional[Union[str, Path]] = None,
        style: str = "magazine",
        include_images: bool = True,
        include_pull_quotes: bool = True,
    ) -> Optional[bytes]:
        """
        Render analyzed content to PDF.

        Args:
            content: Analyzed content to render
            output_path: Path to save PDF. If None, returns bytes.
            style: Style to use ('magazine' or 'minimal')
            include_images: Whether to include images
            include_pull_quotes: Whether to include pull quotes

        Returns:
            PDF bytes if output_path is None, otherwise None
        """
        # Compose the HTML layout
        options = LayoutOptions(
            style=style,
            include_images=include_images,
            include_pull_quotes=include_pull_quotes,
        )
        html_content = self._composer.compose(content, options)

        # Create WeasyPrint HTML document
        html_doc = HTML(string=html_content, base_url=str(Path(__file__).parent))

        # Render to PDF
        if output_path:
            output_path = Path(output_path)
            html_doc.write_pdf(
                str(output_path),
                font_config=self.font_config,
            )
            return None
        else:
            # Return as bytes
            pdf_buffer = io.BytesIO()
            html_doc.write_pdf(
                pdf_buffer,
                font_config=self.font_config,
            )
            return pdf_buffer.getvalue()

    def render_html(
        self,
        html_content: str,
        output_path: Optional[Union[str, Path]] = None,
        base_url: Optional[str] = None,
    ) -> Optional[bytes]:
        """
        Render raw HTML content to PDF.

        Args:
            html_content: HTML string to render
            output_path: Path to save PDF. If None, returns bytes.
            base_url: Base URL for resolving relative paths

        Returns:
            PDF bytes if output_path is None, otherwise None
        """
        if base_url is None:
            base_url = str(Path(__file__).parent)

        html_doc = HTML(string=html_content, base_url=base_url)

        if output_path:
            output_path = Path(output_path)
            html_doc.write_pdf(
                str(output_path),
                font_config=self.font_config,
            )
            return None
        else:
            pdf_buffer = io.BytesIO()
            html_doc.write_pdf(
                pdf_buffer,
                font_config=self.font_config,
            )
            return pdf_buffer.getvalue()

    def render_preview(
        self,
        content: AnalyzedContent,
        style: str = "magazine",
        max_pages: int = 1,
    ) -> bytes:
        """
        Render a preview (first page) of the PDF.

        Args:
            content: Analyzed content to render
            style: Style to use
            max_pages: Maximum pages to render (for preview)

        Returns:
            PDF bytes of the preview
        """
        # For preview, we limit content but still render full layout
        # This is a simplified preview - full content but limited pages
        options = LayoutOptions(
            style=style,
            include_images=True,
            include_pull_quotes=True,
        )
        html_content = self._composer.compose(content, options)

        html_doc = HTML(string=html_content, base_url=str(Path(__file__).parent))

        # Render all pages but we could optimize this for preview
        pdf_buffer = io.BytesIO()
        html_doc.write_pdf(
            pdf_buffer,
            font_config=self.font_config,
        )
        return pdf_buffer.getvalue()


def render_to_pdf(
    content: AnalyzedContent,
    output_path: Union[str, Path],
    style: str = "magazine",
    include_images: bool = True,
    include_pull_quotes: bool = True,
) -> None:
    """
    Convenience function to render content to PDF file.

    Args:
        content: Analyzed content to render
        output_path: Path to save the PDF
        style: Style to use ('magazine' or 'minimal')
        include_images: Whether to include images
        include_pull_quotes: Whether to include pull quotes
    """
    renderer = PDFRenderer()
    renderer.render(
        content,
        output_path=output_path,
        style=style,
        include_images=include_images,
        include_pull_quotes=include_pull_quotes,
    )


def render_to_bytes(
    content: AnalyzedContent,
    style: str = "magazine",
    include_images: bool = True,
    include_pull_quotes: bool = True,
) -> bytes:
    """
    Convenience function to render content to PDF bytes.

    Args:
        content: Analyzed content to render
        style: Style to use ('magazine' or 'minimal')
        include_images: Whether to include images
        include_pull_quotes: Whether to include pull quotes

    Returns:
        PDF file as bytes
    """
    renderer = PDFRenderer()
    return renderer.render(
        content,
        output_path=None,
        style=style,
        include_images=include_images,
        include_pull_quotes=include_pull_quotes,
    )
