/**
 * Content Analyzer - Analyze article structure and identify design elements
 * Browser-based port of Python analyzer.py
 */

const Analyzer = (function() {
    'use strict';

    // Pull quote constraints (matching Python version)
    const MIN_QUOTE_WORDS = 8;
    const MAX_QUOTE_WORDS = 35;
    const MIN_PARAGRAPHS_BETWEEN_QUOTES = 8;

    // Patterns that indicate good pull quote candidates
    const QUOTE_INDICATORS = [
        /\bthe most\b/i,
        /\bwhat (this|it) (means|implies|suggests)\b/i,
        /\bthe (real|true|key|fundamental)\b/i,
        /\b(striking|remarkable|surprising|fascinating)\b/i,
        /\b(ultimately|fundamentally|essentially)\b/i,
        /\bit('s| is) (not|clear|important|worth)\b/i,
        /\bthe question is\b/i,
        /\bif you (think|believe|consider)\b/i,
        /\bthis is (why|how|what)\b/i,
        /\bthe (problem|answer|solution|truth) is\b/i
    ];

    /**
     * Pull quote candidate
     */
    class PullQuote {
        constructor(text, score, paragraphIndex) {
            this.text = text;
            this.score = score;
            this.paragraphIndex = paragraphIndex;
        }
    }

    /**
     * Image placement suggestion
     */
    class ImagePlacement {
        constructor(image, placementType, paragraphIndex, pairWith = null) {
            this.image = image;
            this.placementType = placementType; // 'hero', 'centered', 'paired'
            this.paragraphIndex = paragraphIndex;
            this.pairWith = pairWith;
        }
    }

    /**
     * Analyzed content result
     */
    class AnalyzedContent {
        constructor(options = {}) {
            this.title = options.title || 'Untitled';
            this.subtitle = options.subtitle || null;
            this.author = options.author || null;
            this.date = options.date || null;
            this.kicker = options.kicker || null;
            this.sourceName = options.sourceName || '';
            this.sourceUrl = options.sourceUrl || '';
            this.htmlContent = options.htmlContent || '';
            this.pullQuotes = options.pullQuotes || [];
            this.imagePlacements = options.imagePlacements || [];
            this.wordCount = options.wordCount || 0;
            this.readingTimeMinutes = options.readingTimeMinutes || 0;
            this.paragraphCount = options.paragraphCount || 0;
        }
    }

    /**
     * Split text into sentences
     */
    function splitSentences(text) {
        // Split on sentence-ending punctuation followed by space and capital letter
        const sentences = text.split(/(?<=[.!?])\s+(?=[A-Z])/);
        return sentences.map(s => s.trim()).filter(s => s.length > 0);
    }

    /**
     * Score a sentence's suitability as a pull quote
     */
    function scorePullQuote(sentence) {
        const words = sentence.split(/\s+/);
        const wordCount = words.length;

        // Must be within word limits
        if (wordCount < MIN_QUOTE_WORDS || wordCount > MAX_QUOTE_WORDS) {
            return 0;
        }

        let score = 0;

        // Prefer medium-length quotes
        if (wordCount >= 12 && wordCount <= 25) {
            score += 2.0;
        } else if (wordCount >= 10 && wordCount <= 30) {
            score += 1.0;
        }

        // Check for quote indicators
        for (const pattern of QUOTE_INDICATORS) {
            if (pattern.test(sentence)) {
                score += 1.5;
            }
        }

        // Bonus for questions (engaging)
        if (sentence.endsWith('?')) {
            score += 1.0;
        }

        // Bonus for quotes within the sentence
        if (sentence.includes('"')) {
            score += 0.5;
        }

        // Penalty for starting with certain words
        const lowerSentence = sentence.toLowerCase();
        if (/^(but |and |so |however,|also )/.test(lowerSentence)) {
            score -= 0.5;
        }

        // Penalty for too many numbers (probably data-heavy)
        const numCount = (sentence.match(/\d+/g) || []).length;
        if (numCount > 2) {
            score -= 1.0;
        }

        // Penalty for sentences with URLs or technical content
        if (lowerSentence.includes('http') || sentence.includes('@')) {
            score -= 2.0;
        }

        return score;
    }

    /**
     * Identify pull quotes from article HTML
     */
    function identifyPullQuotes(doc, numQuotes = 3) {
        const candidates = [];
        const paragraphs = doc.querySelectorAll('p');

        paragraphs.forEach((p, paraIdx) => {
            // Skip very early paragraphs (let the lede breathe)
            if (paraIdx < 2) {
                return;
            }

            const text = p.textContent?.trim() || '';
            if (!text || text.length < 50) {
                return;
            }

            // Split into sentences
            const sentences = splitSentences(text);

            for (const sentence of sentences) {
                const score = scorePullQuote(sentence);
                if (score > 0) {
                    candidates.push(new PullQuote(sentence, score, paraIdx));
                }
            }
        });

        // Sort by score and select top N, but spread them out
        candidates.sort((a, b) => b.score - a.score);

        const selected = [];
        const usedPositions = new Set();

        for (const candidate of candidates) {
            if (selected.length >= numQuotes) {
                break;
            }

            // Don't place pull quotes too close together (at least 8 paragraphs apart)
            let tooClose = false;
            for (const pos of usedPositions) {
                if (Math.abs(candidate.paragraphIndex - pos) < MIN_PARAGRAPHS_BETWEEN_QUOTES) {
                    tooClose = true;
                    break;
                }
            }

            if (tooClose) {
                continue;
            }

            selected.push(candidate);
            usedPositions.add(candidate.paragraphIndex);
        }

        // Sort by position in article
        selected.sort((a, b) => a.paragraphIndex - b.paragraphIndex);

        return selected;
    }

    /**
     * Extract subtitle/deck from article
     */
    function extractSubtitle(doc, title) {
        // Look for explicit subtitle elements
        const subtitleClasses = ['subtitle', 'deck', 'standfirst', 'dek', 'subheadline', 'excerpt'];

        for (const cls of subtitleClasses) {
            const elem = doc.querySelector(`[class*="${cls}" i]`);
            if (elem) {
                const text = elem.textContent?.trim();
                if (text && text !== title && text.length > 30) {
                    return text;
                }
            }
        }

        // Try the first paragraph if it's substantial and looks like a summary
        const paragraphs = doc.querySelectorAll('p');
        for (let i = 0; i < Math.min(2, paragraphs.length); i++) {
            const text = paragraphs[i].textContent?.trim();
            // Good subtitle: 80-300 chars, not the title
            if (text && text !== title && text.length > 80 && text.length < 300) {
                return text;
            }
        }

        return null;
    }

    /**
     * Analyze image placements
     * - First image is hero (full width at top)
     * - Square/vertical images can be paired side-by-side
     * - All images are centered (no text wrapping)
     */
    function analyzeImagePlacements(images, paragraphCount) {
        if (!images || images.length === 0) {
            return [];
        }

        const placements = [];
        const numImages = images.length;

        // Calculate spacing between images
        let spacing;
        if (paragraphCount > 0 && numImages > 1) {
            spacing = Math.max(3, Math.floor(paragraphCount / (numImages + 1)));
        } else {
            spacing = 3;
        }

        // First image is hero (at the very top)
        if (images.length > 0) {
            placements.push(new ImagePlacement(
                images[0],
                'hero',
                0
            ));
        }

        // Process remaining images - pair square/vertical ones
        const remaining = images.slice(1);
        let idx = 0;
        let positionCounter = 1;

        while (idx < remaining.length) {
            const image = remaining[idx];
            const position = Math.min(positionCounter * spacing, paragraphCount - 1);

            // Check if this is a square or vertical image
            const isSquareOrVertical = !image.isLandscape;

            // Try to pair with next image if both are square/vertical
            if (isSquareOrVertical &&
                idx + 1 < remaining.length &&
                !remaining[idx + 1].isLandscape) {

                // Pair these two images
                const nextImage = remaining[idx + 1];

                const placement = new ImagePlacement(
                    image,
                    'paired',
                    position
                );
                const pairPlacement = new ImagePlacement(
                    nextImage,
                    'paired',
                    position
                );
                placement.pairWith = pairPlacement;

                placements.push(placement);
                idx += 2; // Skip the paired image
            } else {
                // Single centered image
                placements.push(new ImagePlacement(
                    image,
                    'centered',
                    position
                ));
                idx += 1;
            }

            positionCounter += 1;
        }

        return placements;
    }

    /**
     * Main analysis function
     */
    function analyze(content, numPullQuotes = 3) {
        // Parse HTML content
        const parser = new DOMParser();
        const doc = parser.parseFromString(content.htmlContent, 'text/html');

        // Find subtitle/deck
        const subtitle = extractSubtitle(doc, content.title);

        // Identify pull quotes
        const pullQuotes = identifyPullQuotes(doc, numPullQuotes);

        // Count paragraphs
        const paragraphCount = doc.querySelectorAll('p').length;

        // Analyze image placements
        const imagePlacements = analyzeImagePlacements(content.images, paragraphCount);

        return new AnalyzedContent({
            title: content.title,
            subtitle: subtitle,
            author: content.author,
            date: content.date,
            kicker: content.kicker,
            sourceName: content.sourceName,
            sourceUrl: content.sourceUrl,
            htmlContent: content.htmlContent,
            pullQuotes: pullQuotes,
            imagePlacements: imagePlacements,
            wordCount: content.wordCount,
            readingTimeMinutes: content.readingTimeMinutes,
            paragraphCount: paragraphCount
        });
    }

    // Public API
    return {
        analyze,
        AnalyzedContent,
        PullQuote,
        ImagePlacement
    };
})();
