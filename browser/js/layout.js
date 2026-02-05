/**
 * Layout Composer - Build article DOM structure with editorial design
 * Browser-based port of Python layout.py
 */

const Layout = (function() {
    'use strict';

    /**
     * Layout options
     */
    class LayoutOptions {
        constructor(options = {}) {
            this.style = options.style || 'magazine'; // 'magazine' or 'minimal'
            this.includeImages = options.includeImages !== false;
            this.includePullQuotes = options.includePullQuotes !== false;
            this.includeDropCap = options.includeDropCap !== false;
            this.includeHeaderFooter = options.includeHeaderFooter !== false;
        }
    }

    /**
     * Create the article header element
     */
    function createHeader(content, options) {
        const header = document.createElement('header');
        header.className = 'article-header';

        // Kicker (Category/Topic)
        if (content.kicker) {
            const kicker = document.createElement('span');
            kicker.className = 'kicker';
            kicker.textContent = content.kicker;
            header.appendChild(kicker);
        }

        // Main Headline
        const headline = document.createElement('h1');
        headline.className = 'headline';
        headline.textContent = content.title;
        header.appendChild(headline);

        // Deck / Standfirst
        if (content.subtitle) {
            const deck = document.createElement('p');
            deck.className = 'deck';
            deck.textContent = content.subtitle;
            header.appendChild(deck);
        }

        // Byline
        const byline = document.createElement('div');
        byline.className = 'byline';

        const parts = [];

        if (content.author) {
            const authorSpan = document.createElement('span');
            authorSpan.className = 'author';
            authorSpan.textContent = `By ${content.author}`;
            byline.appendChild(authorSpan);
            parts.push('author');
        }

        if (content.date) {
            if (parts.length > 0) {
                const sep = document.createElement('span');
                sep.className = 'separator';
                sep.textContent = '•';
                byline.appendChild(sep);
            }
            const dateSpan = document.createElement('span');
            dateSpan.className = 'date';
            dateSpan.textContent = content.date;
            byline.appendChild(dateSpan);
            parts.push('date');
        }

        if (content.readingTimeMinutes) {
            if (parts.length > 0) {
                const sep = document.createElement('span');
                sep.className = 'separator';
                sep.textContent = '•';
                byline.appendChild(sep);
            }
            const readingTime = document.createElement('span');
            readingTime.className = 'reading-time';
            readingTime.textContent = `${content.readingTimeMinutes} min read`;
            byline.appendChild(readingTime);
        }

        if (byline.children.length > 0) {
            header.appendChild(byline);
        }

        return header;
    }

    /**
     * Create a figure element for an image placement
     */
    function createFigure(placement) {
        // Handle paired images
        if (placement.placementType === 'paired' && placement.pairWith) {
            const container = document.createElement('div');
            container.className = 'figure-pair';

            // First image
            const fig1 = document.createElement('figure');
            fig1.className = 'figure paired';
            const img1 = document.createElement('img');
            img1.src = placement.image.dataUri;
            img1.alt = placement.image.altText || 'Article image';
            fig1.appendChild(img1);
            container.appendChild(fig1);

            // Second image
            const fig2 = document.createElement('figure');
            fig2.className = 'figure paired';
            const img2 = document.createElement('img');
            img2.src = placement.pairWith.image.dataUri;
            img2.alt = placement.pairWith.image.altText || 'Article image';
            fig2.appendChild(img2);
            container.appendChild(fig2);

            return container;
        }

        // Single figure (hero or centered)
        const figure = document.createElement('figure');
        figure.className = `figure ${placement.placementType}`;

        const img = document.createElement('img');
        img.src = placement.image.dataUri;
        img.alt = placement.image.altText || 'Article image';
        figure.appendChild(img);

        // Add caption if available
        const captionText = placement.image.caption || placement.image.altText;
        if (captionText && captionText.trim()) {
            const figcaption = document.createElement('figcaption');
            figcaption.textContent = captionText;
            figure.appendChild(figcaption);
        }

        return figure;
    }

    /**
     * Create a pull quote element
     */
    function createPullQuote(quote) {
        const aside = document.createElement('aside');
        aside.className = 'pull-quote';

        const blockquote = document.createElement('blockquote');
        blockquote.textContent = quote.text;
        aside.appendChild(blockquote);

        return aside;
    }

    /**
     * Clone an element and all its children
     */
    function cloneElement(elem) {
        return elem.cloneNode(true);
    }

    /**
     * Compose the article body from analyzed content
     */
    function composeBody(content, options) {
        // Parse the HTML content
        const parser = new DOMParser();
        const doc = parser.parseFromString(content.htmlContent, 'text/html');

        // Find body content
        const mainContent = doc.body || doc;

        // Build image placement map (paragraph_index -> list of placements)
        const imageMap = new Map();
        let heroImage = null;

        for (const placement of content.imagePlacements) {
            if (placement.placementType === 'hero') {
                heroImage = placement;
            } else {
                if (!imageMap.has(placement.paragraphIndex)) {
                    imageMap.set(placement.paragraphIndex, []);
                }
                imageMap.get(placement.paragraphIndex).push(placement);
            }
        }

        // Build pull quote map
        const quoteMap = new Map();
        for (const pq of content.pullQuotes) {
            quoteMap.set(pq.paragraphIndex, pq);
        }

        // Create new article body container
        const articleBody = document.createElement('div');
        articleBody.className = 'article-body';

        // Add hero image at the very top
        if (heroImage && options.includeImages) {
            articleBody.appendChild(createFigure(heroImage));
        }

        // Process all elements, inserting images and pull quotes
        const elements = mainContent.querySelectorAll(
            'p, h1, h2, h3, h4, h5, h6, blockquote, ul, ol, figure, pre'
        );

        let paraCount = 0;
        const insertedQuotes = new Set();

        for (const elem of elements) {
            // Skip empty paragraphs
            if (elem.tagName === 'P' && !elem.textContent?.trim()) {
                continue;
            }

            // Skip figures (we're handling images ourselves)
            if (elem.tagName === 'FIGURE') {
                continue;
            }

            // Clone the element to preserve its structure
            const newElem = cloneElement(elem);

            // Add drop cap class to first paragraph
            if (paraCount === 0 && elem.tagName === 'P' && options.includeDropCap) {
                newElem.classList.add('drop-cap');
            }

            // Add section-heading class to headings
            if (/^H[1-6]$/.test(elem.tagName)) {
                newElem.classList.add('section-heading');
            }

            // Check if we should insert an image BEFORE this paragraph
            if (options.includeImages && imageMap.has(paraCount)) {
                for (const placement of imageMap.get(paraCount)) {
                    articleBody.appendChild(createFigure(placement));
                }
            }

            // Add the element
            articleBody.appendChild(newElem);

            // Check if we should insert a pull quote after this paragraph
            if (options.includePullQuotes &&
                quoteMap.has(paraCount) &&
                !insertedQuotes.has(paraCount)) {

                const quote = quoteMap.get(paraCount);
                articleBody.appendChild(createPullQuote(quote));
                insertedQuotes.add(paraCount);
            }

            if (elem.tagName === 'P') {
                paraCount++;
            }
        }

        // Add any remaining images at the end
        for (const [pos, placements] of imageMap) {
            if (pos >= paraCount) {
                for (const placement of placements) {
                    if (options.includeImages) {
                        articleBody.appendChild(createFigure(placement));
                    }
                }
            }
        }

        return articleBody;
    }

    /**
     * Create the article footer
     */
    function createFooter(content) {
        const footer = document.createElement('footer');
        footer.className = 'article-footer';

        const p = document.createElement('p');
        p.textContent = 'Originally published at ';

        const link = document.createElement('a');
        link.href = content.sourceUrl;
        link.className = 'source-link';
        link.textContent = content.sourceName;
        p.appendChild(link);

        footer.appendChild(p);

        return footer;
    }

    /**
     * Main compose function - builds complete article element
     */
    function compose(content, options = {}) {
        const opts = new LayoutOptions(options);

        // Create article container
        const article = document.createElement('article');
        article.className = 'article';

        // Apply style class
        if (opts.style === 'minimal') {
            article.classList.add('style-minimal');
        }

        // Build article structure
        const header = createHeader(content, opts);
        const body = composeBody(content, opts);

        article.appendChild(header);
        article.appendChild(body);

        // Add footer if enabled
        if (opts.includeHeaderFooter) {
            const footer = createFooter(content);
            article.appendChild(footer);
        }

        return article;
    }

    // Public API
    return {
        compose,
        LayoutOptions
    };
})();
