"""
Content Extractor - Fetch and extract article content from web URLs.

Uses httpx for fetching and readability-lxml for content extraction.
Downloads and embeds all images locally for PDF generation.
"""

import base64
import io
import re
from dataclasses import dataclass, field
from typing import Optional
from urllib.parse import urljoin, urlparse

import httpx
from bs4 import BeautifulSoup
from PIL import Image
from readability import Document


@dataclass
class ExtractedImage:
    """Represents an extracted and processed image."""

    original_url: str
    data_uri: str
    width: int
    height: int
    alt_text: str = ""
    caption: str = ""
    position: int = 0  # Order in the article

    @property
    def aspect_ratio(self) -> float:
        """Calculate aspect ratio (width/height)."""
        if self.height == 0:
            return 1.0
        return self.width / self.height

    @property
    def is_landscape(self) -> bool:
        """Check if image is landscape orientation."""
        return self.aspect_ratio > 1.0

    @property
    def is_small(self) -> bool:
        """Check if image is relatively small."""
        return self.width < 400 or self.height < 300


@dataclass
class ExtractedContent:
    """Represents extracted article content."""

    title: str
    html_content: str
    text_content: str
    author: Optional[str] = None
    date: Optional[str] = None
    kicker: Optional[str] = None  # Category/topic
    source_url: str = ""
    source_name: str = ""
    images: list[ExtractedImage] = field(default_factory=list)

    @property
    def word_count(self) -> int:
        """Calculate approximate word count."""
        return len(self.text_content.split())

    @property
    def reading_time_minutes(self) -> int:
        """Estimate reading time (average 200 words per minute)."""
        return max(1, self.word_count // 200)


class ContentExtractor:
    """Extract article content from web URLs."""

    # Common user agents to avoid bot detection
    USER_AGENTS = [
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    ]

    # Image size limits
    MAX_IMAGE_WIDTH = 1200
    MAX_IMAGE_HEIGHT = 1600
    MIN_IMAGE_WIDTH = 150
    MIN_IMAGE_HEIGHT = 150

    def __init__(self, timeout: float = 30.0):
        """Initialize extractor with configurable timeout."""
        self.timeout = timeout
        self._client: Optional[httpx.Client] = None

    @property
    def client(self) -> httpx.Client:
        """Lazy-initialize HTTP client."""
        if self._client is None:
            self._client = httpx.Client(
                timeout=self.timeout,
                follow_redirects=True,
                headers={
                    "User-Agent": self.USER_AGENTS[0],
                    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/*,*/*;q=0.8",
                    "Accept-Language": "en-US,en;q=0.9",
                    "Accept-Encoding": "gzip, deflate",
                },
            )
        return self._client

    def close(self):
        """Close the HTTP client."""
        if self._client is not None:
            self._client.close()
            self._client = None

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        self.close()

    def extract(self, url: str, include_images: bool = True) -> ExtractedContent:
        """
        Extract article content from a URL.

        Args:
            url: The article URL to extract from
            include_images: Whether to download and embed images

        Returns:
            ExtractedContent with article data
        """
        # Fetch the page
        response = self.client.get(url)
        response.raise_for_status()
        html = response.text

        # Parse original HTML for metadata and images
        original_soup = BeautifulSoup(html, "lxml")

        # Extract metadata from original page
        author = self._extract_author(original_soup)
        date = self._extract_date(original_soup)
        kicker = self._extract_kicker(original_soup)
        source_name = self._extract_source_name(original_soup, url)

        # Extract images from original HTML BEFORE Readability processing
        images = []
        if include_images:
            images = self._extract_images_from_original(original_soup, url)

        # Parse with readability
        doc = Document(html)
        title = doc.title()
        article_html = doc.summary()

        # Parse the article HTML
        soup = BeautifulSoup(article_html, "lxml")

        # Extract text content
        text_content = soup.get_text(separator=" ", strip=True)

        # Insert downloaded images back into the article HTML
        if include_images and images:
            article_html = self._insert_images_into_article(soup, images)

        return ExtractedContent(
            title=title,
            html_content=article_html,
            text_content=text_content,
            author=author,
            date=date,
            kicker=kicker,
            source_url=url,
            source_name=source_name,
            images=images,
        )

    def _extract_images_from_original(
        self, soup: BeautifulSoup, base_url: str
    ) -> list[ExtractedImage]:
        """Extract and download images from the original HTML."""
        images = []
        seen_urls = set()

        # Find the main content area (try common selectors)
        content_area = (
            soup.find("article")
            or soup.find(class_=re.compile(r"post-content|article-content|entry-content|post-body", re.I))
            or soup.find(id=re.compile(r"content|article|post", re.I))
            or soup.find("main")
            or soup.body
        )

        if not content_area:
            content_area = soup

        # Find all images in content area
        img_elements = content_area.find_all("img")

        for position, img in enumerate(img_elements):
            # Get image URL from various attributes
            src = (
                img.get("src")
                or img.get("data-src")
                or img.get("data-lazy-src")
            )

            # Try srcset as fallback
            if not src:
                srcset = img.get("srcset") or img.get("data-srcset")
                if srcset:
                    # Get the first/largest image from srcset
                    src = srcset.split(",")[0].strip().split(" ")[0]

            if not src:
                continue

            # Resolve relative URLs
            full_url = urljoin(base_url, src)

            # Skip duplicates
            if full_url in seen_urls:
                continue
            seen_urls.add(full_url)

            # Skip tracking pixels, icons, avatars, logos
            if self._is_non_content_image(full_url, img):
                continue

            try:
                extracted = self._download_and_process_image(
                    url=full_url,
                    alt_text=img.get("alt", ""),
                    position=len(images),
                )
                if extracted:
                    images.append(extracted)
            except Exception as e:
                print(f"Warning: Could not process image {full_url}: {e}")

        return images

    def _is_non_content_image(self, url: str, img) -> bool:
        """Check if an image is likely not content (avatar, icon, etc.)."""
        url_lower = url.lower()

        # Skip by URL patterns
        skip_patterns = [
            "pixel", "tracking", "beacon", "favicon", ".ico",
            "avatar", "profile", "logo", "icon", "button",
            "emoji", "badge", "sprite", "/static/", "widget",
            "placeholder", "spacer", "blank", "transparent",
            "w_36", "w_40", "h_36", "h_40",  # Substack small images
        ]
        if any(p in url_lower for p in skip_patterns):
            return True

        # Skip by class/id patterns
        for attr in ["class", "id"]:
            value = img.get(attr, "")
            if isinstance(value, list):
                value = " ".join(value)
            value_lower = value.lower()
            if any(p in value_lower for p in ["avatar", "logo", "icon", "profile"]):
                return True

        # Skip very small dimension hints
        width = img.get("width")
        height = img.get("height")
        try:
            if width and int(width) < 100:
                return True
            if height and int(height) < 100:
                return True
        except (ValueError, TypeError):
            pass

        return False

    def _insert_images_into_article(
        self, soup: BeautifulSoup, images: list[ExtractedImage]
    ) -> str:
        """Insert downloaded images into the article HTML."""
        # Find all paragraphs
        paragraphs = soup.find_all("p")
        num_paragraphs = len(paragraphs)

        if num_paragraphs == 0:
            # No paragraphs, just append images at the end
            body = soup.find("body") or soup
            for img in images:
                figure = soup.new_tag("figure")
                img_tag = soup.new_tag("img", src=img.data_uri, alt=img.alt_text)
                figure.append(img_tag)
                if img.alt_text:
                    figcaption = soup.new_tag("figcaption")
                    figcaption.string = img.alt_text
                    figure.append(figcaption)
                body.append(figure)
            return str(soup)

        # Distribute images throughout the article
        num_images = len(images)
        if num_images == 0:
            return str(soup)

        # Calculate positions - spread images evenly
        spacing = max(2, num_paragraphs // (num_images + 1))

        for idx, image in enumerate(images):
            # Calculate target position
            if idx == 0:
                # First image goes after first paragraph
                target_pos = 0
            else:
                target_pos = min(idx * spacing, num_paragraphs - 1)

            # Create figure element
            figure = soup.new_tag("figure")
            img_tag = soup.new_tag("img", src=image.data_uri, alt=image.alt_text or "")
            figure.append(img_tag)

            if image.alt_text:
                figcaption = soup.new_tag("figcaption")
                figcaption.string = image.alt_text
                figure.append(figcaption)

            # Insert after the target paragraph
            if target_pos < len(paragraphs):
                paragraphs[target_pos].insert_after(figure)

        return str(soup)

    def _extract_author(self, soup: BeautifulSoup) -> Optional[str]:
        """Extract author from meta tags or common patterns."""
        # Try meta tags first
        meta_author = soup.find("meta", attrs={"name": "author"})
        if meta_author and meta_author.get("content"):
            return meta_author["content"]

        # Try Open Graph
        og_author = soup.find("meta", attrs={"property": "article:author"})
        if og_author and og_author.get("content"):
            return og_author["content"]

        # Try schema.org
        author_elem = soup.find(attrs={"itemprop": "author"})
        if author_elem:
            name_elem = author_elem.find(attrs={"itemprop": "name"})
            if name_elem:
                return name_elem.get_text(strip=True)
            return author_elem.get_text(strip=True)

        # Try common class patterns
        for cls in ["author", "byline", "post-author", "entry-author"]:
            elem = soup.find(class_=re.compile(cls, re.I))
            if elem:
                text = elem.get_text(strip=True)
                # Clean up "By Author Name" patterns
                text = re.sub(r"^[Bb]y\s+", "", text)
                if text and len(text) < 100:
                    return text

        return None

    def _extract_date(self, soup: BeautifulSoup) -> Optional[str]:
        """Extract publication date from meta tags or common patterns."""
        # Try meta tags
        for prop in ["article:published_time", "datePublished", "date"]:
            meta = soup.find("meta", attrs={"property": prop}) or soup.find(
                "meta", attrs={"name": prop}
            )
            if meta and meta.get("content"):
                return self._format_date(meta["content"])

        # Try time element
        time_elem = soup.find("time")
        if time_elem:
            if time_elem.get("datetime"):
                return self._format_date(time_elem["datetime"])
            return time_elem.get_text(strip=True)

        # Try schema.org
        date_elem = soup.find(attrs={"itemprop": "datePublished"})
        if date_elem:
            if date_elem.get("content"):
                return self._format_date(date_elem["content"])
            if date_elem.get("datetime"):
                return self._format_date(date_elem["datetime"])

        return None

    def _format_date(self, date_str: str) -> str:
        """Format date string to a readable format."""
        # Remove timezone info and time for cleaner display
        date_str = re.sub(r"T.*$", "", date_str)
        # Try to parse and reformat
        try:
            from datetime import datetime

            for fmt in ["%Y-%m-%d", "%Y/%m/%d", "%d-%m-%Y", "%m/%d/%Y"]:
                try:
                    dt = datetime.strptime(date_str, fmt)
                    return dt.strftime("%B %d, %Y")
                except ValueError:
                    continue
        except Exception:
            pass
        return date_str

    def _extract_kicker(self, soup: BeautifulSoup) -> Optional[str]:
        """Extract category/kicker from meta tags or common patterns."""
        # Try meta tags
        for prop in ["article:section", "category"]:
            meta = soup.find("meta", attrs={"property": prop}) or soup.find(
                "meta", attrs={"name": prop}
            )
            if meta and meta.get("content"):
                return meta["content"].upper()

        # Try common class patterns
        for cls in ["category", "kicker", "section", "tag", "topic"]:
            elem = soup.find(class_=re.compile(f"^{cls}$|{cls}-", re.I))
            if elem:
                text = elem.get_text(strip=True)
                if text and len(text) < 50:
                    return text.upper()

        return None

    def _extract_source_name(self, soup: BeautifulSoup, url: str) -> str:
        """Extract the publication/source name."""
        # Try Open Graph site name
        og_site = soup.find("meta", attrs={"property": "og:site_name"})
        if og_site and og_site.get("content"):
            return og_site["content"]

        # Try title tag - often includes site name
        title_elem = soup.find("title")
        if title_elem:
            title = title_elem.get_text()
            # Look for common separators
            for sep in [" | ", " - ", " — ", " :: ", " » "]:
                if sep in title:
                    parts = title.split(sep)
                    # Site name is usually last
                    return parts[-1].strip()

        # Fall back to domain name
        parsed = urlparse(url)
        domain = parsed.netloc
        # Remove www. prefix
        domain = re.sub(r"^www\.", "", domain)
        # Capitalize nicely
        return domain.replace(".", " ").title()

    def _download_and_process_image(
        self,
        url: str,
        alt_text: str = "",
        position: int = 0,
    ) -> Optional[ExtractedImage]:
        """Download an image and convert to optimized data URI."""
        # Skip data URIs (already embedded)
        if url.startswith("data:"):
            return None

        try:
            response = self.client.get(url)
            response.raise_for_status()
        except Exception:
            return None

        # Check content type
        content_type = response.headers.get("content-type", "")
        if not content_type.startswith("image/"):
            # Try to detect image by content
            if len(response.content) < 1000:
                return None

        try:
            # Open and process image
            img = Image.open(io.BytesIO(response.content))

            # Skip very small images (likely icons or spacers)
            if img.width < self.MIN_IMAGE_WIDTH or img.height < self.MIN_IMAGE_HEIGHT:
                return None

            # Convert to RGB for JPEG
            if img.mode in ("RGBA", "P", "LA"):
                background = Image.new("RGB", img.size, (255, 255, 255))
                if img.mode == "P":
                    img = img.convert("RGBA")
                if img.mode in ("RGBA", "LA"):
                    background.paste(img, mask=img.split()[-1])
                else:
                    background.paste(img)
                img = background
            elif img.mode != "RGB":
                img = img.convert("RGB")

            # Resize if too large
            if img.width > self.MAX_IMAGE_WIDTH or img.height > self.MAX_IMAGE_HEIGHT:
                img.thumbnail((self.MAX_IMAGE_WIDTH, self.MAX_IMAGE_HEIGHT), Image.Resampling.LANCZOS)

            # Save to bytes as JPEG
            buffer = io.BytesIO()
            img.save(buffer, format="JPEG", quality=85, optimize=True)
            img_bytes = buffer.getvalue()

            # Create data URI
            b64_data = base64.b64encode(img_bytes).decode("ascii")
            data_uri = f"data:image/jpeg;base64,{b64_data}"

            return ExtractedImage(
                original_url=url,
                data_uri=data_uri,
                width=img.width,
                height=img.height,
                alt_text=alt_text,
                position=position,
            )

        except Exception as e:
            print(f"Warning: Failed to process image {url}: {e}")
            return None


def extract_from_url(url: str, include_images: bool = True) -> ExtractedContent:
    """Convenience function to extract content from a URL."""
    with ContentExtractor() as extractor:
        return extractor.extract(url, include_images=include_images)
