"""
Content Analyzer - Analyze article structure and identify design elements.

Detects article structure, identifies pull quotes, analyzes image placement,
and calculates reading metrics while PRESERVING the original HTML structure.
"""

import re
from dataclasses import dataclass, field
from typing import Optional

from bs4 import BeautifulSoup, Tag

from .extractor import ExtractedContent, ExtractedImage


@dataclass
class PullQuote:
    """Represents a potential pull quote."""

    text: str
    score: float  # Quality score for ranking
    paragraph_index: int  # Which paragraph it came from


@dataclass
class ImagePlacement:
    """Represents suggested image placement."""

    image: ExtractedImage
    placement_type: str  # hero, centered, paired
    paragraph_index: int  # Insert after which paragraph
    pair_with: Optional["ImagePlacement"] = None  # For paired images


@dataclass
class AnalyzedContent:
    """Represents analyzed article content."""

    title: str
    subtitle: Optional[str]  # Deck/standfirst
    author: Optional[str]
    date: Optional[str]
    kicker: Optional[str]
    source_name: str
    source_url: str

    # IMPORTANT: Preserve the original HTML content
    html_content: str

    pull_quotes: list[PullQuote]
    image_placements: list[ImagePlacement]

    word_count: int
    reading_time_minutes: int
    paragraph_count: int


