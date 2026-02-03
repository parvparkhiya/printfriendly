"""
PrintFriendly - Newsletter to Magazine PDF Converter

Convert web newsletters into beautifully designed, magazine-quality A4 PDFs
with sophisticated editorial layout.
"""

__version__ = "0.1.0"

from .extractor import ContentExtractor
from .analyzer import ContentAnalyzer
from .layout import LayoutComposer
from .renderer import PDFRenderer

__all__ = [
    "__version__",
    "ContentExtractor",
    "ContentAnalyzer",
    "LayoutComposer",
    "PDFRenderer",
]
