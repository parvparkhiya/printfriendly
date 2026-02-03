"""
Layout Composer - Apply editorial design system to content.

Preserves original HTML structure (links, paragraphs) while adding
magazine-style presentation with images wrapping text.
"""

import re
from dataclasses import dataclass
from pathlib import Path
from typing import Optional

from bs4 import BeautifulSoup, Tag
from jinja2 import Environment, FileSystemLoader, select_autoescape

from .analyzer import AnalyzedContent, ImagePlacement, PullQuote


@dataclass
class LayoutOptions:
    """Options for layout composition."""

    style: str = "magazine"  # magazine, minimal
    include_images: bool = True
    include_pull_quotes: bool = True
    include_drop_cap: bool = True
    include_header_footer: bool = True


class LayoutComposer:
    """Compose editorial layouts from analyzed content."""

    def __init__(self, templates_dir: Optional[Path] = None):
        """Initialize with optional custom templates directory."""
        if templates_dir is None:
            templates_dir = Path(__file__).parent / "templates"

        self.templates_dir = templates_dir
        self.env = Environment(
            loader=FileSystemLoader(str(templates_dir)),
            autoescape=select_autoescape(["html", "xml"]),
        )

    def compose(
        self,
        content: AnalyzedContent,
        options: Optional[LayoutOptions] = None,
    ) -> str:
        """
        Compose the final HTML layout.

        Args:
            content: Analyzed content to layout
            options: Layout options

        Returns:
            Complete HTML document ready for PDF rendering
        """
        if options is None:
            options = LayoutOptions()

        # Process the article body - preserve original HTML!
        body_html = self._compose_body(content, options)

        # Get the main template
        template = self.env.get_template("article.html")

        # Get the styles directory path for font embedding
        styles_dir = Path(__file__).parent / "styles"
        fonts_dir = Path(__file__).parent / "fonts"

        # Render the complete document
        return template.render(
            title=content.title,
            subtitle=content.subtitle,
            author=content.author,
            date=content.date,
            kicker=content.kicker,
            source_name=content.source_name,
            source_url=content.source_url,
            body_content=body_html,
            word_count=content.word_count,
            reading_time=content.reading_time_minutes,
            style=options.style,
            include_header_footer=options.include_header_footer,
            styles_dir=str(styles_dir),
            fonts_dir=str(fonts_dir),
        )

    def _compose_body(self, content: AnalyzedContent, options: LayoutOptions) -> str:
        """Compose the article body preserving HTML structure."""
        # Parse the original HTML content
        soup = BeautifulSoup(content.html_content, "lxml")

        # Find the body or main content
        body = soup.find("body")
        if body:
            # Work with body's children
            main_content = body
        else:
            # Wrap content in a div
            main_content = soup

        # Create image placement map (paragraph_index -> list of placements)
        image_map = {}
        hero_image = None
        for placement in content.image_placements:
            if placement.placement_type == "hero":
                hero_image = placement
            else:
                if placement.paragraph_index not in image_map:
                    image_map[placement.paragraph_index] = []
                image_map[placement.paragraph_index].append(placement)

        # Create pull quote map
        quote_map = {pq.paragraph_index: pq for pq in content.pull_quotes}

        # Build the new body
        new_body = BeautifulSoup("<div class='article-body'></div>", "html.parser")
        article_body = new_body.find("div")

        # Add hero image at the very top
        if hero_image and options.include_images:
            article_body.append(self._create_figure(hero_image, new_body))

        # Process all elements, inserting images and pull quotes
        paragraphs = main_content.find_all(["p", "h1", "h2", "h3", "h4", "h5", "h6",
                                            "blockquote", "ul", "ol", "figure", "pre"])
        para_count = 0
        inserted_quotes = set()

        for elem in paragraphs:
            # Skip empty paragraphs
            if elem.name == "p" and not elem.get_text(strip=True):
                continue

            # Skip figures (we're handling images ourselves)
            if elem.name == "figure":
                continue

            # Clone the element to preserve its structure
            new_elem = self._clone_element(elem, new_body)

            # Add drop cap class to first paragraph
            if para_count == 0 and elem.name == "p" and options.include_drop_cap:
                existing_class = new_elem.get("class", [])
                if isinstance(existing_class, str):
                    existing_class = [existing_class]
                new_elem["class"] = existing_class + ["drop-cap"]

            # Add section-heading class to headings
            if elem.name in ["h1", "h2", "h3", "h4", "h5", "h6"]:
                existing_class = new_elem.get("class", [])
                if isinstance(existing_class, str):
                    existing_class = [existing_class]
                new_elem["class"] = existing_class + ["section-heading"]

            # Check if we should insert an image BEFORE this paragraph (for wrapping)
            if options.include_images and para_count in image_map:
                for placement in image_map[para_count]:
                    fig = self._create_figure(placement, new_body)
                    article_body.append(fig)

            # Add the element
            article_body.append(new_elem)

            # Check if we should insert a pull quote after this paragraph
            if (
                options.include_pull_quotes
                and para_count in quote_map
                and para_count not in inserted_quotes
            ):
                quote = quote_map[para_count]
                article_body.append(self._create_pull_quote(quote, new_body))
                inserted_quotes.add(para_count)

            if elem.name == "p":
                para_count += 1

        # Add any remaining images at the end
        remaining_positions = set(image_map.keys()) - set(range(para_count))
        for pos in sorted(remaining_positions):
            for placement in image_map[pos]:
                if options.include_images:
                    article_body.append(self._create_figure(placement, new_body))

        return str(article_body)

    def _clone_element(self, elem: Tag, soup: BeautifulSoup) -> Tag:
        """Deep clone an element, preserving all children and attributes."""
        # Create a copy of the element
        new_elem = soup.new_tag(elem.name)

        # Copy attributes
        for attr, value in elem.attrs.items():
            new_elem[attr] = value

        # Copy children (including text and nested elements)
        for child in elem.children:
            if isinstance(child, str):
                new_elem.append(soup.new_string(child))
            elif hasattr(child, 'name'):
                # Recursively clone child elements
                new_elem.append(self._clone_element(child, soup))

        return new_elem

    def _create_figure(self, placement: ImagePlacement, soup: BeautifulSoup) -> Tag:
        """Create a figure element with appropriate placement class."""
        # Map placement types to CSS classes
        css_class = f"figure {placement.placement_type}"

        figure = soup.new_tag("figure", attrs={"class": css_class})

        img = soup.new_tag(
            "img",
            attrs={
                "src": placement.image.data_uri,
                "alt": placement.image.alt_text or "Article image",
            },
        )
        figure.append(img)

        # Add caption if available
        caption_text = placement.image.caption or placement.image.alt_text
        if caption_text and caption_text.strip():
            figcaption = soup.new_tag("figcaption")
            figcaption.string = caption_text
            figure.append(figcaption)

        return figure

    def _create_pull_quote(self, quote: PullQuote, soup: BeautifulSoup) -> Tag:
        """Create a pull quote element."""
        aside = soup.new_tag("aside", attrs={"class": "pull-quote"})

        blockquote = soup.new_tag("blockquote")
        blockquote.string = quote.text
        aside.append(blockquote)

        return aside


def compose_layout(
    content: AnalyzedContent,
    style: str = "magazine",
    include_images: bool = True,
    include_pull_quotes: bool = True,
) -> str:
    """Convenience function to compose layout."""
    composer = LayoutComposer()
    options = LayoutOptions(
        style=style,
        include_images=include_images,
        include_pull_quotes=include_pull_quotes,
    )
    return composer.compose(content, options)