class ContentAnalyzer:
    """Analyze extracted content for editorial design."""

    # Minimum words for a good pull quote
    MIN_QUOTE_WORDS = 8
    MAX_QUOTE_WORDS = 35

    # Patterns that indicate good pull quote candidates
    QUOTE_INDICATORS = [
        r"\bthe most\b",
        r"\bwhat (this|it) (means|implies|suggests)\b",
        r"\bthe (real|true|key|fundamental)\b",
        r"\b(striking|remarkable|surprising|fascinating)\b",
        r"\b(ultimately|fundamentally|essentially)\b",
        r"\bit('s| is) (not|clear|important|worth)\b",
        r"\bthe question is\b",
        r"\bif you (think|believe|consider)\b",
        r"\bthis is (why|how|what)\b",
        r"\bthe (problem|answer|solution|truth) is\b",
    ]

    def analyze(self, content: ExtractedContent, num_pull_quotes: int = 3) -> AnalyzedContent:
        """
        Analyze extracted content and prepare for layout.

        Args:
            content: The extracted content to analyze
            num_pull_quotes: Number of pull quotes to identify

        Returns:
            AnalyzedContent with structural analysis
        """
        soup = BeautifulSoup(content.html_content, "lxml")

        # Find subtitle/deck (first substantial paragraph or description)
        subtitle = self._extract_subtitle(soup, content.title)

        # Identify pull quotes
        pull_quotes = self._identify_pull_quotes(soup, num_pull_quotes)

        # Count paragraphs
        paragraph_count = len(soup.find_all("p"))

        # Analyze image placements - distribute throughout the article
        image_placements = self._analyze_image_placements(
            content.images, paragraph_count
        )

        return AnalyzedContent(
            title=content.title,
            subtitle=subtitle,
            author=content.author,
            date=content.date,
            kicker=content.kicker,
            source_name=content.source_name,
            source_url=content.source_url,
            html_content=content.html_content,  # Preserve original HTML!
            pull_quotes=pull_quotes,
            image_placements=image_placements,
            word_count=content.word_count,
            reading_time_minutes=content.reading_time_minutes,
            paragraph_count=paragraph_count,
        )

    def _extract_subtitle(self, soup: BeautifulSoup, title: str) -> Optional[str]:
        """Extract a subtitle/deck from the article."""
        # Look for explicit subtitle elements
        for cls in ["subtitle", "deck", "standfirst", "dek", "subheadline", "excerpt"]:
            elem = soup.find(class_=re.compile(cls, re.I))
            if elem:
                text = elem.get_text(strip=True)
                if text and text != title and len(text) > 30:
                    return text

        # Try the first paragraph if it's substantial and looks like a summary
        paragraphs = soup.find_all("p")
        for p in paragraphs[:2]:  # Check first two paragraphs
            text = p.get_text(strip=True)
            # Good subtitle: 80-300 chars, not the title
            if text and text != title and 80 < len(text) < 300:
                # Check if it looks like a summary (often starts with context)
                return text

        return None

    def _identify_pull_quotes(self, soup: BeautifulSoup, num_quotes: int) -> list[PullQuote]:
        """Identify compelling sentences for pull quotes."""
        candidates = []

        paragraphs = soup.find_all("p")
        for para_idx, p in enumerate(paragraphs):
            # Skip very early paragraphs (let the lede breathe)
            if para_idx < 2:
                continue

            text = p.get_text(strip=True)
            if not text or len(text) < 50:
                continue

            # Split into sentences
            sentences = self._split_sentences(text)

            for sentence in sentences:
                score = self._score_pull_quote(sentence)
                if score > 0:
                    candidates.append(
                        PullQuote(
                            text=sentence,
                            score=score,
                            paragraph_index=para_idx,
                        )
                    )

        # Sort by score and select top N, but spread them out
        candidates.sort(key=lambda x: x.score, reverse=True)

        selected = []
        used_positions = set()

        for candidate in candidates:
            if len(selected) >= num_quotes:
                break

            # Don't place pull quotes too close together (at least 8 paragraphs apart)
            too_close = any(
                abs(candidate.paragraph_index - pos) < 8 for pos in used_positions
            )
            if too_close:
                continue

            selected.append(candidate)
            used_positions.add(candidate.paragraph_index)

        # Sort by position in article
        selected.sort(key=lambda x: x.paragraph_index)
        return selected

    def _split_sentences(self, text: str) -> list[str]:
        """Split text into sentences."""
        # Better sentence splitting that handles abbreviations
        sentences = re.split(r'(?<=[.!?])\s+(?=[A-Z])', text)
        return [s.strip() for s in sentences if s.strip()]

    def _score_pull_quote(self, sentence: str) -> float:
        """Score a sentence's suitability as a pull quote."""
        words = sentence.split()
        word_count = len(words)

        # Must be within word limits
        if word_count < self.MIN_QUOTE_WORDS or word_count > self.MAX_QUOTE_WORDS:
            return 0

        score = 0.0

        # Prefer medium-length quotes
        if 12 <= word_count <= 25:
            score += 2.0
        elif 10 <= word_count <= 30:
            score += 1.0

        # Check for quote indicators
        for pattern in self.QUOTE_INDICATORS:
            if re.search(pattern, sentence, re.I):
                score += 1.5

        # Bonus for questions (engaging)
        if sentence.endswith("?"):
            score += 1.0

        # Bonus for quotes within the sentence
        if '"' in sentence:
            score += 0.5

        # Penalty for starting with certain words
        if sentence.lower().startswith(("but ", "and ", "so ", "however,", "also ")):
            score -= 0.5

        # Penalty for too many numbers (probably data-heavy)
        num_count = len(re.findall(r"\d+", sentence))
        if num_count > 2:
            score -= 1.0

        # Penalty for sentences with URLs or technical content
        if "http" in sentence.lower() or "@" in sentence:
            score -= 2.0

        return score

    def _analyze_image_placements(
        self, images: list[ExtractedImage], paragraph_count: int
    ) -> list[ImagePlacement]:
        """Determine optimal placement for each image.

        - First image is hero (full width at top)
        - Square/vertical images are paired side-by-side when possible
        - All images are centered (no text wrapping)
        """
        if not images:
            return []

        placements = []
        num_images = len(images)

        # Calculate spacing between images
        if paragraph_count > 0 and num_images > 1:
            spacing = max(3, paragraph_count // (num_images + 1))
        else:
            spacing = 3

        # Separate first image (hero) from rest
        if images:
            placements.append(
                ImagePlacement(
                    image=images[0],
                    placement_type="hero",
                    paragraph_index=0,
                )
            )

        # Process remaining images - pair square/vertical ones
        remaining = images[1:]
        idx = 0
        position_counter = 1

        while idx < len(remaining):
            image = remaining[idx]
            position = min(position_counter * spacing, paragraph_count - 1)

            # Check if this is a square or vertical image
            is_square_or_vertical = not image.is_landscape

            # Try to pair with next image if both are square/vertical
            if (
                is_square_or_vertical
                and idx + 1 < len(remaining)
                and not remaining[idx + 1].is_landscape
            ):
                # Pair these two images
                next_image = remaining[idx + 1]
                placement = ImagePlacement(
                    image=image,
                    placement_type="paired",
                    paragraph_index=position,
                )
                pair_placement = ImagePlacement(
                    image=next_image,
                    placement_type="paired",
                    paragraph_index=position,
                )
                placement.pair_with = pair_placement
                placements.append(placement)
                idx += 2  # Skip the paired image
            else:
                # Single centered image
                placements.append(
                    ImagePlacement(
                        image=image,
                        placement_type="centered",
                        paragraph_index=position,
                    )
                )
                idx += 1

            position_counter += 1

        return placements


def analyze_content(content: ExtractedContent, num_pull_quotes: int = 3) -> AnalyzedContent:
    """Convenience function to analyze content."""
    analyzer = ContentAnalyzer()
    return analyzer.analyze(content, num_pull_quotes)
