/**
 * Content Extractor - Fetch and parse article content
 * Browser-based equivalent of Python extractor.py
 */

const Extractor = (function() {
    'use strict';

    // CORS proxy services (free, no backend needed)
    const CORS_PROXIES = [
        url => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
        url => `https://corsproxy.io/?${encodeURIComponent(url)}`
    ];

    // Image constraints (matching Python version)
    const MIN_IMAGE_SIZE = 150;
    const MAX_IMAGE_WIDTH = 1200;
    const MAX_IMAGE_HEIGHT = 1600;
    const JPEG_QUALITY = 0.85;

    /**
     * Extracted content result
     */
    class ExtractedContent {
        constructor(options = {}) {
            this.title = options.title || 'Untitled';
            this.htmlContent = options.htmlContent || '';
            this.author = options.author || null;
            this.date = options.date || null;
            this.kicker = options.kicker || null;
            this.sourceName = options.sourceName || '';
            this.sourceUrl = options.sourceUrl || '';
            this.images = options.images || [];
            this.wordCount = options.wordCount || 0;
            this.readingTimeMinutes = options.readingTimeMinutes || 0;
        }
    }

    /**
     * Extracted image data
     */
    class ExtractedImage {
        constructor(options = {}) {
            this.dataUri = options.dataUri || '';
            this.altText = options.altText || '';
            this.caption = options.caption || '';
            this.width = options.width || 0;
            this.height = options.height || 0;
            this.isLandscape = options.width > options.height;
        }
    }

    /**
     * Fetch URL content via CORS proxy
     */
    async function fetchViaProxy(url, onProgress) {
        let lastError = null;

        for (const proxyFn of CORS_PROXIES) {
            const proxyUrl = proxyFn(url);
            if (onProgress) onProgress(`Trying proxy...`);

            try {
                const response = await fetch(proxyUrl, {
                    headers: {
                        'Accept': 'text/html,application/xhtml+xml'
                    }
                });

                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}`);
                }

                const html = await response.text();
                if (html && html.length > 100) {
                    return html;
                }
            } catch (err) {
                lastError = err;
                console.warn(`Proxy failed: ${err.message}`);
            }
        }

        throw new Error(`Failed to fetch URL: ${lastError?.message || 'All proxies failed'}`);
    }

    /**
     * Extract article using Readability
     */
    function parseWithReadability(html, url) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');

        // Fix relative URLs in the document
        const base = doc.createElement('base');
        base.href = url;
        doc.head.appendChild(base);

        // Clone document for Readability (it modifies the DOM)
        const docClone = doc.cloneNode(true);

        // Parse with Readability
        const reader = new Readability(docClone);
        const article = reader.parse();

        if (!article) {
            throw new Error('Could not extract article content');
        }

        return {
            title: article.title || 'Untitled',
            content: article.content || '',
            excerpt: article.excerpt || '',
            byline: article.byline || '',
            siteName: article.siteName || '',
            originalDoc: doc
        };
    }

    /**
     * Extract metadata from document
     */
    function extractMetadata(doc, article, url) {
        const metadata = {
            author: null,
            date: null,
            kicker: null,
            sourceName: '',
            sourceUrl: url
        };

        // Author: from Readability byline or meta tags
        if (article.byline) {
            metadata.author = article.byline.replace(/^by\s+/i, '');
        } else {
            const authorMeta = doc.querySelector('meta[name="author"], meta[property="article:author"]');
            if (authorMeta) {
                metadata.author = authorMeta.content;
            }
        }

        // Date: from meta tags
        const dateMeta = doc.querySelector(
            'meta[property="article:published_time"], ' +
            'meta[name="date"], ' +
            'meta[name="publish-date"], ' +
            'time[datetime]'
        );
        if (dateMeta) {
            const dateStr = dateMeta.content || dateMeta.getAttribute('datetime');
            if (dateStr) {
                try {
                    const date = new Date(dateStr);
                    metadata.date = date.toLocaleDateString('en-US', {
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric'
                    });
                } catch (e) {
                    // Keep original string if parsing fails
                    metadata.date = dateStr;
                }
            }
        }

        // Source name: from Readability or og:site_name
        if (article.siteName) {
            metadata.sourceName = article.siteName;
        } else {
            const siteMeta = doc.querySelector('meta[property="og:site_name"]');
            if (siteMeta) {
                metadata.sourceName = siteMeta.content;
            } else {
                // Fall back to hostname
                try {
                    metadata.sourceName = new URL(url).hostname.replace(/^www\./, '');
                } catch (e) {
                    metadata.sourceName = 'Unknown Source';
                }
            }
        }

        // Kicker: look for common category/tag elements
        const kickerSelectors = [
            '.kicker', '.eyebrow', '.category', '.topic',
            '[class*="category"]', '[class*="topic"]',
            'meta[property="article:section"]'
        ];
        for (const selector of kickerSelectors) {
            const kickerEl = doc.querySelector(selector);
            if (kickerEl) {
                metadata.kicker = kickerEl.content || kickerEl.textContent?.trim();
                if (metadata.kicker && metadata.kicker.length < 50) {
                    break;
                }
                metadata.kicker = null;
            }
        }

        return metadata;
    }

    /**
     * Load image blob into canvas, validate size, and convert to JPEG data URI
     */
    function processImageBlob(blob) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            const objectUrl = URL.createObjectURL(blob);

            img.onload = () => {
                URL.revokeObjectURL(objectUrl);

                // Check size constraints
                if (img.width < MIN_IMAGE_SIZE || img.height < MIN_IMAGE_SIZE) {
                    reject(new Error('Image too small'));
                    return;
                }

                // Calculate scaled dimensions
                let width = img.width;
                let height = img.height;

                if (width > MAX_IMAGE_WIDTH) {
                    height = Math.round(height * (MAX_IMAGE_WIDTH / width));
                    width = MAX_IMAGE_WIDTH;
                }
                if (height > MAX_IMAGE_HEIGHT) {
                    width = Math.round(width * (MAX_IMAGE_HEIGHT / height));
                    height = MAX_IMAGE_HEIGHT;
                }

                // Draw to canvas and convert to JPEG
                const canvas = document.createElement('canvas');
                canvas.width = width;
                canvas.height = height;

                const ctx = canvas.getContext('2d');
                ctx.fillStyle = '#FFFFFF';
                ctx.fillRect(0, 0, width, height);
                ctx.drawImage(img, 0, 0, width, height);

                const dataUri = canvas.toDataURL('image/jpeg', JPEG_QUALITY);

                resolve({ dataUri, width, height });
            };

            img.onerror = () => {
                URL.revokeObjectURL(objectUrl);
                reject(new Error('Failed to load image'));
            };

            img.src = objectUrl;
        });
    }

    /**
     * Get dimensions of a data URI image
     */
    function getDataUriDimensions(dataUri) {
        return new Promise((resolve) => {
            const img = new Image();
            img.onload = () => resolve({ width: img.width, height: img.height });
            img.onerror = () => resolve(null);
            img.src = dataUri;
        });
    }

    /**
     * Convert image URL to base64 data URI via CORS proxy
     * Tries all available proxies, then direct fetch as fallback
     */
    async function imageToDataUri(imgUrl, baseUrl) {
        const absoluteUrl = new URL(imgUrl, baseUrl).href;

        // Try each CORS proxy, then direct fetch as last resort
        const fetchUrls = [
            ...CORS_PROXIES.map(fn => fn(absoluteUrl)),
            absoluteUrl
        ];

        for (const fetchUrl of fetchUrls) {
            try {
                const response = await fetch(fetchUrl);
                if (!response.ok) continue;

                const blob = await response.blob();
                return await processImageBlob(blob);
            } catch (err) {
                // Try next source
                continue;
            }
        }

        console.warn(`Failed to process image ${imgUrl}: all sources failed`);
        return null;
    }

    /**
     * Extract and process images from article content
     */
    async function extractImages(htmlContent, baseUrl, onProgress) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(htmlContent, 'text/html');

        const imgElements = doc.querySelectorAll('img[src]');
        const images = [];

        let processed = 0;
        const total = imgElements.length;

        for (const img of imgElements) {
            processed++;
            if (onProgress) {
                onProgress(`Processing images (${processed}/${total})...`);
            }

            const src = img.getAttribute('src');
            if (!src) {
                continue;
            }

            // Handle data URI images directly (common in newsletters with inlined images)
            if (src.startsWith('data:')) {
                try {
                    const dims = await getDataUriDimensions(src);
                    if (dims && dims.width >= MIN_IMAGE_SIZE && dims.height >= MIN_IMAGE_SIZE) {
                        images.push(new ExtractedImage({
                            dataUri: src,
                            altText: img.getAttribute('alt') || '',
                            caption: '',
                            width: dims.width,
                            height: dims.height
                        }));
                    }
                } catch (e) {
                    // Skip invalid data URIs
                }
                if (images.length >= 10) break;
                continue;
            }

            // Skip tracking pixels and icons
            const width = parseInt(img.getAttribute('width') || '0', 10);
            const height = parseInt(img.getAttribute('height') || '0', 10);
            if ((width > 0 && width < MIN_IMAGE_SIZE) ||
                (height > 0 && height < MIN_IMAGE_SIZE)) {
                continue;
            }

            const result = await imageToDataUri(src, baseUrl);
            if (result) {
                images.push(new ExtractedImage({
                    dataUri: result.dataUri,
                    altText: img.getAttribute('alt') || '',
                    caption: '', // Will be filled from figcaption if available
                    width: result.width,
                    height: result.height
                }));

                // Limit to reasonable number of images
                if (images.length >= 10) {
                    break;
                }
            }
        }

        return images;
    }

    /**
     * Calculate word count and reading time
     */
    function calculateReadingMetrics(htmlContent) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(htmlContent, 'text/html');
        const text = doc.body?.textContent || '';

        const words = text.trim().split(/\s+/).filter(w => w.length > 0);
        const wordCount = words.length;

        // Average reading speed: 200-250 words per minute
        const readingTimeMinutes = Math.max(1, Math.ceil(wordCount / 225));

        return { wordCount, readingTimeMinutes };
    }

    /**
     * Main extraction function
     */
    async function extract(urlOrHtml, sourceUrl = '', onProgress, options = {}) {
        const isHtml = urlOrHtml.trim().startsWith('<') ||
                       urlOrHtml.trim().startsWith('<!');

        let html, url;

        if (isHtml) {
            // Direct HTML input
            html = urlOrHtml;
            url = sourceUrl || 'about:blank';
            if (onProgress) onProgress('Parsing HTML...');
        } else {
            // URL input - fetch via proxy
            url = urlOrHtml;
            if (onProgress) onProgress('Fetching article...');
            html = await fetchViaProxy(url, onProgress);
        }

        // Parse with Readability
        if (onProgress) onProgress('Extracting content...');
        const article = parseWithReadability(html, url);

        // Extract metadata
        const metadata = extractMetadata(article.originalDoc, article, url);

        // Extract and process images (skip if not needed)
        let images = [];
        if (options.includeImages !== false) {
            if (onProgress) onProgress('Processing images...');
            images = await extractImages(article.content, url, onProgress);
        }

        // Calculate reading metrics
        const metrics = calculateReadingMetrics(article.content);

        return new ExtractedContent({
            title: article.title,
            htmlContent: article.content,
            author: metadata.author,
            date: metadata.date,
            kicker: metadata.kicker,
            sourceName: metadata.sourceName,
            sourceUrl: metadata.sourceUrl,
            images: images,
            wordCount: metrics.wordCount,
            readingTimeMinutes: metrics.readingTimeMinutes
        });
    }

    // Public API
    return {
        extract,
        ExtractedContent,
        ExtractedImage
    };
})();
