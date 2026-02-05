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
            this.warnings = options.warnings || [];
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
    async function imageToDataUri(imgUrl, baseUrl, onReportError) {
        const absoluteUrl = new URL(imgUrl, baseUrl).href;

        // Race all CORS proxies + direct fetch in parallel
        const fetchUrls = [
            ...CORS_PROXIES.map(fn => fn(absoluteUrl)),
            absoluteUrl
        ];

        try {
            return await Promise.any(
                fetchUrls.map(url =>
                    fetch(url, {
                        headers: { 'Accept': 'image/*,*/*' }
                    })
                        .then(r => {
                            if (!r.ok) throw new Error(`HTTP ${r.status}`);
                            const type = (r.headers.get('content-type') || '').toLowerCase();
                            if (type.startsWith('text/') || type.startsWith('application/json')) throw new Error(`Not an image: ${type}`);
                            return r.blob();
                        })
                        .then(blob => {
                            const blobType = (blob.type || '').toLowerCase();
                            if (blobType.startsWith('text/') || blobType === 'application/json') {
                                throw new Error(`Server returned ${blob.type || 'non-image'} (possible error page or hotlink protection)`);
                            }
                            return processImageBlob(blob);
                        })
                )
            );
        } catch (err) {
            const reason = err.message || '';
            const msg = reason.includes('hotlink') || reason.includes('error page')
                ? `Failed to load image: ${imgUrl} — ${reason}`
                : `Failed to load image: ${imgUrl}`;
            console.warn(msg, err);
            if (typeof onReportError === 'function') onReportError(msg);
            return null;
        }
    }

    /**
     * Extract and process images from article content
     * @param {string} htmlContent
     * @param {string} baseUrl
     * @param {function} onProgress
     * @param {function} onReportError - optional, called with (message) for each non-fatal error
     */
    async function extractImages(htmlContent, baseUrl, onProgress, onReportError) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(htmlContent, 'text/html');

        const imgElements = doc.querySelectorAll('img[src]');
        const images = [];

        // Separate data URI images (fast) from URL images (need fetching)
        const dataUriImgs = [];
        const urlImgs = [];

        for (const img of imgElements) {
            const src = img.getAttribute('src');
            if (!src) continue;

            if (src.startsWith('data:')) {
                dataUriImgs.push(img);
            } else {
                // Skip tracking pixels and icons
                const width = parseInt(img.getAttribute('width') || '0', 10);
                const height = parseInt(img.getAttribute('height') || '0', 10);
                if ((width > 0 && width < MIN_IMAGE_SIZE) ||
                    (height > 0 && height < MIN_IMAGE_SIZE)) {
                    continue;
                }
                urlImgs.push(img);
            }
        }

        // Process data URI images first (no network, fast)
        for (const img of dataUriImgs) {
            if (images.length >= 10) break;
            const src = img.getAttribute('src');
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
        }

        // Fetch URL images in parallel batches of 4; try all candidates until we have enough (many may fail due to CORS etc.)
        const BATCH_SIZE = 4;
        const maxImages = 10;
        const maxToAttempt = 50; // cap attempts so we don't hammer proxies on image-heavy pages
        const toFetch = urlImgs.slice(0, maxToAttempt);
        let processed = 0;

        for (let i = 0; i < toFetch.length && images.length < maxImages; i += BATCH_SIZE) {
            const batch = toFetch.slice(i, i + BATCH_SIZE);
            if (onProgress) {
                onProgress(`Processing images (${processed + batch.length}/${toFetch.length} attempted, ${images.length} included)...`);
            }

            const results = await Promise.all(
                batch.map(async (img) => {
                    const src = img.getAttribute('src');
                    const result = await imageToDataUri(src, baseUrl, onReportError);
                    if (result) {
                        return new ExtractedImage({
                            dataUri: result.dataUri,
                            altText: img.getAttribute('alt') || '',
                            caption: '',
                            width: result.width,
                            height: result.height
                        });
                    }
                    return null;
                })
            );

            for (const result of results) {
                if (result && images.length < maxImages) {
                    images.push(result);
                }
            }
            processed += batch.length;
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

        // Collect non-fatal errors to display on the page
        const warnings = [];
        function reportError(msg) {
            warnings.push(msg);
        }

        // Extract and process images (skip if not needed)
        let images = [];
        if (options.includeImages !== false) {
            if (onProgress) onProgress('Processing images...');
            images = await extractImages(article.content, url, onProgress, reportError);
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
            readingTimeMinutes: metrics.readingTimeMinutes,
            warnings: warnings
        });
    }

    // Public API
    return {
        extract,
        ExtractedContent,
        ExtractedImage
    };
})();
