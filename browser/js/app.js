/**
 * PrintFriendly Browser Edition - Main Application
 * Handles UI, form submission, and print functionality
 */

(function() {
    'use strict';

    // DOM Elements
    const form = document.getElementById('convert-form');
    const submitBtn = document.getElementById('submit-btn');
    const loading = document.getElementById('loading');
    const loadingMessage = document.getElementById('loading-message');
    const error = document.getElementById('error');
    const errorMessage = document.getElementById('error-message');
    const warningsPanel = document.getElementById('warnings-panel');
    const warningsList = document.getElementById('warnings-list');
    const previewSection = document.getElementById('preview-section');
    const previewContainer = document.getElementById('preview-container');
    const printContainer = document.getElementById('print-container');
    const printBtn = document.getElementById('print-btn');
    const resetBtn = document.getElementById('reset-btn');

    // Input mode tabs
    const tabBtns = document.querySelectorAll('.tab-btn');
    const urlInputGroup = document.getElementById('url-input-group');
    const htmlInputGroup = document.getElementById('html-input-group');
    const urlInput = document.getElementById('url');
    const htmlContentInput = document.getElementById('html-content');
    const sourceUrlInput = document.getElementById('source-url');

    // Current input mode
    let inputMode = 'url';

    // Thinking verbs cycling
    let thinkingInterval = null;

    /**
     * Switch between URL and HTML input modes
     */
    function switchInputMode(mode) {
        inputMode = mode;

        tabBtns.forEach(btn => {
            btn.classList.toggle('active', btn.dataset.mode === mode);
        });

        if (mode === 'url') {
            urlInputGroup.classList.remove('hidden');
            htmlInputGroup.classList.add('hidden');
            urlInput.required = true;
        } else {
            urlInputGroup.classList.add('hidden');
            htmlInputGroup.classList.remove('hidden');
            urlInput.required = false;
        }
    }

    /**
     * Get a random thinking verb
     */
    function getRandomVerb() {
        const idx = Math.floor(Math.random() * THINKING_VERBS.length);
        return THINKING_VERBS[idx] + '...';
    }

    /**
     * Start cycling thinking verbs every second
     */
    function startThinkingVerbs() {
        stopThinkingVerbs();
        loadingMessage.textContent = getRandomVerb();
        thinkingInterval = setInterval(() => {
            loadingMessage.textContent = getRandomVerb();
        }, 1000);
    }

    /**
     * Stop cycling thinking verbs
     */
    function stopThinkingVerbs() {
        if (thinkingInterval) {
            clearInterval(thinkingInterval);
            thinkingInterval = null;
        }
    }

    /**
     * Show loading state
     */
    function showLoading() {
        loading.classList.add('active');
        error.classList.remove('active');
        hideWarnings();
        submitBtn.disabled = true;
        if (!thinkingInterval) {
            startThinkingVerbs();
        }
    }

    /**
     * Hide loading state
     */
    function hideLoading() {
        loading.classList.remove('active');
        submitBtn.disabled = false;
        stopThinkingVerbs();
    }

    /**
     * Show error message
     */
    function showError(message) {
        errorMessage.textContent = message;
        error.classList.add('active');
        hideLoading();
    }

    /**
     * Show non-fatal warnings/errors encountered during processing
     */
    function showWarnings(warnings) {
        if (!warnings || warnings.length === 0) {
            warningsPanel.classList.add('hidden');
            warningsList.innerHTML = '';
            return;
        }
        warningsList.innerHTML = '';
        warnings.forEach(function(msg) {
            const li = document.createElement('li');
            li.textContent = msg;
            warningsList.appendChild(li);
        });
        warningsPanel.classList.remove('hidden');
    }

    /**
     * Hide warnings panel
     */
    function hideWarnings() {
        warningsPanel.classList.add('hidden');
        warningsList.innerHTML = '';
    }

    /**
     * Show preview
     */
    function showPreview(articleElement) {
        // Clear previous content
        previewContainer.innerHTML = '';
        printContainer.innerHTML = '';

        // Add to preview
        previewContainer.appendChild(articleElement);

        // Clone for print container
        printContainer.appendChild(articleElement.cloneNode(true));

        // Show preview section
        previewSection.classList.remove('hidden');

        // Scroll to preview
        previewSection.scrollIntoView({ behavior: 'smooth' });
    }

    /**
     * Reset to initial state
     */
    function reset() {
        previewSection.classList.add('hidden');
        previewContainer.innerHTML = '';
        printContainer.innerHTML = '';
        form.reset();
        error.classList.remove('active');
        hideWarnings();
        hideLoading();
        switchInputMode('url');
    }

    /**
     * Get form options
     */
    function getOptions() {
        const formData = new FormData(form);

        return {
            style: formData.get('style') || 'magazine',
            includeImages: formData.get('include_images') === 'true',
            includePullQuotes: formData.get('include_pull_quotes') === 'true'
        };
    }

    /**
     * Main processing pipeline
     */
    async function processArticle() {
        const options = getOptions();

        try {
            // Step 1: Get input
            let input, sourceUrl;

            if (inputMode === 'url') {
                input = urlInput.value.trim();
                if (!input) {
                    throw new Error('Please enter a URL');
                }
                sourceUrl = '';
            } else {
                input = htmlContentInput.value.trim();
                if (!input) {
                    throw new Error('Please paste the HTML content');
                }
                sourceUrl = sourceUrlInput.value.trim() || 'about:blank';
            }

            // Step 2: Extract content
            showLoading();
            const extracted = await Extractor.extract(input, sourceUrl, () => {}, { includeImages: options.includeImages });

            // Step 3: Analyze content
            const analyzed = Analyzer.analyze(extracted, options.includePullQuotes ? 3 : 0);

            // Step 4: Compose layout
            const article = Layout.compose(analyzed, options);

            // Step 5: Show preview and any warnings
            hideLoading();
            showPreview(article);
            showWarnings(extracted.warnings);

        } catch (err) {
            console.error('Processing error:', err);
            showError(err.message || 'An error occurred while processing the article');
            hideWarnings();
        }
    }

    /**
     * Print the article
     */
    function printArticle() {
        window.print();
    }

    // Event Listeners

    // Tab switching
    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            switchInputMode(btn.dataset.mode);
        });
    });

    // Form submission
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        await processArticle();
    });

    // Print button
    printBtn.addEventListener('click', printArticle);

    // Reset button
    resetBtn.addEventListener('click', reset);

    // Keyboard shortcut: Ctrl/Cmd + P to print (when preview is visible)
    document.addEventListener('keydown', (e) => {
        if ((e.ctrlKey || e.metaKey) && e.key === 'p') {
            if (!previewSection.classList.contains('hidden')) {
                e.preventDefault();
                printArticle();
            }
        }
    });

    // Initialize
    switchInputMode('url');

    // Display uncaught errors on the page
    window.onerror = function(message, source, lineno, colno, err) {
        const detail = err && err.message ? err.message : message;
        const location = source ? ` (${source}:${lineno})` : '';
        showError(detail + location);
        return false; // allow default handling as well (e.g. console)
    };

})();
