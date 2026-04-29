/**
 * Accessibility Toolkit - Chrome Extension Content Script
 * Bundled from ua-widget.js and all modules
 */

(function () {
  'use strict';

  // ============================================
  // core/targeting.js
  // ============================================

  const DEFAULT_TARGETING_OPTIONS = {
    semanticSelectors: ["main", "article", '[role="main"]', '[role="log"]', '[aria-live]'],
    excludeSelectors: [
      "header", "nav", "footer", "aside",
      '[role="navigation"]', '[role="banner"]', '[role="contentinfo"]', '[role="complementary"]',
      ".navbar", ".nav", ".menu", ".site-header", ".site-footer",
      ".sidebar", ".aside", ".cookie", ".cookies", ".banner", ".modal", ".popup",
      ".ads", ".advert", ".advertisement", ".breadcrumb"
    ],
    excludeIdClassRegex: /(nav|navbar|menu|header|footer|sidebar|aside|cookie|banner|modal|popup|dialog|ads|advert|breadcrumb)/i,
    candidateSelectors: ["article", "main", "section", "div"],
    minTextLength: 400,
    minParagraphs: 2,
    allowMultipleRoots: false,
    multiRootScoreRatio: 0.82,
  };

  function findContentRoots(options = {}) {
    const opt = { ...DEFAULT_TARGETING_OPTIONS, ...options };

    const semantic = pickBestFromSemantic(opt);
    if (semantic && semantic.length) return semantic;

    let scored = scoreCandidates(opt);

    // Step 3.5: LLM/Chat transcript rescue
    scored = applyChatRescue(scored, opt);

    if (!scored.length) return [];

    const best = scored[0];
    if (!opt.allowMultipleRoots) return [best.el];

    const roots = [best.el];
    const cutoff = best.score * opt.multiRootScoreRatio;
    for (let i = 1; i < scored.length; i++) {
      const cand = scored[i];
      if (cand.score < cutoff) break;
      if (!best.el.contains(cand.el) && !cand.el.contains(best.el)) {
        roots.push(cand.el);
      }
    }
    return roots;
  }

  function pickBestFromSemantic(opt) {
    const candidates = [];
    for (const sel of opt.semanticSelectors) {
      docQueryAll(sel).forEach(el => {
        if (isEligibleContainer(el, opt)) {
          candidates.push(el);
        }
      });
    }
    if (!candidates.length) return [];

    candidates.sort((a, b) => getTextLen(b) - getTextLen(a));
    const best = candidates[0];

    if (!opt.allowMultipleRoots) return [best];

    const bestLen = getTextLen(best);
    const roots = [best];
    for (let i = 1; i < candidates.length; i++) {
      const el = candidates[i];
      const len = getTextLen(el);
      if (len >= bestLen * opt.multiRootScoreRatio && !best.contains(el) && !el.contains(best)) {
        roots.push(el);
      }
    }
    return roots;
  }

  // ============================================
  // Auto-Calibration Helper Functions
  // ============================================

  /**
   * Compute interactive elements density per ~1000 chars.
   * This normalizes counts across different content lengths.
   */
  function calcInteractiveDensity(el, textLen) {
    const count = el.querySelectorAll(
      "button,input,select,textarea,[role='button'],[contenteditable='true']"
    ).length;
    return count / (textLen / 1000 + 1);
  }

  /**
   * Compute paragraph density per ~1000 chars.
   */
  function calcParagraphDensity(el, textLen) {
    return el.querySelectorAll("p").length / (textLen / 1000 + 1);
  }

  /**
   * Compute median and IQR (interquartile range) for robust statistics.
   * These are resistant to outliers unlike mean/stddev.
   */
  function computeMedianIQR(values) {
    if (!values.length) return { median: 0, iqr: 1 };
    const sorted = [...values].sort((a, b) => a - b);
    const mid = Math.floor(sorted.length / 2);
    const median = sorted.length % 2
      ? sorted[mid]
      : (sorted[mid - 1] + sorted[mid]) / 2;

    const q1Idx = Math.floor(sorted.length * 0.25);
    const q3Idx = Math.floor(sorted.length * 0.75);
    const q1 = sorted[q1Idx];
    const q3 = sorted[q3Idx];
    const iqr = Math.max(q3 - q1, 0.01);

    return { median, iqr };
  }

  /**
   * Convert raw value to z-score relative to page distribution.
   * z ≈ 0 means typical, z > 0 means higher than typical.
   */
  function toZScore(value, median, iqr) {
    return (value - median) / (iqr + 0.001);
  }

  /**
   * Calculate feature usefulness based on IQR.
   * If IQR is tiny, feature can't discriminate → reduce weight.
   */
  function calcUsefulness(iqr, targetRange = 0.3) {
    return Math.max(0.15, Math.min(1.0, iqr / targetRange));
  }

  // ============================================
  // Auto-Calibrated Candidate Scoring
  // ============================================

  function scoreCandidates(opt) {
    const candidates = [];
    const seen = new Set();

    // Pass 1: Collect raw features for all candidates
    for (const sel of opt.candidateSelectors) {
      docQueryAll(sel).forEach(el => {
        if (seen.has(el)) return;
        seen.add(el);
        if (!isEligibleContainer(el, opt)) return;

        const textLen = getTextLen(el);
        if (textLen < opt.minTextLength) return;

        const pCount = el.querySelectorAll("p").length;
        const liCount = el.querySelectorAll("li").length;
        const headingCount = el.querySelectorAll("h1,h2,h3").length;

        if (pCount < opt.minParagraphs && (pCount + liCount) < opt.minParagraphs) return;

        const linkTextLen = getLinkTextLen(el);
        const linkDensity = textLen > 0 ? linkTextLen / textLen : 1;
        const interactiveDensity = calcInteractiveDensity(el, textLen);
        const paragraphDensity = calcParagraphDensity(el, textLen);

        candidates.push({
          el,
          textLen,
          pCount,
          liCount,
          headingCount,
          linkDensity,
          interactiveDensity,
          paragraphDensity,
        });
      });
    }

    if (!candidates.length) return [];

    // Pass 2: Compute page baselines using robust statistics
    const linkStats = computeMedianIQR(candidates.map(c => c.linkDensity));
    const interactiveStats = computeMedianIQR(candidates.map(c => c.interactiveDensity));

    // Compute feature usefulness (how discriminative each feature is on this page)
    const linkUsefulness = calcUsefulness(linkStats.iqr, 0.2);
    const interactiveUsefulness = calcUsefulness(interactiveStats.iqr, 1.0);

    // Pass 3: Score with calibrated penalties
    const scored = [];
    const maxTextLen = Math.max(...candidates.map(c => c.textLen));

    for (const c of candidates) {
      let score = 0;

      // Positive signals (unchanged - proven to work)
      score += Math.min(40, c.textLen / 200);
      score += c.pCount * 3;
      score += c.liCount * 1.2;
      score += c.headingCount * 2;

      // CALIBRATED penalties - only penalize outliers
      const linkZ = toZScore(c.linkDensity, linkStats.median, linkStats.iqr);
      const interactiveZ = toZScore(c.interactiveDensity, interactiveStats.median, interactiveStats.iqr);

      // Penalize only when ABOVE median (z > 0), scaled by usefulness
      // Saturate penalties to prevent domination over positive signals
      if (linkZ > 0) {
        score -= Math.min(25, linkZ * 15 * linkUsefulness);
      }
      if (interactiveZ > 0) {
        score -= Math.min(20, interactiveZ * 10 * interactiveUsefulness);
      }

      // Card grid penalty (density-based, reduced from -15 to -10)
      const childCount = c.el.children ? c.el.children.length : 0;
      if (childCount > 40 && c.textLen / childCount < 80) {
        score -= 10;
      }

      // Excluded id/class penalty
      if (opt.excludeIdClassRegex.test((c.el.id || "") + " " + (c.el.className || ""))) {
        score -= 10;
      }

      if (score > 0) {
        scored.push({ el: c.el, score, textLen: c.textLen });
      }
    }

    scored.sort((a, b) => b.score - a.score);

    // Coverage constraint: ensure winner covers meaningful share of content
    if (scored.length > 0) {
      const winner = scored[0];
      const coverage = winner.textLen / maxTextLen;

      // If coverage is too low, try expanding to parent
      if (coverage < 0.4 && winner.el.parentElement) {
        const parent = winner.el.parentElement;
        const parentTextLen = getTextLen(parent);
        const parentCoverage = parentTextLen / maxTextLen;

        // Only use parent if it provides significantly better coverage
        if (parentCoverage > coverage * 1.3 && isEligibleContainer(parent, opt)) {
          scored.unshift({ el: parent, score: winner.score * 0.95, textLen: parentTextLen });
        }
      }
    }

    return scored;
  }

  function isEligibleContainer(el, opt) {
    if (!el || el.nodeType !== 1) return false;
    if (opt.excludeSelectors.some(sel => el.closest(sel))) return false;

    const idClass = ((el.id || "") + " " + (el.className || "")).trim();
    if (idClass && opt.excludeIdClassRegex.test(idClass)) return false;

    const rect = el.getBoundingClientRect?.();
    if (rect && (rect.width < 250 || rect.height < 120)) return false;

    return true;
  }

  function getTextLen(el) {
    const t = (el.innerText || "").replace(/\s+/g, " ").trim();
    return t.length;
  }

  function getLinkTextLen(el) {
    let total = 0;
    el.querySelectorAll("a").forEach(a => {
      const t = (a.innerText || "").replace(/\s+/g, " ").trim();
      total += t.length;
    });
    return total;
  }

  function docQueryAll(sel) {
    try {
      return Array.from(document.querySelectorAll(sel));
    } catch {
      return [];
    }
  }

  // ============================================
  // Step 3.5: LLM/Chat Transcript Rescue
  // ============================================

  /**
   * Rescues chat transcript content when standard scoring fails.
   * Runs after scoreCandidates() to detect and prioritize chat UIs.
   * @param {Array} scored - Scored candidates from scoreCandidates()
   * @param {Object} opt - Targeting options
   * @returns {Array} Updated scored list with rescued chat roots
   */
  function applyChatRescue(scored, opt) {
    // Check if rescue is needed:
    // 1) No candidates found, OR
    // 2) Top candidate looks like an app shell (too many controls)
    const needRescue = !scored.length || looksLikeAppShell(scored[0]?.el);

    // First, try semantic chat containers (cheap check)
    // role="log" is WCAG-recommended for chat transcripts
    const logEl = firstEligibleChatContainer(["[role='log']", "[aria-live='polite']", "[aria-live='assertive']"], opt);
    if (logEl) {
      return injectTopScored(scored, logEl, 9999);
    }

    if (!needRescue) return scored;

    // ChatGPT and similar chat UIs use specific message block patterns
    const msgSelectors = [
      "[data-testid^='conversation-turn-']",  // ChatGPT
      "article",                                // Generic article blocks
      "[role='article']"                        // ARIA article role
    ];

    // Try standard DOM traversal first
    let msgs = queryAllAnySafe(msgSelectors).filter(el =>
      isVisible(el) && getTextLen(el) >= 60
    );

    // If not enough messages found, attempt open shadow DOM traversal
    // Note: Closed shadow DOM requires chrome.dom API (extension-level)
    if (msgs.length < 3) {
      msgs = deepQueryOpenShadow(msgSelectors.join(","))
        .filter(el => isVisible(el) && getTextLen(el) >= 60);
    }

    // Need at least 3 message blocks to consider it a chat
    if (msgs.length < 3) return scored;

    // Find the lowest common ancestor of all message blocks
    // This typically excludes sidebars, headers, and the composer
    const transcriptRoot = findLowestCommonAncestor(msgs);
    if (!transcriptRoot || !isEligibleContainer(transcriptRoot, opt)) {
      return scored;
    }

    // Inject the transcript root with high priority
    return injectTopScored(scored, transcriptRoot, 9998);
  }

  /**
   * Checks if an element looks like an app shell (many interactive controls).
   * App shells typically contain navigation, toolbars, etc.
   * @param {Element} el - Element to check
   * @returns {boolean} True if element appears to be an app shell
   */
  function looksLikeAppShell(el) {
    if (!el || el.nodeType !== 1) return false;

    try {
      const interactiveCount = el.querySelectorAll(
        "button, input, select, textarea, [role='button'], [contenteditable='true']"
      ).length;
      // Threshold: more than 30 interactive elements suggests app shell
      return interactiveCount > 30;
    } catch {
      return false;
    }
  }

  /**
   * Finds the first eligible chat container matching any selector.
   * Validates elements pass eligibility and visibility checks.
   * @param {string[]} selectors - CSS selectors to try
   * @param {Object} opt - Targeting options
   * @returns {Element|null} First matching eligible element
   */
  function firstEligibleChatContainer(selectors, opt) {
    for (const sel of selectors) {
      try {
        const el = document.querySelector(sel);
        if (el && isVisible(el) && isEligibleContainer(el, opt)) {
          return el;
        }
      } catch {
        // Invalid selector - skip
      }
    }
    return null;
  }

  /**
   * Queries all elements matching any of the provided selectors.
   * Safely handles invalid selectors and deduplicates results.
   * @param {string[]} selectors - Array of CSS selectors
   * @returns {Element[]} Unique matching elements
   */
  function queryAllAnySafe(selectors) {
    const results = new Set();
    for (const sel of selectors) {
      try {
        document.querySelectorAll(sel).forEach(el => results.add(el));
      } catch {
        // Invalid selector - skip
      }
    }
    return Array.from(results);
  }

  /**
   * Traverses open shadow DOMs to find matching elements.
   * Only accesses open shadow roots (closed roots require extension API).
   * Implements depth limit for security and performance.
   * @param {string} selector - CSS selector to match
   * @returns {Element[]} All matching elements including those in shadow DOM
   */
  function deepQueryOpenShadow(selector) {
    const results = new Set();
    const visited = new WeakSet();
    const stack = [document];
    const maxDepth = 10; // Prevent infinite traversal
    let depth = 0;

    while (stack.length && depth < maxDepth) {
      const root = stack.pop();
      if (!root || visited.has(root)) continue;
      visited.add(root);

      try {
        // Query current root
        root.querySelectorAll(selector).forEach(el => results.add(el));

        // Find elements with open shadow roots and add to stack
        root.querySelectorAll("*").forEach(el => {
          if (el.shadowRoot && !visited.has(el.shadowRoot)) {
            stack.push(el.shadowRoot);
          }
        });
      } catch {
        // Skip on error
      }
      depth++;
    }

    return Array.from(results);
  }

  /**
   * Finds the lowest common ancestor of an array of nodes.
   * Used to find the minimal container holding all chat messages.
   * @param {Element[]} nodes - Array of DOM elements
   * @returns {Element|null} The lowest common ancestor element
   */
  function findLowestCommonAncestor(nodes) {
    if (!nodes || !nodes.length) return null;
    if (nodes.length === 1) return nodes[0].parentElement;

    let ancestor = nodes[0];
    for (let i = 1; i < nodes.length; i++) {
      ancestor = findCommonAncestorPair(ancestor, nodes[i]);
      if (!ancestor) return null;
    }
    return ancestor;
  }

  /**
   * Finds the common ancestor of exactly two nodes.
   * @param {Element} a - First element
   * @param {Element} b - Second element
   * @returns {Element|null} Common ancestor element
   */
  function findCommonAncestorPair(a, b) {
    if (!a || !b) return null;
    let current = a;
    while (current && !current.contains(b)) {
      current = current.parentElement;
    }
    return current;
  }

  /**
   * Injects an element at the top of the scored candidates list.
   * Removes any existing entry for the element to prevent duplicates.
   * @param {Array} scored - Current scored candidates
   * @param {Element} el - Element to inject
   * @param {number} score - Score to assign
   * @returns {Array} Updated scored list
   */
  function injectTopScored(scored, el, score) {
    if (!el) return scored;
    // Remove duplicates
    const filtered = scored.filter(x => x.el !== el);
    // Inject at top with high score
    filtered.unshift({ el, score });
    return filtered;
  }

  // ============================================
  // core/transform-engine.js
  // ============================================

  const DEFAULT_SETTINGS = {
    fontScale: 1.0,
    lineHeight: 1.55,
    paragraphSpacing: 1.0,
    contentPadding: 0,
    maxLineWidth: 0,
    fontFamily: "inherit",
  };

  const STYLE_ID = "ua-accessibility-layer-styles";

  function initTransformEngine(userOptions = {}) {
    injectStylesheetOnce();

    let roots = findContentRoots(userOptions.targetingOptions || {});
    roots.forEach(r => r.classList.add("ua-content-root"));

    /**
     * Check if cached roots are still valid.
     * For dynamic pages (chat UIs), content may load after init.
     */
    function ensureValidRoots() {
      // If no roots or roots are detached from DOM, try to find new ones
      const validRoots = roots.filter(r => r && document.contains(r));
      if (validRoots.length === 0) {
        // Clean up old classes if any
        roots.forEach(r => {
          try { r.classList?.remove("ua-content-root"); } catch { }
        });
        // Find fresh roots
        roots = findContentRoots(userOptions.targetingOptions || {});
        roots.forEach(r => r.classList.add("ua-content-root"));
      }
      return roots;
    }

    return {
      get roots() { return roots; },
      apply(settings) {
        const currentRoots = ensureValidRoots();
        applySettingsToRoots(currentRoots, settings);
      },
      reset() {
        const currentRoots = ensureValidRoots();
        applySettingsToRoots(currentRoots, { ...DEFAULT_SETTINGS });
      },
      refreshRoots() {
        roots.forEach(r => {
          try { r.classList?.remove("ua-content-root"); } catch { }
        });
        roots = findContentRoots(userOptions.targetingOptions || {});
        roots.forEach(r => r.classList.add("ua-content-root"));
        return roots;
      }
    };
  }

  function applySettingsToRoots(roots, settings) {
    const s = { ...DEFAULT_SETTINGS, ...(settings || {}) };

    roots.forEach(root => {
      root.style.setProperty("--ua-font-scale", String(s.fontScale));
      root.style.setProperty("--ua-line-height", String(s.lineHeight));
      root.style.setProperty("--ua-paragraph-spacing", String(s.paragraphSpacing));
      root.style.setProperty("--ua-content-padding", `${Number(s.contentPadding) || 0}px`);
      root.style.setProperty("--ua-max-line-width", s.maxLineWidth ? `${Number(s.maxLineWidth)}px` : "none");
      root.style.setProperty("--ua-font-family", s.fontFamily || "inherit");
    });

    // Also apply to Reader Mode overlay if present
    applyToReaderOverlayIfPresent(s);
  }

  /**
   * Apply typography settings to Reader Mode overlay if active
   */
  function applyToReaderOverlayIfPresent(settings) {
    const readerRoot = document.getElementById("ua-reader-typo-root");
    if (!readerRoot) return;

    readerRoot.style.setProperty("--ua-font-scale", String(settings.fontScale));
    readerRoot.style.setProperty("--ua-line-height", String(settings.lineHeight));
    readerRoot.style.setProperty("--ua-paragraph-spacing", String(settings.paragraphSpacing));
    readerRoot.style.setProperty("--ua-font-family", settings.fontFamily || "inherit");
  }

  function injectStylesheetOnce() {
    if (document.getElementById(STYLE_ID)) return;

    const style = document.createElement("style");
    style.id = STYLE_ID;
    style.textContent = getScopedCss();
    document.head.appendChild(style);
  }

  function getScopedCss() {
    return `
.ua-content-root {
  --ua-font-scale: 1;
  --ua-line-height: 1.55;
  --ua-paragraph-spacing: 1;
  --ua-content-padding: 0px;
  --ua-max-line-width: none;
  --ua-font-family: inherit;

  font-size: calc(1rem * var(--ua-font-scale)) !important;
  box-sizing: border-box;
  padding-left: var(--ua-content-padding);
  padding-right: var(--ua-content-padding);
  max-width: var(--ua-max-line-width);
  margin-left: auto;
  margin-right: auto;
}

.ua-content-root {
  font-family: var(--ua-font-family) !important;
}

/* Apply font-size to all text-bearing elements within content root */
.ua-content-root :is(p, li, dd, dt, blockquote, figcaption, td, th, span, div, article, section) {
  font-size: inherit !important;
  line-height: var(--ua-line-height);
}

/* Apply font-size to headings with scaled proportions */
.ua-content-root h1 { font-size: calc(2em * var(--ua-font-scale)) !important; }
.ua-content-root h2 { font-size: calc(1.5em * var(--ua-font-scale)) !important; }
.ua-content-root h3 { font-size: calc(1.25em * var(--ua-font-scale)) !important; }
.ua-content-root h4 { font-size: calc(1.1em * var(--ua-font-scale)) !important; }
.ua-content-root h5 { font-size: calc(1em * var(--ua-font-scale)) !important; }
.ua-content-root h6 { font-size: calc(0.9em * var(--ua-font-scale)) !important; }

.ua-content-root :is(pre, code, kbd, samp) {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace !important;
  font-size: inherit !important;
}

.ua-content-root p {
  margin-top: calc(0.5em * var(--ua-paragraph-spacing));
  margin-bottom: calc(0.75em * var(--ua-paragraph-spacing));
}

.ua-content-root :is(ul, ol) {
  margin-top: calc(0.6em * var(--ua-paragraph-spacing));
  margin-bottom: calc(0.8em * var(--ua-paragraph-spacing));
}

.ua-content-root :is(button, input, select, textarea) {
  font-size: inherit !important;
  line-height: normal;
}

/* Links should also inherit font-size */
.ua-content-root a {
  font-size: inherit !important;
}
`;
  }

  // ============================================
  // core/storage.js - Profile-based storage implementation
  // ============================================

  const PROFILES_KEY = "ua:profiles";
  const MAX_PROFILES = 5;

  // Profile storage cache
  let profilesData = {
    activeProfileId: "default",
    profiles: {}
  };

  // Default profile template
  const DEFAULT_PROFILE_PREFS = {
    fontScale: 1.0,
    lineHeight: 1.55,
    paragraphSpacing: 1.0,
    contentPadding: 0,
    maxLineWidth: 0,
    fontFamily: "inherit",
    nightMode: false,
    reduceColors: false,
    ttsRate: 1.0
  };

  /**
   * Create a new profile object
   */
  function createProfileObject(id, name) {
    return {
      id,
      name,
      prefs: { ...DEFAULT_PROFILE_PREFS },
      updatedAt: Date.now()
    };
  }

  /**
   * Initialize profiles data with default profile if empty
   */
  function ensureDefaultProfile() {
    if (!profilesData.profiles["default"]) {
      profilesData.profiles["default"] = createProfileObject("default", "Default");
    }
    if (!profilesData.activeProfileId) {
      profilesData.activeProfileId = "default";
    }
  }

  /**
   * Get current active profile
   */
  function getActiveProfile() {
    ensureDefaultProfile();
    return profilesData.profiles[profilesData.activeProfileId] || profilesData.profiles["default"];
  }

  /**
   * Get current active profile ID
   */
  function getActiveProfileId() {
    return profilesData.activeProfileId || "default";
  }

  /**
   * Get all profiles as array
   */
  function getAllProfiles() {
    ensureDefaultProfile();
    return Object.values(profilesData.profiles);
  }

  /**
   * Get number of profiles
   */
  function getProfileCount() {
    return Object.keys(profilesData.profiles).length;
  }

  /**
   * Async load profiles from chrome.storage.local
   */
  async function loadProfilesAsync() {
    try {
      const result = await chrome.storage.local.get(PROFILES_KEY);
      if (result[PROFILES_KEY]) {
        profilesData = result[PROFILES_KEY];
      }
      ensureDefaultProfile();
      return profilesData;
    } catch (e) {
      console.warn("[UA Widget] Failed to load profiles:", e);
      ensureDefaultProfile();
      return profilesData;
    }
  }

  /**
   * Save profiles to chrome.storage.local
   */
  function saveProfiles() {
    try {
      chrome.storage.local.set({ [PROFILES_KEY]: profilesData });
    } catch (e) {
      console.warn("[UA Widget] Failed to save profiles:", e);
    }
  }

  /**
   * Save settings to current active profile
   */
  function saveSettingsToProfile(settings) {
    const profile = getActiveProfile();
    profile.prefs = { ...profile.prefs, ...settings };
    profile.updatedAt = Date.now();
    saveProfiles();
  }

  /**
   * Switch to a different profile
   * @returns The new profile's prefs
   */
  function switchProfile(profileId) {
    if (!profilesData.profiles[profileId]) {
      console.warn("[UA Widget] Profile not found:", profileId);
      return null;
    }
    profilesData.activeProfileId = profileId;
    saveProfiles();
    return profilesData.profiles[profileId].prefs;
  }

  /**
   * Create a new profile
   * @returns The new profile object or null if max reached
   */
  function createNewProfile(name) {
    if (getProfileCount() >= MAX_PROFILES) {
      console.warn("[UA Widget] Max profiles reached:", MAX_PROFILES);
      return null;
    }

    // Generate unique ID
    const id = "user" + Date.now();
    const profile = createProfileObject(id, name || `User ${getProfileCount()}`);
    profilesData.profiles[id] = profile;
    saveProfiles();
    return profile;
  }

  /**
   * Delete a profile (cannot delete default)
   */
  function deleteProfile(profileId) {
    if (profileId === "default") {
      console.warn("[UA Widget] Cannot delete default profile");
      return false;
    }
    if (!profilesData.profiles[profileId]) {
      return false;
    }
    delete profilesData.profiles[profileId];
    // Switch to default if deleted active profile
    if (profilesData.activeProfileId === profileId) {
      profilesData.activeProfileId = "default";
    }
    saveProfiles();
    return true;
  }

  /**
   * Rename a profile
   */
  function renameProfile(profileId, newName) {
    if (!profilesData.profiles[profileId]) {
      return false;
    }
    profilesData.profiles[profileId].name = newName;
    profilesData.profiles[profileId].updatedAt = Date.now();
    saveProfiles();
    return true;
  }

  /**
   * Clear all profiles (reset to default only)
   */
  function clearAllProfiles() {
    profilesData = {
      activeProfileId: "default",
      profiles: {
        "default": createProfileObject("default", "Default")
      }
    };
    saveProfiles();
  }

  // Legacy compatibility - get current profile prefs
  function loadSettings() {
    return getActiveProfile()?.prefs || null;
  }

  async function loadSettingsAsync() {
    await loadProfilesAsync();
    return getActiveProfile()?.prefs || null;
  }

  function saveSettings(settings) {
    saveSettingsToProfile(settings);
  }

  function clearSettings() {
    const profile = getActiveProfile();
    profile.prefs = { ...DEFAULT_PROFILE_PREFS };
    profile.updatedAt = Date.now();
    saveProfiles();
  }

  // ============================================
  // notes/storage.js – Page-level notes storage
  // ============================================

  const NOTES_KEY = "ua:notes";
  const MAX_SNIPPET_LEN = 120;
  let _notesCache = null;

  function getUrlKey() {
    return location.href.replace(/#.*$/, "");
  }

  function generateNoteId() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  }

  function trimSnippet(text) {
    const s = (text || "").trim().replace(/\s+/g, " ");
    return s.length > MAX_SNIPPET_LEN ? s.slice(0, MAX_SNIPPET_LEN) + "…" : s;
  }

  function titleFromSnippet(text) {
    const words = (text || "").trim().split(/\s+/);
    const title = words.slice(0, 8).join(" ");
    return words.length > 8 ? title + "…" : title;
  }

  async function loadAllNotes() {
    if (_notesCache !== null) return _notesCache;
    return new Promise((resolve) => {
      chrome.storage.local.get([NOTES_KEY], (result) => {
        _notesCache = result[NOTES_KEY] || [];
        resolve(_notesCache);
      });
    });
  }

  function saveAllNotes(notes) {
    _notesCache = notes;
    chrome.storage.local.set({ [NOTES_KEY]: notes });
  }

  async function getNotesForPage(urlKey, profileId) {
    const all = await loadAllNotes();
    return all.filter(n => n.urlKey === urlKey && n.profileId === profileId);
  }

  async function addNote({ selectionSnippet, noteText, title }) {
    const all = await loadAllNotes();
    const note = {
      id: generateNoteId(),
      urlKey: getUrlKey(),
      hostname: location.hostname,
      pageTitle: document.title,
      selectionSnippet: trimSnippet(selectionSnippet),
      title: title || titleFromSnippet(selectionSnippet),
      noteText: noteText || "",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      profileId: getActiveProfileId(),
    };
    all.unshift(note);
    saveAllNotes(all);
    return note;
  }

  async function updateNote(id, fields) {
    const all = await loadAllNotes();
    const idx = all.findIndex(n => n.id === id);
    if (idx === -1) return null;
    Object.assign(all[idx], fields, { updatedAt: Date.now() });
    saveAllNotes(all);
    return all[idx];
  }

  async function deleteNote(id) {
    const all = await loadAllNotes();
    const filtered = all.filter(n => n.id !== id);
    saveAllNotes(filtered);
  }

  async function getPageNoteCount(urlKey, profileId) {
    const notes = await getNotesForPage(urlKey, profileId);
    return notes.length;
  }

  // ============================================
  // features/font-family.js
  // ============================================

  const FONT_PRESETS = [
    { id: "inherit", label: "Website default", value: "inherit" },
    { id: "system", label: "System UI", value: 'system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif' },
    { id: "serif", label: "Serif", value: 'ui-serif, Georgia, "Times New Roman", serif' },
    { id: "dyslexia", label: "Dyslexia-friendly (fallback)", value: '"OpenDyslexic", "Atkinson Hyperlegible", Arial, sans-serif' },
  ];

  function resolveFontFamily(presetId) {
    const found = FONT_PRESETS.find(p => p.id === presetId);
    return found ? found.value : "inherit";
  }

  // ============================================
  // features/font-size.js
  // ============================================

  function clampFontScale(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return DEFAULT_SETTINGS.fontScale;
    return Math.min(1.6, Math.max(0.85, n));
  }

  function nextFontScale(current, delta) {
    return clampFontScale((Number(current) || DEFAULT_SETTINGS.fontScale) + delta);
  }

  // ============================================
  // features/spacing.js
  // ============================================

  function clampLineHeight(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return DEFAULT_SETTINGS.lineHeight;
    return Math.min(2.2, Math.max(1.2, n));
  }

  function clampParagraphSpacing(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return DEFAULT_SETTINGS.paragraphSpacing;
    return Math.min(2.0, Math.max(0.5, n));
  }

  function clampPaddingPx(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return DEFAULT_SETTINGS.contentPadding;
    return Math.min(48, Math.max(0, Math.round(n)));
  }

  function clampMaxLineWidthPx(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return DEFAULT_SETTINGS.maxLineWidth;
    if (n < 400) return 0;
    return Math.min(1200, Math.max(400, Math.round(n)));
  }

  // ============================================
  // features/keyboard.js
  // ============================================

  function installKeyboardA11y({ launcherBtn, panelEl, closeBtn }) {
    if (!launcherBtn || !panelEl) return () => { };

    launcherBtn.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openPanel({ launcherBtn, panelEl, closeBtn });
      }
    });

    const onKeydown = (e) => {
      if (!isOpen(panelEl)) return;

      if (e.key === "Escape") {
        e.preventDefault();
        closePanel({ launcherBtn, panelEl });
        return;
      }

      if (e.key === "Tab") {
        trapFocus(e, panelEl);
      }
    };

    document.addEventListener("keydown", onKeydown, true);

    if (closeBtn) {
      closeBtn.addEventListener("click", () => closePanel({ launcherBtn, panelEl }));
    }

    return () => document.removeEventListener("keydown", onKeydown, true);
  }

  function openPanel({ launcherBtn, panelEl, closeBtn }) {
    panelEl.hidden = false;
    panelEl.setAttribute("aria-hidden", "false");

    const firstFocusable = getFocusable(panelEl)[0] || closeBtn || panelEl;
    firstFocusable.focus?.();
  }

  function closePanel({ launcherBtn, panelEl }) {
    panelEl.hidden = true;
    panelEl.setAttribute("aria-hidden", "true");
    launcherBtn?.focus?.();
  }

  function isOpen(panelEl) {
    return panelEl && panelEl.hidden === false;
  }

  function trapFocus(e, container) {
    const focusable = getFocusable(container);
    if (!focusable.length) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const active = document.activeElement;

    if (e.shiftKey) {
      if (active === first || !container.contains(active)) {
        e.preventDefault();
        last.focus();
      }
    } else {
      if (active === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }

  function getFocusable(container) {
    const selectors = [
      "a[href]",
      "button:not([disabled])",
      "input:not([disabled])",
      "select:not([disabled])",
      "textarea:not([disabled])",
      "[tabindex]:not([tabindex='-1'])"
    ];
    return Array.from(container.querySelectorAll(selectors.join(",")))
      .filter(el => !el.hasAttribute("disabled") && isVisible(el));
  }

  function isVisible(el) {
    const rect = el.getBoundingClientRect?.();
    return rect ? rect.width > 0 && rect.height > 0 : true;
  }

  // ============================================
  // features/reader-mode.js
  // ============================================

  const READER_OVERLAY_ID = "ua-reader-overlay";
  let isReaderModeActive = false;
  let originalScrollPosition = 0;

  function toggleReaderMode() {
    if (isReaderModeActive) {
      exitReaderMode();
      return false;
    } else {
      enterReaderMode();
      return true;
    }
  }

  function isReaderActive() {
    return isReaderModeActive;
  }

  function enterReaderMode() {
    if (isReaderModeActive) return;

    const roots = findContentRoots({
      allowMultipleRoots: true,
      multiRootScoreRatio: 0.7,
    });

    if (!roots.length) {
      console.warn("[Reader Mode] No content roots found");
      return;
    }

    originalScrollPosition = window.scrollY;

    const contentData = extractReadableContent(roots);
    const overlay = createReaderOverlay(contentData);
    document.body.appendChild(overlay);

    document.body.style.overflow = "hidden";
    isReaderModeActive = true;
    overlay.focus();
  }

  function exitReaderMode() {
    if (!isReaderModeActive) return;

    const overlay = document.getElementById(READER_OVERLAY_ID);
    if (overlay) {
      overlay.classList.add("ua-reader-closing");
      setTimeout(() => {
        overlay.remove();
      }, 300);
    }

    document.body.style.overflow = "";
    window.scrollTo(0, originalScrollPosition);
    isReaderModeActive = false;

    // Sync the toggle switch state in the panel
    if (typeof window.uaSyncReaderToggle === "function") {
      window.uaSyncReaderToggle(false);
    }
  }

  function extractReadableContent(roots) {
    let title = document.querySelector("h1")?.textContent?.trim()
      || document.querySelector("article h1, main h1, .title, .headline")?.textContent?.trim()
      || document.title;

    let totalText = "";
    roots.forEach(root => {
      totalText += (root.innerText || "");
    });
    const wordCount = totalText.trim().split(/\s+/).length;
    const readTime = Math.max(1, Math.ceil(wordCount / 200));

    const cleanedContent = [];
    roots.forEach(root => {
      const clone = root.cloneNode(true);
      cleanClonedContent(clone);
      cleanedContent.push(clone.innerHTML);
    });

    return {
      title,
      readTime,
      wordCount,
      html: cleanedContent.join("<hr class='ua-reader-separator'>")
    };
  }

  function cleanClonedContent(el) {
    const removeSelectors = [
      "script", "style", "noscript", "iframe", "embed", "object",
      "nav", "header:not(article header)", "footer:not(article footer)",
      ".ad", ".ads", ".advertisement", ".social-share", ".share-buttons",
      ".comments", ".comment-section", ".related-posts", ".sidebar",
      ".newsletter", ".subscribe", ".popup", ".modal",
      "[aria-hidden='true']", ".hidden", "[style*='display: none']",
      ".nav", ".menu", ".navigation"
    ];

    removeSelectors.forEach(sel => {
      try {
        el.querySelectorAll(sel).forEach(child => child.remove());
      } catch (e) { }
    });

    el.querySelectorAll("*").forEach(child => {
      Array.from(child.attributes).forEach(attr => {
        if (attr.name.startsWith("on")) {
          child.removeAttribute(attr.name);
        }
      });
      if (child.className && typeof child.className === 'string') {
        child.removeAttribute('class');
      }
    });

    el.querySelectorAll("a").forEach(a => {
      a.setAttribute("target", "_blank");
      a.setAttribute("rel", "noopener noreferrer");
    });
  }

  function createReaderOverlay(contentData) {
    const overlay = document.createElement("div");
    overlay.id = READER_OVERLAY_ID;
    overlay.setAttribute("tabindex", "-1");
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", "Reader Mode");

    overlay.innerHTML = `
    <div class="ua-reader-container">
      <header class="ua-reader-header">
        <div class="ua-reader-meta">
          <span class="ua-reader-badge">📖 Reader Mode</span>
          <span class="ua-reader-time">${contentData.readTime} min read</span>
        </div>
        <button class="ua-reader-close" aria-label="Exit Reader Mode">
          <span aria-hidden="true">✕</span> Exit
        </button>
      </header>
      
      <article class="ua-reader-content">
        <h1 class="ua-reader-title">${escapeHtml(contentData.title)}</h1>
        <div class="ua-reader-body ua-typo-root" id="ua-reader-typo-root">
          ${contentData.html}
        </div>
      </article>
      
      <footer class="ua-reader-footer">
        <span>${contentData.wordCount.toLocaleString()} words</span>
        <span>Press <kbd>Escape</kbd> to exit</span>
      </footer>
    </div>
  `;

    injectReaderStyles();

    overlay.querySelector(".ua-reader-close").addEventListener("click", exitReaderMode);

    overlay.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        exitReaderMode();
      }
    });

    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) {
        exitReaderMode();
      }
    });

    return overlay;
  }

  function injectReaderStyles() {
    if (document.getElementById("ua-reader-styles")) return;

    const style = document.createElement("style");
    style.id = "ua-reader-styles";
    style.textContent = `
    #ua-reader-overlay {
      position: fixed;
      inset: 0;
      z-index: 2147483646;
      background: rgba(0, 0, 0, 0.85);
      backdrop-filter: blur(8px);
      -webkit-backdrop-filter: blur(8px);
      overflow-y: auto;
      animation: ua-reader-fade-in 0.3s ease-out;
    }
    
    #ua-reader-overlay.ua-reader-closing {
      animation: ua-reader-fade-out 0.3s ease-out forwards;
    }
    
    @keyframes ua-reader-fade-in {
      from { opacity: 0; }
      to { opacity: 1; }
    }
    
    @keyframes ua-reader-fade-out {
      from { opacity: 1; }
      to { opacity: 0; }
    }
    
    .ua-reader-container {
      max-width: 720px;
      margin: 0 auto;
      padding: 40px 24px;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
    }
    
    .ua-reader-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 32px;
      padding-bottom: 16px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.1);
    }
    
    .ua-reader-meta {
      display: flex;
      gap: 12px;
      align-items: center;
    }
    
    .ua-reader-badge {
      background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%);
      color: #fff;
      padding: 6px 14px;
      border-radius: 20px;
      font-size: 13px;
      font-weight: 600;
      font-family: system-ui, -apple-system, sans-serif;
    }
    
    .ua-reader-time {
      color: rgba(255, 255, 255, 0.6);
      font-size: 13px;
      font-family: system-ui, -apple-system, sans-serif;
    }
    
    .ua-reader-close {
      display: flex;
      align-items: center;
      gap: 6px;
      background: rgba(255, 255, 255, 0.1);
      border: 1px solid rgba(255, 255, 255, 0.2);
      color: #fff;
      padding: 8px 16px;
      border-radius: 8px;
      cursor: pointer;
      font-size: 13px;
      font-weight: 500;
      font-family: system-ui, -apple-system, sans-serif;
      transition: all 0.2s ease;
    }
    
    .ua-reader-close:hover {
      background: rgba(255, 255, 255, 0.2);
      transform: translateY(-1px);
    }
    
    .ua-reader-content {
      flex: 1;
      background: #faf9f7;
      border-radius: 16px;
      padding: 48px;
      box-shadow: 0 25px 50px rgba(0, 0, 0, 0.3);
    }
    
    .ua-reader-title {
      font-family: Georgia, 'Times New Roman', serif;
      font-size: 2.5rem;
      font-weight: 700;
      line-height: 1.2;
      color: #1a1a2e;
      margin: 0 0 32px 0;
      letter-spacing: -0.02em;
    }
    
    .ua-reader-body {
      /* Use CSS variables for typography - falls back to reader defaults */
      --ua-font-scale: 1.15;
      --ua-line-height: 1.8;
      --ua-paragraph-spacing: 1;
      --ua-font-family: Georgia, 'Times New Roman', serif;
      
      font-family: var(--ua-font-family);
      font-size: calc(1rem * var(--ua-font-scale));
      line-height: var(--ua-line-height);
      color: #2d2d2d;
    }
    
    .ua-reader-body p {
      margin: 0 0 calc(1em * var(--ua-paragraph-spacing)) 0;
    }
    
    .ua-reader-body h1,
    .ua-reader-body h2,
    .ua-reader-body h3,
    .ua-reader-body h4 {
      font-family: system-ui, -apple-system, sans-serif;
      font-weight: 600;
      color: #1a1a2e;
      margin: 2em 0 0.8em 0;
      line-height: 1.3;
    }
    
    .ua-reader-body h2 { font-size: 1.6rem; }
    .ua-reader-body h3 { font-size: 1.3rem; }
    .ua-reader-body h4 { font-size: 1.1rem; }
    
    .ua-reader-body a {
      color: #6366f1;
      text-decoration: underline;
      text-underline-offset: 2px;
    }
    
    .ua-reader-body a:hover {
      color: #4f46e5;
    }
    
    .ua-reader-body img {
      max-width: 100%;
      height: auto;
      border-radius: 8px;
      margin: 1.5em 0;
    }
    
    .ua-reader-body blockquote {
      border-left: 4px solid #6366f1;
      padding-left: 20px;
      margin: 1.5em 0;
      font-style: italic;
      color: #555;
    }
    
    .ua-reader-body pre,
    .ua-reader-body code {
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, monospace;
      background: #f0f0f0;
      border-radius: 4px;
    }
    
    .ua-reader-body code {
      padding: 2px 6px;
      font-size: 0.9em;
    }
    
    .ua-reader-body pre {
      padding: 16px;
      overflow-x: auto;
    }
    
    .ua-reader-body pre code {
      background: none;
      padding: 0;
    }
    
    .ua-reader-body ul,
    .ua-reader-body ol {
      margin: 1em 0;
      padding-left: 1.5em;
    }
    
    .ua-reader-body li {
      margin: 0.5em 0;
    }
    
    .ua-reader-separator {
      border: none;
      border-top: 2px dashed rgba(99, 102, 241, 0.3);
      margin: 3em 0;
    }
    
    .ua-reader-footer {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-top: 24px;
      padding-top: 16px;
      font-size: 12px;
      color: rgba(255, 255, 255, 0.5);
      font-family: system-ui, -apple-system, sans-serif;
    }
    
    .ua-reader-footer kbd {
      background: rgba(255, 255, 255, 0.15);
      padding: 2px 6px;
      border-radius: 4px;
      font-family: inherit;
    }
    
    @media (max-width: 768px) {
      .ua-reader-container {
        padding: 20px 16px;
      }
      
      .ua-reader-content {
        padding: 24px;
      }
      
      .ua-reader-title {
        font-size: 1.75rem;
      }
      
      .ua-reader-body {
        font-size: 1.05rem;
      }
      
      .ua-reader-header {
        flex-direction: column;
        gap: 12px;
        align-items: flex-start;
      }
    }
    
    @media (prefers-color-scheme: dark) {
      .ua-reader-content {
        background: #1e1e2e;
      }
      
      .ua-reader-title {
        color: #f5f5f5;
      }
      
      .ua-reader-body {
        color: #e0e0e0;
      }
      
      .ua-reader-body h1,
      .ua-reader-body h2,
      .ua-reader-body h3,
      .ua-reader-body h4 {
        color: #f5f5f5;
      }
      
      .ua-reader-body blockquote {
        color: #a0a0a0;
      }
      
      .ua-reader-body pre,
      .ua-reader-body code {
        background: #2a2a3e;
      }
    }
  `;

    document.head.appendChild(style);
  }

  function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
  }

  // ============================================
  // features/focus-mode.js
  // ============================================

  // Soft Enhancement preset (no layout changes - only font/spacing)
  const SOFT_ENHANCE_PRESET = {
    fontScale: 1.15,
    lineHeight: 1.8,
    paragraphSpacing: 1.15,
    fontFamily: '"Atkinson Hyperlegible", system-ui, -apple-system, Segoe UI, Roboto, Arial, sans-serif',
  };

  const HIDDEN_ATTR = "data-ua-hidden";
  const PREV_DISPLAY_ATTR = "data-ua-prev-display";
  let preFocusSettings = null;
  let preEnhanceSettings = null;

  function isFocusModeOn() {
    return document.documentElement.classList.contains("ua-focus-mode");
  }

  function enterFocusMode({ roots, keepSelectors = [] } = {}) {
    if (!roots || !roots.length) return () => { };

    document.documentElement.classList.add("ua-focus-mode");

    // Build KEEP set from roots + widget + optional selectors
    const keepNodes = [
      ...roots,
      ...safeQueryAll("#ua-widget-launcher, #ua-widget-panel"),
      ...safeQueryAll(keepSelectors.join(",")),
    ].filter(Boolean);

    const keep = buildKeepSet(keepNodes);

    // Hide every element not in KEEP set (but never hide html/body/head)
    safeQueryAll("body *").forEach(el => {
      if (el === document.body || el === document.head) return;
      if (keep.has(el)) return;
      hideElement(el);
    });

    return () => exitFocusMode();
  }

  function exitFocusMode() {
    document.documentElement.classList.remove("ua-focus-mode");
    safeQueryAll(`[${HIDDEN_ATTR}="true"]`).forEach(el => {
      const prev = el.getAttribute(PREV_DISPLAY_ATTR);
      el.style.display = prev || "";
      el.removeAttribute(HIDDEN_ATTR);
      el.removeAttribute(PREV_DISPLAY_ATTR);
    });
  }

  function buildKeepSet(nodes) {
    const keep = new Set();

    nodes.forEach(node => {
      if (!node || node.nodeType !== 1) return;

      // node itself + descendants
      keep.add(node);
      node.querySelectorAll?.("*")?.forEach?.(d => keep.add(d));

      // ancestors up to body
      let a = node;
      while (a && a !== document.body) {
        keep.add(a);
        a = a.parentElement;
      }
      keep.add(document.body);
    });

    return keep;
  }

  function hideElement(el) {
    if (!el || el.nodeType !== 1) return;
    if (el.getAttribute(HIDDEN_ATTR) === "true") return;
    el.setAttribute(PREV_DISPLAY_ATTR, el.style.display || "");
    el.setAttribute(HIDDEN_ATTR, "true");
    el.style.display = "none";
  }

  function safeQueryAll(sel) {
    if (!sel) return [];
    try { return Array.from(document.querySelectorAll(sel)); }
    catch { return []; }
  }

  // ============================================
  // features/night-mode.js
  // ============================================

  function isNightModeOn() {
    return document.documentElement.classList.contains("ua-night");
  }

  function setNightMode(on) {
    document.documentElement.classList.toggle("ua-night", !!on);
    injectNightModeStyles();
  }

  function toggleNightMode() {
    setNightMode(!isNightModeOn());
    return isNightModeOn();
  }

  function injectNightModeStyles() {
    if (document.getElementById("ua-night-styles")) return;

    const style = document.createElement("style");
    style.id = "ua-night-styles";
    style.textContent = `
    /* Night Mode - Lightweight dark theme via CSS cascade */
    html.ua-night {
      filter: invert(90%) hue-rotate(180deg);
    }
    
    /* Preserve images, videos, and media */
    html.ua-night img,
    html.ua-night video,
    html.ua-night picture,
    html.ua-night canvas,
    html.ua-night svg,
    html.ua-night iframe,
    html.ua-night [style*="background-image"] {
      filter: invert(100%) hue-rotate(180deg);
    }
    
    /* Keep widget normal */
    html.ua-night #ua-widget-launcher,
    html.ua-night #ua-widget-panel {
      filter: invert(100%) hue-rotate(180deg);
    }
  `;
    document.head.appendChild(style);
  }

  // ============================================
  // features/text-to-speech.js
  // ============================================

  // TTS State
  let ttsTextMap = []; // { node, start, end, nodeStart, nodeEnd }
  let ttsFullText = "";
  let ttsChunkQueue = []; // { text, start }
  let ttsChunkIndex = 0;
  let ttsUtterance = null;
  let ttsCurrentChunkStart = 0;
  let ttsPendingCharIndex = null;
  let ttsRafId = null;
  let ttsIsSpeaking = false;
  let ttsIsPaused = false;

  const TTS_SETTINGS = {
    rate: 1.0,
    pitch: 1.0,
    volume: 1.0,
  };

  const TTS_RATE_KEY = "ua-widget-tts-rate";

  // Load saved rate
  try {
    const savedRate = localStorage.getItem(TTS_RATE_KEY);
    if (savedRate) TTS_SETTINGS.rate = Math.max(0.5, Math.min(2.0, parseFloat(savedRate)));
  } catch { }

  function injectTTSStyles() {
    if (document.getElementById("ua-tts-styles")) return;

    const style = document.createElement("style");
    style.id = "ua-tts-styles";
    style.textContent = `
      #ua-tts-overlay-root {
        position: absolute;
        left: 0;
        top: 0;
        width: 0;
        height: 0;
        z-index: 2147483646;
        pointer-events: none;
      }
      .ua-tts-overlay {
        position: absolute;
        background: rgba(99, 102, 241, 0.35);
        pointer-events: none;
        border-radius: 3px;
        transition: all 0.1s ease;
      }
    `;
    document.head.appendChild(style);
  }

  function ensureTTSOverlayRoot() {
    let root = document.getElementById("ua-tts-overlay-root");
    if (!root) {
      root = document.createElement("div");
      root.id = "ua-tts-overlay-root";
      document.body.appendChild(root);
    }
    return root;
  }

  // Speak user selection
  function ttsSpeakSelection() {
    ttsStop();

    const sel = window.getSelection?.();
    if (!sel || !sel.rangeCount) return false;
    const text = (sel.toString?.() || "").trim();
    if (!text) return false;

    const range = sel.getRangeAt(0);
    ttsBuildTextMapFromRange(range);

    if (!ttsFullText.trim()) return false;

    ttsChunkQueue = ttsMakeChunks(ttsFullText, 1800);
    ttsChunkIndex = 0;
    ttsIsSpeaking = true;
    ttsIsPaused = false;
    ttsSpeakNextChunk();
    return true;
  }

  // Speak main content (reuses targeting algorithm)
  // When Reader Mode is active, reads the reader content instead
  function ttsSpeakMain() {
    ttsStop();

    // Use Reader Mode content if active, otherwise main page content
    const readerRoot = document.getElementById("ua-reader-typo-root");
    let root;

    if (readerRoot) {
      // Reader Mode is active - read from reader overlay
      root = readerRoot;
    } else {
      // Normal mode - find main content
      const roots = findContentRoots({ allowMultipleRoots: false });
      if (!roots.length) return false;
      root = roots[0];
    }

    ttsBuildTextMapFromRoot(root);

    if (!ttsFullText.trim()) return false;

    ttsChunkQueue = ttsMakeChunks(ttsFullText, 2000);
    ttsChunkIndex = 0;
    ttsIsSpeaking = true;
    ttsIsPaused = false;
    ttsSpeakNextChunk();
    return true;
  }

  function ttsStop() {
    try { speechSynthesis.cancel(); } catch { }
    ttsClearHighlights();
    ttsUtterance = null;
    ttsChunkQueue = [];
    ttsChunkIndex = 0;
    ttsCurrentChunkStart = 0;
    ttsPendingCharIndex = null;
    ttsIsSpeaking = false;
    ttsIsPaused = false;
    if (ttsRafId) cancelAnimationFrame(ttsRafId);
    ttsRafId = null;
  }

  function ttsPause() {
    if (ttsIsSpeaking && !ttsIsPaused) {
      speechSynthesis.pause();
      ttsIsPaused = true;
    }
  }

  function ttsResume() {
    if (ttsIsSpeaking && ttsIsPaused) {
      speechSynthesis.resume();
      ttsIsPaused = false;
    }
  }

  function ttsSetRate(rate) {
    TTS_SETTINGS.rate = Math.max(0.5, Math.min(2.0, rate));
    try { localStorage.setItem(TTS_RATE_KEY, TTS_SETTINGS.rate); } catch { }
  }

  // Chunking for reliability
  function ttsMakeChunks(text, maxLen) {
    const chunks = [];
    let i = 0;
    const n = text.length;

    while (i < n) {
      const remaining = n - i;
      if (remaining <= maxLen) {
        chunks.push({ text: text.slice(i), start: i });
        break;
      }

      const windowEnd = i + maxLen;
      const slice = text.slice(i, windowEnd);

      let cut = Math.max(
        slice.lastIndexOf(". "),
        slice.lastIndexOf("! "),
        slice.lastIndexOf("? "),
        slice.lastIndexOf("\n")
      );

      if (cut < 200) cut = slice.lastIndexOf(" ");
      if (cut < 50) cut = maxLen;

      const piece = text.slice(i, i + cut + 1);
      chunks.push({ text: piece, start: i });
      i = i + cut + 1;
    }
    return chunks;
  }

  function ttsSpeakNextChunk() {
    if (ttsChunkIndex >= ttsChunkQueue.length) {
      ttsClearHighlights();
      ttsIsSpeaking = false;
      return;
    }

    const next = ttsChunkQueue[ttsChunkIndex];
    ttsCurrentChunkStart = next.start;

    ttsUtterance = new SpeechSynthesisUtterance(next.text);
    ttsUtterance.rate = TTS_SETTINGS.rate;
    ttsUtterance.pitch = TTS_SETTINGS.pitch;
    ttsUtterance.volume = TTS_SETTINGS.volume;

    ttsUtterance.onboundary = (e) => {
      const idx = typeof e.charIndex === "number" ? e.charIndex : null;
      if (idx === null) return;
      ttsScheduleHighlight(ttsCurrentChunkStart + idx);
    };

    ttsUtterance.onend = () => {
      ttsClearHighlights();
      ttsChunkIndex += 1;
      ttsSpeakNextChunk();
    };

    ttsUtterance.onerror = () => {
      ttsClearHighlights();
      ttsIsSpeaking = false;
    };

    injectTTSStyles();
    setTimeout(() => {
      try { speechSynthesis.speak(ttsUtterance); } catch { }
    }, 0);
  }

  // Build text map from selection range (accurate slicing)
  function ttsBuildTextMapFromRange(range) {
    ttsTextMap = [];
    ttsFullText = "";

    const root = (range.commonAncestorContainer.nodeType === Node.TEXT_NODE)
      ? range.commonAncestorContainer.parentElement
      : range.commonAncestorContainer;

    if (!root) return;

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!range.intersectsNode(node)) return NodeFilter.FILTER_REJECT;
        if (ttsIsHiddenTextNode(node)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });

    let node;
    while ((node = walker.nextNode())) {
      const slice = ttsSliceTextNodeToRange(node, range);
      if (!slice) continue;
      ttsAppendSegment(node, slice.text, slice.nodeStart, slice.nodeEnd);
    }
  }

  // Build text map from content root
  function ttsBuildTextMapFromRoot(root) {
    ttsTextMap = [];
    ttsFullText = "";

    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (ttsIsHiddenTextNode(node)) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      },
    });

    let node;
    while ((node = walker.nextNode())) {
      const text = node.textContent || "";
      if (!text.trim()) continue;
      ttsAppendSegment(node, text, 0, text.length);
    }
  }

  function ttsAppendSegment(node, segText, nodeStart, nodeEnd) {
    const t = segText.replace(/[ \t\f\v]+/g, " ");
    if (!t.trim()) return;

    // Insert space between segments to avoid merged words
    if (ttsFullText.length) {
      const prev = ttsFullText[ttsFullText.length - 1];
      const next0 = t[0];
      if (!/\s/.test(prev) && !/\s/.test(next0)) {
        const sepStart = ttsFullText.length;
        ttsFullText += " ";
        ttsTextMap.push({ node: null, start: sepStart, end: ttsFullText.length, nodeStart: 0, nodeEnd: 0 });
      }
    }

    const start = ttsFullText.length;
    ttsFullText += t;
    const end = ttsFullText.length;

    ttsTextMap.push({ node, start, end, nodeStart, nodeEnd });
  }

  function ttsSliceTextNodeToRange(textNode, range) {
    const full = textNode.textContent || "";
    let start = 0;
    let end = full.length;

    if (range.startContainer === textNode) start = range.startOffset;
    if (range.endContainer === textNode) end = range.endOffset;

    start = Math.max(0, Math.min(start, full.length));
    end = Math.max(start, Math.min(end, full.length));

    const text = full.slice(start, end);
    if (!text.trim()) return null;
    return { text, nodeStart: start, nodeEnd: end };
  }

  function ttsIsHiddenTextNode(node) {
    if (!node || node.nodeType !== Node.TEXT_NODE) return true;
    if (!node.textContent?.trim()) return true;

    const el = node.parentElement;
    if (!el) return true;
    if (el.closest("script, style, noscript, [aria-hidden='true']")) return true;

    try {
      const cs = window.getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden") return true;
    } catch { }

    return false;
  }

  // Highlighting with rAF throttle
  function ttsScheduleHighlight(globalCharIndex) {
    ttsPendingCharIndex = globalCharIndex;

    if (ttsRafId) return;
    ttsRafId = requestAnimationFrame(() => {
      ttsRafId = null;
      if (ttsPendingCharIndex == null) return;
      ttsHighlightAt(ttsPendingCharIndex);
    });
  }

  function ttsHighlightAt(charIndex) {
    ttsClearHighlights();

    const entry = ttsTextMap.find(t => charIndex >= t.start && charIndex < t.end && t.node);
    if (!entry) return;

    const offsetInSeg = charIndex - entry.start;
    const node = entry.node;
    const text = node.textContent || "";

    const nodeOffset = entry.nodeStart + offsetInSeg;
    const endNodeOffset = ttsFindWordEnd(text, nodeOffset, entry.nodeEnd);

    try {
      const r = document.createRange();
      r.setStart(node, Math.min(nodeOffset, text.length));
      r.setEnd(node, Math.min(endNodeOffset, text.length));
      ttsDrawOverlay(r);
    } catch { }
  }

  function ttsFindWordEnd(text, startOffset, hardEnd) {
    const endLimit = Math.min(hardEnd ?? text.length, text.length);
    for (let i = startOffset; i < endLimit; i++) {
      const ch = text[i];
      if (/\s/.test(ch) || /[.,!?;:)\]}]/.test(ch)) return i;
    }
    return endLimit;
  }

  function ttsDrawOverlay(range) {
    const root = ensureTTSOverlayRoot();

    for (const rect of range.getClientRects()) {
      const div = document.createElement("div");
      div.className = "ua-tts-overlay";
      div.style.left = (rect.left + window.scrollX) + "px";
      div.style.top = (rect.top + window.scrollY) + "px";
      div.style.width = rect.width + "px";
      div.style.height = rect.height + "px";
      root.appendChild(div);
    }
  }

  function ttsClearHighlights() {
    const root = document.getElementById("ua-tts-overlay-root");
    if (root) root.innerHTML = "";
  }

  // Stop TTS on page unload
  window.addEventListener("beforeunload", ttsStop);

  // ============================================
  // ua-widget.js (Main)
  // ============================================

  const DARK_MODE_KEY = "ua-widget-dark-mode";

  // Dirty state tracking for save prompt
  let savedPrefs = null;        // What's stored in chrome.storage.local
  let isDirty = false;          // true when current differs from saved

  /**
   * Show or hide the save prompt bar
   */
  function showSavePrompt(panelEl, show) {
    const prompt = panelEl?.querySelector("#ua-save-prompt");
    if (prompt) {
      prompt.hidden = !show;
    }
  }

  /**
   * Check if prefs have changed and show save prompt
   */
  function markDirtyIfChanged(panelEl, currentSettings) {
    // Compare current with active profile prefs (only persistable fields)
    const persistKeys = ['fontScale', 'lineHeight', 'paragraphSpacing',
      'contentPadding', 'maxLineWidth', 'fontFamily'];

    const activePrefs = getActiveProfile()?.prefs || {};

    const hasChanges = persistKeys.some(key => {
      const current = currentSettings[key];
      const saved = activePrefs[key] ?? DEFAULT_SETTINGS[key];
      return current !== saved;
    });

    if (hasChanges && !isDirty) {
      isDirty = true;
      showSavePrompt(panelEl, true);
    }
  }

  /**
   * Initialize the widget (async to load prefs from chrome.storage)
   */
  async function initWidget() {
    // 1) Detect content roots and set up transformation engine
    const engine = initTransformEngine({
      targetingOptions: {}
    });

    // 2) Load saved settings from chrome.storage.local
    savedPrefs = await loadSettingsAsync();
    let settings = { ...DEFAULT_SETTINGS, ...(savedPrefs || {}) };
    engine.apply(settings);

    // 3) Build UI
    const { launcherBtn, panelEl, closeBtn, darkToggle } = mountWidget(settings);

    // 4) Keyboard accessibility
    installKeyboardA11y({ launcherBtn, panelEl, closeBtn });

    // 5) Wire UI -> settings -> engine (without auto-save)
    wireControls(panelEl, engine, () => settings, (next) => {
      settings = next;
      engine.apply(settings);
      // Don't auto-save, just mark dirty and show prompt
      markDirtyIfChanged(panelEl, settings);
    }, () => {
      settings = { ...DEFAULT_SETTINGS };
      engine.apply(settings);
      clearSettings();
      savedPrefs = null;
      isDirty = false;
      showSavePrompt(panelEl, false);
      syncUI(panelEl, settings);
    });

    // 6) Wire save prompt buttons
    const saveBtn = panelEl.querySelector("#ua-save-prefs");
    const laterBtn = panelEl.querySelector("#ua-save-later");

    saveBtn?.addEventListener("click", () => {
      // Save current settings
      const prefsToSave = {
        fontScale: settings.fontScale,
        lineHeight: settings.lineHeight,
        paragraphSpacing: settings.paragraphSpacing,
        contentPadding: settings.contentPadding,
        maxLineWidth: settings.maxLineWidth,
        fontFamily: settings.fontFamily,
        // Also save visual modes
        nightMode: isNightModeOn(),
        reduceColors: document.documentElement.classList.contains("ua-reduced-colors"),
        ttsRate: TTS_SETTINGS.rate,
      };
      saveSettings(prefsToSave);
      savedPrefs = prefsToSave;
      isDirty = false;
      showSavePrompt(panelEl, false);
    });

    laterBtn?.addEventListener("click", () => {
      // Just hide the prompt, don't save
      showSavePrompt(panelEl, false);
      // Will show again on next change
      isDirty = false;
    });

    // 7) Wire profile dropdown
    const profileSelect = panelEl.querySelector("#ua-profile-select");
    const addProfileBtn = panelEl.querySelector("#ua-add-profile");

    // Helper: Populate profile dropdown
    function updateProfileDropdown() {
      if (!profileSelect) return;
      profileSelect.innerHTML = "";
      const profiles = getAllProfiles();
      profiles.forEach(p => {
        const opt = document.createElement("option");
        opt.value = p.id;
        opt.textContent = p.name;
        if (p.id === getActiveProfileId()) {
          opt.selected = true;
        }
        profileSelect.appendChild(opt);
      });
      // Update add button state
      if (addProfileBtn) {
        addProfileBtn.disabled = getProfileCount() >= MAX_PROFILES;
      }
    }

    // Helper: Apply profile prefs to UI and engine
    function applyProfilePrefs(prefs) {
      settings = { ...DEFAULT_SETTINGS, ...prefs };
      engine.apply(settings);
      syncUI(panelEl, settings);

      // Apply visual modes from profile
      setNightMode(!!prefs.nightMode);
      const nightToggle = panelEl.querySelector("#ua-night-toggle");
      const nightCard = nightToggle?.closest(".ua-mode-card");
      if (nightToggle) {
        nightToggle.setAttribute("aria-checked", prefs.nightMode ? "true" : "false");
        const srOnly = nightToggle.querySelector(".ua-toggle-status");
        if (srOnly) srOnly.textContent = prefs.nightMode ? "On" : "Off";
        nightCard?.classList.toggle("ua-mode-active", !!prefs.nightMode);
      }

      if (prefs.reduceColors) {
        document.documentElement.classList.add("ua-reduced-colors");
      } else {
        document.documentElement.classList.remove("ua-reduced-colors");
      }
      const reduceToggle = panelEl.querySelector("#ua-reduce-toggle");
      const reduceCard = reduceToggle?.closest(".ua-mode-card");
      if (reduceToggle) {
        reduceToggle.setAttribute("aria-checked", prefs.reduceColors ? "true" : "false");
        const srOnly = reduceToggle.querySelector(".ua-toggle-status");
        if (srOnly) srOnly.textContent = prefs.reduceColors ? "On" : "Off";
        reduceCard?.classList.toggle("ua-mode-active", !!prefs.reduceColors);
      }

      if (prefs.ttsRate) {
        TTS_SETTINGS.rate = prefs.ttsRate;
        const ttsSpeedSlider = panelEl.querySelector("#ua-tts-speed");
        const ttsSpeedValue = panelEl.querySelector("#ua-tts-speed-value");
        if (ttsSpeedSlider) ttsSpeedSlider.value = TTS_SETTINGS.rate;
        if (ttsSpeedValue) ttsSpeedValue.textContent = TTS_SETTINGS.rate.toFixed(1) + "x";
      }

      savedPrefs = prefs;
      isDirty = false;
      showSavePrompt(panelEl, false);
    }

    // Profile switch handler
    profileSelect?.addEventListener("change", () => {
      const newProfileId = profileSelect.value;
      const prefs = switchProfile(newProfileId);
      if (prefs) {
        applyProfilePrefs(prefs);
      }
    });

    // Add profile handler
    addProfileBtn?.addEventListener("click", () => {
      if (getProfileCount() >= MAX_PROFILES) {
        return;
      }
      const profileNum = getProfileCount();
      const name = prompt("Enter profile name:", `User ${profileNum}`);
      if (name !== null && name.trim()) {
        const newProfile = createNewProfile(name.trim());
        if (newProfile) {
          updateProfileDropdown();
          // Switch to new profile
          profileSelect.value = newProfile.id;
          switchProfile(newProfile.id);
          applyProfilePrefs(newProfile.prefs);
        }
      }
    });

    // Initial profile dropdown population
    updateProfileDropdown();

    // 8) Wire "Make Accessible" button - applies saved preferences
    const makeAccessibleBtn = panelEl.querySelector("#ua-make-accessible");
    makeAccessibleBtn?.addEventListener("click", async () => {
      // Load saved prefs from storage
      const prefs = await loadSettingsAsync();
      if (!prefs) {
        // No saved prefs - show a brief message
        makeAccessibleBtn.textContent = "⚠️ No saved preferences";
        setTimeout(() => {
          makeAccessibleBtn.textContent = "✨ Make This Page Accessible";
        }, 2000);
        return;
      }

      // Apply typography settings
      settings = { ...DEFAULT_SETTINGS, ...prefs };
      engine.apply(settings);
      syncUI(panelEl, settings);
      savedPrefs = prefs;

      // Apply night mode
      if (prefs.nightMode) {
        setNightMode(true);
        const nightToggle = panelEl.querySelector("#ua-night-toggle");
        const nightCard = nightToggle?.closest(".ua-mode-card");
        if (nightToggle) {
          nightToggle.setAttribute("aria-checked", "true");
          const srOnly = nightToggle.querySelector(".ua-toggle-status");
          if (srOnly) srOnly.textContent = "On";
          nightCard?.classList.add("ua-mode-active");
        }
      }

      // Apply reduce colors
      if (prefs.reduceColors) {
        document.documentElement.classList.add("ua-reduced-colors");
        const reduceToggle = panelEl.querySelector("#ua-reduce-toggle");
        const reduceCard = reduceToggle?.closest(".ua-mode-card");
        if (reduceToggle) {
          reduceToggle.setAttribute("aria-checked", "true");
          const srOnly = reduceToggle.querySelector(".ua-toggle-status");
          if (srOnly) srOnly.textContent = "On";
          reduceCard?.classList.add("ua-mode-active");
        }
      }

      // Apply TTS rate
      if (prefs.ttsRate) {
        TTS_SETTINGS.rate = prefs.ttsRate;
        const ttsSpeedSlider = panelEl.querySelector("#ua-tts-speed");
        const ttsSpeedValue = panelEl.querySelector("#ua-tts-speed-value");
        if (ttsSpeedSlider) ttsSpeedSlider.value = TTS_SETTINGS.rate;
        if (ttsSpeedValue) ttsSpeedValue.textContent = TTS_SETTINGS.rate.toFixed(1) + "x";
      }

      // Visual feedback
      makeAccessibleBtn.textContent = "✅ Applied!";
      setTimeout(() => {
        makeAccessibleBtn.textContent = "✨ Make This Page Accessible";
      }, 1500);

      // Hide save prompt since we just applied saved prefs
      isDirty = false;
      showSavePrompt(panelEl, false);
    });

    // Initial UI sync
    syncUI(panelEl, settings);

    // Apply saved visual modes
    if (savedPrefs?.nightMode) {
      setNightMode(true);
      const nightToggle = panelEl.querySelector("#ua-night-toggle");
      const nightCard = nightToggle?.closest(".ua-mode-card");
      if (nightToggle) {
        nightToggle.setAttribute("aria-checked", "true");
        const srOnly = nightToggle.querySelector(".ua-toggle-status");
        if (srOnly) srOnly.textContent = "On";
        nightCard?.classList.add("ua-mode-active");
      }
    }

    if (savedPrefs?.reduceColors) {
      document.documentElement.classList.add("ua-reduced-colors");
      const reduceToggle = panelEl.querySelector("#ua-reduce-toggle");
      const reduceCard = reduceToggle?.closest(".ua-mode-card");
      if (reduceToggle) {
        reduceToggle.setAttribute("aria-checked", "true");
        const srOnly = reduceToggle.querySelector(".ua-toggle-status");
        if (srOnly) srOnly.textContent = "On";
        reduceCard?.classList.add("ua-mode-active");
      }
    }

    if (savedPrefs?.ttsRate) {
      TTS_SETTINGS.rate = savedPrefs.ttsRate;
      const ttsSpeedSlider = panelEl.querySelector("#ua-tts-speed");
      const ttsSpeedValue = panelEl.querySelector("#ua-tts-speed-value");
      if (ttsSpeedSlider) ttsSpeedSlider.value = TTS_SETTINGS.rate;
      if (ttsSpeedValue) ttsSpeedValue.textContent = TTS_SETTINGS.rate.toFixed(1) + "x";
    }

    // ============================================
    // 9) Notes CRUD wiring
    // ============================================

    let _currentSelectionText = "";
    let _cachedSelection = ""; // Cached from selectionchange (survives click)
    let _editingNoteId = null;
    let _lastKnownUrl = getUrlKey();

    const notesSelText = panelEl.querySelector("#ua-notes-sel-text");
    const notesAddBtn = panelEl.querySelector("#ua-notes-add-btn");
    const notesCaptureBtn = panelEl.querySelector("#ua-notes-capture-btn");
    const noteEditor = panelEl.querySelector("#ua-note-editor");
    const noteEditorHeading = panelEl.querySelector("#ua-note-editor-heading");
    const noteTitleInput = panelEl.querySelector("#ua-note-title-input");
    const noteTextInput = panelEl.querySelector("#ua-note-text-input");
    const noteSaveBtn = panelEl.querySelector("#ua-note-save-btn");
    const noteCancelBtn = panelEl.querySelector("#ua-note-cancel-btn");
    const notesList = panelEl.querySelector("#ua-notes-list");
    const notesEmpty = panelEl.querySelector("#ua-notes-empty");
    const notesCount = panelEl.querySelector("#ua-notes-count");
    const notesBadge = panelEl.querySelector("#ua-notes-badge");

    // -- Cache selection continuously so it survives launcher click --
    document.addEventListener("selectionchange", () => {
      const sel = window.getSelection();
      const text = sel ? sel.toString().trim() : "";
      if (text) _cachedSelection = text;
    });

    // -- Update the selection UI --
    function showSelection(text) {
      _currentSelectionText = text;
      if (text) {
        notesSelText.textContent = trimSnippet(text);
        notesSelText.classList.add("ua-has-selection");
        notesAddBtn.disabled = false;
      } else {
        notesSelText.textContent = "Select text on the page to add a note";
        notesSelText.classList.remove("ua-has-selection");
        notesAddBtn.disabled = true;
      }
    }

    // -- Capture selection: uses live selection first, falls back to cache --
    function captureSelection() {
      const sel = window.getSelection();
      const liveText = sel ? sel.toString().trim() : "";
      const text = liveText || _cachedSelection;
      showSelection(text);
    }

    // -- Manual capture button --
    notesCaptureBtn.addEventListener("click", () => {
      const sel = window.getSelection();
      const liveText = sel ? sel.toString().trim() : "";
      const text = liveText || _cachedSelection;
      if (text) {
        showSelection(text);
        notesCaptureBtn.textContent = "✅ Captured!";
        setTimeout(() => { notesCaptureBtn.textContent = "🔄 Capture Selection"; }, 1200);
      } else {
        notesCaptureBtn.textContent = "⚠️ No selection";
        setTimeout(() => { notesCaptureBtn.textContent = "🔄 Capture Selection"; }, 1200);
      }
    });

    // -- Format date --
    function formatNoteDate(ts) {
      const d = new Date(ts);
      const now = new Date();
      const diff = now - d;
      if (diff < 60000) return "Just now";
      if (diff < 3600000) return Math.floor(diff / 60000) + "m ago";
      if (diff < 86400000) return Math.floor(diff / 3600000) + "h ago";
      if (diff < 604800000) return Math.floor(diff / 86400000) + "d ago";
      return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: d.getFullYear() !== now.getFullYear() ? "numeric" : undefined });
    }

    // -- Render a single note card --
    function renderNoteCard(note) {
      const card = document.createElement("div");
      card.className = "ua-note-card";
      card.dataset.noteId = note.id;

      const previewText = note.noteText.length > 200
        ? note.noteText.slice(0, 200) + "…"
        : note.noteText;

      card.innerHTML = `
        <div class="ua-note-card-header">
          <div class="ua-note-card-title">${escapeHtml(note.title)}</div>
          <div class="ua-note-card-date">${formatNoteDate(note.updatedAt)}</div>
        </div>
        ${previewText ? `<div class="ua-note-card-text">${escapeHtml(previewText)}</div>` : ""}
        <div class="ua-note-card-meta">
          <span class="ua-note-card-domain">${escapeHtml(note.hostname)}</span>
        </div>
        <div class="ua-note-actions">
          <button type="button" class="ua-note-action-btn" data-action="copy" title="Copy note">
            📋 Copy
          </button>
          <button type="button" class="ua-note-action-btn" data-action="edit" title="Edit note">
            ✏️ Edit
          </button>
          <button type="button" class="ua-note-action-btn ua-note-delete-btn" data-action="delete" title="Delete note">
            🗑️ Delete
          </button>
        </div>
      `;

      // Wire card actions
      card.querySelector('[data-action="copy"]').addEventListener("click", () => {
        const copyText = `"${note.selectionSnippet}"\n\n${note.noteText}\n\n— ${note.urlKey}`;
        navigator.clipboard.writeText(copyText).then(() => {
          const btn = card.querySelector('[data-action="copy"]');
          btn.textContent = "✅ Copied!";
          setTimeout(() => { btn.textContent = "📋 Copy"; }, 1500);
        });
      });

      card.querySelector('[data-action="edit"]').addEventListener("click", () => {
        openEditor(note);
      });

      card.querySelector('[data-action="delete"]').addEventListener("click", async () => {
        await deleteNote(note.id);
        await renderNotesList();
      });

      return card;
    }

    // -- Render notes list for current page --
    async function renderNotesList() {
      const urlKey = getUrlKey();
      const profileId = getActiveProfileId();
      const notes = await getNotesForPage(urlKey, profileId);

      // Clear list (except empty state)
      const existingCards = notesList.querySelectorAll(".ua-note-card");
      existingCards.forEach(c => c.remove());

      if (notes.length === 0) {
        notesEmpty.hidden = false;
        notesCount.textContent = "";
      } else {
        notesEmpty.hidden = true;
        notesCount.textContent = notes.length;
        notes.forEach(note => {
          notesList.appendChild(renderNoteCard(note));
        });
      }

      // Update badge
      if (notes.length > 0) {
        notesBadge.textContent = notes.length;
        notesBadge.hidden = false;
      } else {
        notesBadge.hidden = true;
      }
    }

    // -- Open note editor --
    function openEditor(existingNote) {
      _editingNoteId = existingNote ? existingNote.id : null;
      noteEditorHeading.textContent = existingNote ? "Edit Note" : "New Note";
      noteTitleInput.value = existingNote
        ? existingNote.title
        : titleFromSnippet(_currentSelectionText);
      noteTextInput.value = existingNote ? existingNote.noteText : "";
      noteEditor.hidden = false;
      noteTitleInput.focus();
    }

    // -- Close note editor --
    function closeEditor() {
      _editingNoteId = null;
      noteEditor.hidden = true;
      noteTitleInput.value = "";
      noteTextInput.value = "";
    }

    // Add Note button
    notesAddBtn.addEventListener("click", () => {
      openEditor(null);
    });

    // Save button
    noteSaveBtn.addEventListener("click", async () => {
      const title = noteTitleInput.value.trim();
      const noteText = noteTextInput.value.trim();
      if (!title && !noteText) return;

      if (_editingNoteId) {
        await updateNote(_editingNoteId, { title, noteText });
      } else {
        await addNote({
          selectionSnippet: _currentSelectionText,
          noteText,
          title: title || titleFromSnippet(_currentSelectionText),
        });
      }
      closeEditor();
      await renderNotesList();
    });

    // Cancel button
    noteCancelBtn.addEventListener("click", () => {
      closeEditor();
    });

    // -- Refresh notes on panel open & capture selection --
    async function onPanelOpen() {
      captureSelection();
      await renderNotesList();
    }

    // -- URL change detection (SPA nav, hash changes) --
    function checkUrlChange() {
      const currentUrl = getUrlKey();
      if (currentUrl !== _lastKnownUrl) {
        _lastKnownUrl = currentUrl;
        // Refresh notes if panel is open
        if (!panelEl.hidden) {
          renderNotesList();
          captureSelection();
        }
      }
    }

    // Detect URL changes via popstate, hashchange, and polling
    window.addEventListener("popstate", checkUrlChange);
    window.addEventListener("hashchange", checkUrlChange);
    setInterval(checkUrlChange, 1500);

    // -- Context menu message listener --
    if (chrome.runtime && chrome.runtime.onMessage) {
      chrome.runtime.onMessage.addListener((msg) => {
        if (msg.action === "addNote" && msg.text) {
          _currentSelectionText = msg.text;
          // Open panel if closed
          if (panelEl.hidden) {
            openPanel({ launcherBtn, panelEl, closeBtn });
          }
          // Switch to notes tab
          panelEl._switchTab("notes");
          // Update selection preview
          notesSelText.textContent = trimSnippet(msg.text);
          notesSelText.classList.add("ua-has-selection");
          notesAddBtn.disabled = false;
          // Open editor
          openEditor(null);
          renderNotesList();
        }
      });
    }

    // -- Export notes as .txt --
    const notesExportBtn = panelEl.querySelector("#ua-notes-export-btn");
    notesExportBtn.addEventListener("click", async () => {
      const urlKey = getUrlKey();
      const profileId = getActiveProfileId();
      const notes = await getNotesForPage(urlKey, profileId);
      if (notes.length === 0) {
        notesExportBtn.textContent = "⚠️ No notes to export";
        setTimeout(() => { notesExportBtn.textContent = "📤 Export Notes"; }, 1500);
        return;
      }

      const lines = [];
      lines.push("═══════════════════════════════════════");
      lines.push("  NOTES — " + document.title);
      lines.push("  " + urlKey);
      lines.push("  Exported: " + new Date().toLocaleString());
      lines.push("═══════════════════════════════════════");
      lines.push("");

      notes.forEach((note, i) => {
        lines.push(`── Note ${i + 1} ──────────────────────`);
        lines.push(`Title:   ${note.title}`);
        lines.push(`Date:    ${new Date(note.createdAt).toLocaleString()}`);
        if (note.selectionSnippet) {
          lines.push(`Source:  "${note.selectionSnippet}"`);
        }
        lines.push("");
        lines.push(note.noteText);
        lines.push("");
      });

      const blob = new Blob([lines.join("\n")], { type: "text/plain;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      const safeName = document.title.replace(/[^a-zA-Z0-9 ]/g, "").trim().replace(/\s+/g, "_").slice(0, 40);
      a.download = `notes_${safeName || "page"}.txt`;
      a.click();
      URL.revokeObjectURL(url);

      notesExportBtn.textContent = "✅ Exported!";
      setTimeout(() => { notesExportBtn.textContent = "📤 Export Notes"; }, 1500);
    });

    // Initial notes load
    await loadAllNotes();
    await renderNotesList();

    // Launcher click
    launcherBtn.addEventListener("click", async () => {
      if (panelEl.hidden) {
        openPanel({ launcherBtn, panelEl, closeBtn });
        await onPanelOpen();
      } else {
        closePanel({ launcherBtn, panelEl });
      }
    });
  }

  // Start initialization
  initWidget();

  function mountWidget(settings) {
    if (document.getElementById("ua-widget-launcher")) {
      return {
        launcherBtn: document.getElementById("ua-widget-launcher"),
        panelEl: document.getElementById("ua-widget-panel"),
        closeBtn: document.getElementById("ua-widget-close"),
        darkToggle: document.getElementById("ua-dark-toggle"),
      };
    }

    const launcherBtn = document.createElement("button");
    launcherBtn.id = "ua-widget-launcher";
    launcherBtn.type = "button";
    launcherBtn.textContent = "♿ WebAID";
    launcherBtn.setAttribute("aria-label", "Open accessibility tools");

    const panelEl = document.createElement("section");
    panelEl.id = "ua-widget-panel";
    panelEl.hidden = true;
    panelEl.setAttribute("aria-hidden", "true");
    panelEl.setAttribute("role", "dialog");
    panelEl.setAttribute("aria-label", "Accessibility tools");

    const closeBtn = document.createElement("button");
    closeBtn.id = "ua-widget-close";
    closeBtn.type = "button";
    closeBtn.innerHTML = "&times;";
    closeBtn.setAttribute("aria-label", "Close accessibility tools");

    const darkToggle = document.createElement("button");
    darkToggle.id = "ua-dark-toggle";
    darkToggle.type = "button";
    darkToggle.innerHTML = "☀️";
    darkToggle.setAttribute("aria-label", "Toggle light mode");

    panelEl.innerHTML = `
    <header>
      <div class="ua-header-info">
        <span class="ua-header-icon">♿</span>
        <div class="ua-header-text">
          <h2>WebAID - Website Accessibility Interface Design</h2>
          <p class="ua-subtitle">Make the web work for you</p>
        </div>
      </div>
      <div class="ua-header-buttons"></div>
    </header>

    <!-- PROFILE SELECTOR -->
    <div class="ua-profile-bar">
      <div class="ua-profile-selector">
        <span class="ua-profile-icon">👤</span>
        <label for="ua-profile-select" class="ua-sr-only">Select Profile</label>
        <select id="ua-profile-select" class="ua-profile-select">
          <option value="default">Default</option>
        </select>
      </div>
      <button id="ua-add-profile" type="button" class="ua-add-profile-btn" title="Add new profile">+</button>
    </div>

    <!-- TAB BAR -->
    <div class="ua-tab-bar" role="tablist">
      <button class="ua-tab-btn active" role="tab" aria-selected="true" data-tab="accessibility" id="ua-tab-btn-accessibility">
        ♿ Accessibility
      </button>
      <button class="ua-tab-btn" role="tab" aria-selected="false" data-tab="notes" id="ua-tab-btn-notes">
        📝 Notes <span class="ua-notes-badge" id="ua-notes-badge" hidden></span>
      </button>
    </div>

    <!-- ========== ACCESSIBILITY TAB ========== -->
    <div class="ua-tab-pane" id="ua-tab-accessibility" role="tabpanel">
      <div class="ua-panel-content">
        <!-- ACCESSIBILITY MODES -->
        <div class="ua-modes-section">
          <button id="ua-make-accessible" type="button" class="ua-make-accessible-btn">
            ✨ Make This Page Accessible
          </button>
          <h3 class="ua-section-title">
            <span class="ua-section-title-icon">⚡</span>
            Quick Modes
            <span class="ua-section-badge">Toggle</span>
          </h3>
          <div class="ua-modes-grid">
            <div class="ua-mode-card" data-mode="reading">
              <div class="ua-mode-info">
                <span class="ua-mode-icon">📄</span>
                <span class="ua-mode-name">Reading<br>Mode</span>
              </div>
              <button class="ua-toggle" role="switch" aria-checked="false" aria-label="Reading Mode" id="ua-reader-toggle">
                <span class="ua-toggle-status">Off</span>
              </button>
            </div>
            <div class="ua-mode-card" data-mode="focus">
              <div class="ua-mode-info">
                <span class="ua-mode-icon">🎯</span>
                <span class="ua-mode-name">Focus/<br>ADHD</span>
              </div>
              <button class="ua-toggle" role="switch" aria-checked="false" aria-label="Focus Mode" id="ua-focus-toggle">
                <span class="ua-toggle-status">Off</span>
              </button>
            </div>
            <div class="ua-mode-card" data-mode="night">
              <div class="ua-mode-info">
                <span class="ua-mode-icon">🌙</span>
                <span class="ua-mode-name">Night<br>Mode</span>
              </div>
              <button class="ua-toggle" role="switch" aria-checked="false" aria-label="Night Mode" id="ua-night-toggle">
                <span class="ua-toggle-status">Off</span>
              </button>
            </div>
            <div class="ua-mode-card" data-mode="reduce">
              <div class="ua-mode-info">
                <span class="ua-mode-icon">🎨</span>
                <span class="ua-mode-name">Reduce<br>Colors</span>
              </div>
              <button class="ua-toggle" role="switch" aria-checked="false" aria-label="Reduce Colors" id="ua-reduce-toggle">
                <span class="ua-toggle-status">Off</span>
              </button>
            </div>
            <div class="ua-mode-card" data-mode="enhance">
              <div class="ua-mode-info">
                <span class="ua-mode-icon">🔤</span>
                <span class="ua-mode-name">Enhance<br>Text</span>
              </div>
              <button class="ua-toggle" role="switch" aria-checked="false" aria-label="Enhance Text" id="ua-enhance-toggle">
                <span class="ua-toggle-status">Off</span>
              </button>
            </div>
          </div>
        </div>

        <!-- TEXT & TYPOGRAPHY SECTION -->
        <section class="ua-section" aria-expanded="false">
          <button type="button" class="ua-section-header">
            <span class="ua-section-header-icon">T</span>
            <span class="ua-section-header-text">Text & Typography</span>
            <span class="ua-section-header-chevron">▼</span>
          </button>
          <div class="ua-section-content">
            <div class="ua-control">
              <label for="ua-font-scale">
                Font size
                <span class="ua-value-indicator" id="ua-font-scale-value">100%</span>
              </label>
              <div class="ua-slider-container">
                <input id="ua-font-scale" type="range" min="0.85" max="1.6" step="0.05" />
                <div class="ua-slider-labels">
                  <span>A−</span>
                  <span>A+</span>
                </div>
              </div>
            </div>

            <div class="ua-control">
              <label for="ua-line-height">
                Line spacing
                <span class="ua-value-indicator" id="ua-line-height-value">1.5</span>
              </label>
              <div class="ua-slider-container">
                <input id="ua-line-height" type="range" min="1.2" max="2.2" step="0.05" />
                <div class="ua-slider-labels">
                  <span>Tight</span>
                  <span>Loose</span>
                </div>
              </div>
            </div>

            <div class="ua-control">
              <label for="ua-paragraph-spacing">
                Paragraph spacing
                <span class="ua-value-indicator" id="ua-paragraph-spacing-value">1.0em</span>
              </label>
              <div class="ua-slider-container">
                <input id="ua-paragraph-spacing" type="range" min="0.5" max="2.0" step="0.05" />
                <div class="ua-slider-labels">
                  <span>Compact</span>
                  <span>Spacious</span>
                </div>
              </div>
            </div>

            <div class="ua-control">
              <label for="ua-font-family">Font style</label>
              <select id="ua-font-family"></select>
            </div>

            <div class="ua-buttons">
              <button id="ua-bigger" type="button">A+</button>
              <button id="ua-smaller" type="button">A−</button>
            </div>
          </div>
        </section>

        <!-- COLORS & CONTRAST SECTION -->
        <section class="ua-section" aria-expanded="false">
          <button type="button" class="ua-section-header">
            <span class="ua-section-header-icon">🎨</span>
            <span class="ua-section-header-text">Padding</span>
            <span class="ua-section-header-chevron">▼</span>
          </button>
          <div class="ua-section-content">
            <div class="ua-control">
              <label for="ua-padding">
                Side padding
                <span class="ua-value-indicator" id="ua-padding-value">0px</span>
              </label>
              <div class="ua-slider-container">
                <input id="ua-padding" type="range" min="0" max="48" step="2" />
                <div class="ua-slider-labels">
                  <span>None</span>
                  <span>Max</span>
                </div>
              </div>
            </div>

            <div class="ua-control">
              <label for="ua-max-width">
                Max line width
                <span class="ua-value-indicator" id="ua-max-width-value">None</span>
              </label>
              <div class="ua-slider-container">
                <input id="ua-max-width" type="range" min="0" max="1200" step="50" />
                <div class="ua-slider-labels">
                  <span>Full</span>
                  <span>Narrow</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        <!-- READING ASSISTANCE SECTION -->
        <section class="ua-section" aria-expanded="false">
          <button type="button" class="ua-section-header">
            <span class="ua-section-header-icon">🔊</span>
            <span class="ua-section-header-text">Reading Assistance</span>
            <span class="ua-section-header-chevron">▼</span>
          </button>
          <div class="ua-section-content">
            <div class="ua-control">
              <label for="ua-tts-speed">
                Speech speed
                <span class="ua-value-indicator" id="ua-tts-speed-value">1.0x</span>
              </label>
              <div class="ua-slider-container">
                <input id="ua-tts-speed" type="range" min="0.5" max="2.0" step="0.1" />
                <div class="ua-slider-labels">
                  <span>Slow</span>
                  <span>Fast</span>
                </div>
              </div>
            </div>

            <div class="ua-buttons">
              <button id="ua-speak-sel" type="button">🔊 Selection</button>
              <button id="ua-speak-main" type="button">🔊 Page</button>
            </div>

            <div class="ua-buttons">
              <button id="ua-tts-pause" type="button">⏸️ Pause</button>
              <button id="ua-tts-stop" type="button">⏹️ Stop</button>
            </div>
          </div>
        </section>
      </div>

      <div class="ua-panel-footer">
        <div id="ua-save-prompt" class="ua-save-prompt" hidden>
          <span class="ua-save-prompt-text">Save preferences?</span>
          <div class="ua-save-prompt-buttons">
            <button id="ua-save-prefs" type="button">Save</button>
            <button id="ua-save-later" type="button">Later</button>
          </div>
        </div>
        <div class="ua-buttons ua-buttons-full">
          <button id="ua-reset" type="button">↺ Reset All</button>
        </div>
      </div>
    </div>

    <!-- ========== NOTES TAB ========== -->
    <div class="ua-tab-pane" id="ua-tab-notes" role="tabpanel" hidden>
      <div class="ua-notes-content">
        <!-- SELECTION PREVIEW -->
        <div class="ua-notes-selection" id="ua-notes-selection">
          <div class="ua-notes-selection-label">
            <span class="ua-notes-sel-icon">✂️</span> Selected Text
          </div>
          <div class="ua-notes-sel-text" id="ua-notes-sel-text">
            Select text on the page to add a note
          </div>
          <div class="ua-notes-btn-row">
            <button type="button" class="ua-notes-capture-btn" id="ua-notes-capture-btn" title="Capture current selection">
              🔄 Capture Selection
            </button>
            <button type="button" class="ua-notes-add-btn" id="ua-notes-add-btn" disabled>
              <span>＋</span> Add Note
            </button>
          </div>
        </div>

        <!-- NOTE EDITOR (hidden by default) -->
        <div class="ua-note-editor" id="ua-note-editor" hidden>
          <div class="ua-note-editor-header">
            <span class="ua-note-editor-icon">✏️</span>
            <span class="ua-note-editor-title" id="ua-note-editor-heading">New Note</span>
          </div>
          <div class="ua-note-editor-body">
            <label for="ua-note-title-input" class="ua-note-field-label">Title</label>
            <input type="text" id="ua-note-title-input" class="ua-note-input" placeholder="Note title…" autocomplete="off" />

            <label for="ua-note-text-input" class="ua-note-field-label">Your Note</label>
            <div class="ua-note-textarea-wrap">
              <textarea id="ua-note-text-input" class="ua-note-textarea" rows="5" placeholder="Write your understanding, meaning, or thoughts…"></textarea>
              <div class="ua-note-textarea-hints">
                <span>💡 Tip: Write what this means to you</span>
              </div>
            </div>

            <div class="ua-note-editor-actions">
              <button type="button" class="ua-note-save-btn" id="ua-note-save-btn">
                💾 Save Note
              </button>
              <button type="button" class="ua-note-cancel-btn" id="ua-note-cancel-btn">
                Cancel
              </button>
            </div>
          </div>
        </div>

        <!-- NOTES LIST -->
        <div class="ua-notes-list-header">
          <span class="ua-notes-list-icon">📋</span>
          <span>Notes for this page</span>
          <span class="ua-notes-count" id="ua-notes-count"></span>
        </div>
        <div class="ua-notes-list" id="ua-notes-list">
          <div class="ua-notes-empty" id="ua-notes-empty">
            <div class="ua-notes-empty-icon">📝</div>
            <div class="ua-notes-empty-text">No notes yet</div>
            <div class="ua-notes-empty-hint">Select text on the page and click "Add Note" to get started</div>
          </div>
        </div>

        <!-- EXPORT -->
        <div class="ua-notes-export" id="ua-notes-export">
          <button type="button" class="ua-notes-export-btn" id="ua-notes-export-btn">
            📤 Export Notes
          </button>
        </div>

        <!-- PRIVACY NOTICE -->
        <div class="ua-notes-privacy">
          🔒 Notes are stored locally in your browser.
        </div>
      </div>
    </div>
  `;

    // Add collapsible section toggles
    const sections = panelEl.querySelectorAll(".ua-section");
    sections.forEach(section => {
      const header = section.querySelector(".ua-section-header");
      header.addEventListener("click", () => {
        const isExpanded = section.getAttribute("aria-expanded") === "true";
        section.setAttribute("aria-expanded", !isExpanded);
      });
    });

    // Tab switching logic
    const tabBtns = panelEl.querySelectorAll(".ua-tab-btn");
    const tabPanes = panelEl.querySelectorAll(".ua-tab-pane");

    function switchTab(tabId) {
      tabBtns.forEach(btn => {
        const isActive = btn.dataset.tab === tabId;
        btn.classList.toggle("active", isActive);
        btn.setAttribute("aria-selected", isActive ? "true" : "false");
      });
      tabPanes.forEach(pane => {
        pane.hidden = pane.id !== "ua-tab-" + tabId;
      });
    }

    tabBtns.forEach(btn => {
      btn.addEventListener("click", () => switchTab(btn.dataset.tab));
    });

    // Expose switchTab for external use (context menu)
    panelEl._switchTab = switchTab;

    const headerButtons = panelEl.querySelector(".ua-header-buttons");
    headerButtons.appendChild(darkToggle);
    headerButtons.appendChild(closeBtn);

    const fontSelect = panelEl.querySelector("#ua-font-family");
    FONT_PRESETS.forEach(p => {
      const opt = document.createElement("option");
      opt.value = p.id;
      opt.textContent = p.label;
      fontSelect.appendChild(opt);
    });

    document.body.appendChild(launcherBtn);
    document.body.appendChild(panelEl);

    const savedDarkMode = localStorage.getItem(DARK_MODE_KEY);
    if (savedDarkMode === "true") {
      panelEl.classList.add("ua-light-mode");
      darkToggle.innerHTML = "🌙";
    }

    darkToggle.addEventListener("click", () => {
      const isLight = panelEl.classList.toggle("ua-light-mode");
      darkToggle.innerHTML = isLight ? "🌙" : "☀️";
      localStorage.setItem(DARK_MODE_KEY, isLight);
    });

    // Reduce Colors toggle switch
    const reduceToggle = panelEl.querySelector("#ua-reduce-toggle");
    const reduceCard = reduceToggle?.closest(".ua-mode-card");

    reduceToggle?.addEventListener("click", () => {
      const isReduced = document.documentElement.classList.toggle("ua-reduced-colors");
      reduceToggle.setAttribute("aria-checked", isReduced ? "true" : "false");
      const srOnly = reduceToggle.querySelector(".ua-toggle-status");
      if (srOnly) srOnly.textContent = isReduced ? "On" : "Off";
      reduceCard?.classList.toggle("ua-mode-active", isReduced);
    });

    // Night Mode toggle switch
    const nightToggle = panelEl.querySelector("#ua-night-toggle");
    const nightCard = nightToggle?.closest(".ua-mode-card");

    nightToggle?.addEventListener("click", () => {
      const isNight = toggleNightMode();
      nightToggle.setAttribute("aria-checked", isNight ? "true" : "false");
      const srOnly = nightToggle.querySelector(".ua-toggle-status");
      if (srOnly) srOnly.textContent = isNight ? "On" : "Off";
      nightCard?.classList.toggle("ua-mode-active", isNight);
    });
    // TTS Controls
    const ttsSpeedSlider = panelEl.querySelector("#ua-tts-speed");
    const ttsSpeedValue = panelEl.querySelector("#ua-tts-speed-value");
    ttsSpeedSlider.value = TTS_SETTINGS.rate;
    ttsSpeedValue.textContent = TTS_SETTINGS.rate.toFixed(1) + "x";

    ttsSpeedSlider.addEventListener("input", () => {
      const rate = parseFloat(ttsSpeedSlider.value);
      ttsSetRate(rate);
      ttsSpeedValue.textContent = rate.toFixed(1) + "x";
    });

    panelEl.querySelector("#ua-speak-sel").addEventListener("click", () => {
      const ok = ttsSpeakSelection();
      if (!ok) {
        alert("Select some text first, then click Speak Selection.");
      }
    });

    panelEl.querySelector("#ua-speak-main").addEventListener("click", () => {
      const ok = ttsSpeakMain();
      if (!ok) {
        alert("Could not detect main content on this page.");
      }
    });

    const pauseBtn = panelEl.querySelector("#ua-tts-pause");
    pauseBtn.addEventListener("click", () => {
      if (ttsIsPaused) {
        ttsResume();
        pauseBtn.textContent = "⏸️ Pause";
      } else {
        ttsPause();
        pauseBtn.textContent = "▶️ Resume";
      }
    });

    panelEl.querySelector("#ua-tts-stop").addEventListener("click", () => {
      ttsStop();
      pauseBtn.textContent = "⏸️ Pause";
    });

    closeBtn.addEventListener("click", () => closePanel({ launcherBtn, panelEl }));

    return { launcherBtn, panelEl, closeBtn, darkToggle };
  }

  function wireControls(panelEl, engine, getSettings, setSettings, onReset) {
    const $ = (sel) => panelEl.querySelector(sel);

    const fontScale = $("#ua-font-scale");
    const lineHeight = $("#ua-line-height");
    const paraSpacing = $("#ua-paragraph-spacing");
    const padding = $("#ua-padding");
    const maxWidth = $("#ua-max-width");
    const fontFamily = $("#ua-font-family");

    $("#ua-bigger").addEventListener("click", () => {
      const s = getSettings();
      setSettings({ ...s, fontScale: nextFontScale(s.fontScale, 0.05) });
      syncUI(panelEl, getSettings());
    });

    $("#ua-smaller").addEventListener("click", () => {
      const s = getSettings();
      setSettings({ ...s, fontScale: nextFontScale(s.fontScale, -0.05) });
      syncUI(panelEl, getSettings());
    });

    $("#ua-reset").addEventListener("click", () => onReset());

    // Reading Mode toggle switch
    const readerToggle = $("#ua-reader-toggle");
    const readerCard = readerToggle?.closest(".ua-mode-card");

    // Create a global function to sync reader toggle state
    window.uaSyncReaderToggle = (isActive) => {
      if (readerToggle) {
        readerToggle.setAttribute("aria-checked", isActive ? "true" : "false");
        const srOnly = readerToggle.querySelector(".ua-toggle-status");
        if (srOnly) srOnly.textContent = isActive ? "On" : "Off";
        readerCard?.classList.toggle("ua-mode-active", isActive);
      }
    };

    readerToggle?.addEventListener("click", () => {
      const isActive = toggleReaderMode();
      window.uaSyncReaderToggle(isActive);
    });

    // Focus Mode toggle switch
    const focusToggle = $("#ua-focus-toggle");
    const focusCard = focusToggle?.closest(".ua-mode-card");

    focusToggle?.addEventListener("click", () => {
      if (isFocusModeOn()) {
        exitFocusMode();
        focusToggle.setAttribute("aria-checked", "false");
        const srOnly = focusToggle.querySelector(".ua-toggle-status");
        if (srOnly) srOnly.textContent = "Off";
        focusCard?.classList.remove("ua-mode-active");
      } else {
        const roots = findContentRoots({ allowMultipleRoots: true });
        if (roots.length) {
          enterFocusMode({ roots });
          focusToggle.setAttribute("aria-checked", "true");
          const srOnly = focusToggle.querySelector(".ua-toggle-status");
          if (srOnly) srOnly.textContent = "On";
          focusCard?.classList.add("ua-mode-active");
        }
      }
    });

    // Soft Enhancement toggle (only font/spacing - no layout changes)    // Enhance Text toggle switch
    const enhanceToggle = $("#ua-enhance-toggle");
    const enhanceCard = enhanceToggle?.closest(".ua-mode-card");

    enhanceToggle?.addEventListener("click", () => {
      const isActive = enhanceToggle.getAttribute("aria-checked") === "true";

      if (isActive) {
        // Restore previous settings
        if (preEnhanceSettings) {
          setSettings(preEnhanceSettings);
          syncUI(panelEl, preEnhanceSettings);
          preEnhanceSettings = null;
        }
        enhanceToggle.setAttribute("aria-checked", "false");
        const srOnly = enhanceToggle.querySelector(".ua-toggle-status");
        if (srOnly) srOnly.textContent = "Off";
        enhanceCard?.classList.remove("ua-mode-active");
      } else {
        // Save current and apply enhancement
        preEnhanceSettings = { ...getSettings() };
        setSettings({ ...getSettings(), ...SOFT_ENHANCE_PRESET });
        syncUI(panelEl, getSettings());
        enhanceToggle.setAttribute("aria-checked", "true");
        const srOnly = enhanceToggle.querySelector(".ua-toggle-status");
        if (srOnly) srOnly.textContent = "On";
        enhanceCard?.classList.add("ua-mode-active");
      }
    });

    fontScale.addEventListener("input", () => {
      const s = getSettings();
      const newScale = clampFontScale(fontScale.value);
      setSettings({ ...s, fontScale: newScale });
      updateValueIndicator("ua-font-scale-value", Math.round(newScale * 100) + "%");
    });

    lineHeight.addEventListener("input", () => {
      const s = getSettings();
      const newVal = clampLineHeight(lineHeight.value);
      setSettings({ ...s, lineHeight: newVal });
      updateValueIndicator("ua-line-height-value", newVal.toFixed(2));
    });

    paraSpacing.addEventListener("input", () => {
      const s = getSettings();
      const newVal = clampParagraphSpacing(paraSpacing.value);
      setSettings({ ...s, paragraphSpacing: newVal });
      updateValueIndicator("ua-paragraph-spacing-value", newVal.toFixed(1) + "em");
    });

    padding.addEventListener("input", () => {
      const s = getSettings();
      const newVal = clampPaddingPx(padding.value);
      setSettings({ ...s, contentPadding: newVal });
      updateValueIndicator("ua-padding-value", newVal + "px");
    });

    maxWidth.addEventListener("input", () => {
      const s = getSettings();
      const newVal = clampMaxLineWidthPx(maxWidth.value);
      setSettings({ ...s, maxLineWidth: newVal });
      updateValueIndicator("ua-max-width-value", newVal === 0 ? "None" : newVal + "px");
    });

    fontFamily.addEventListener("change", () => {
      const s = getSettings();
      setSettings({ ...s, fontFamily: resolveFontFamily(fontFamily.value) });
    });
  }

  function updateValueIndicator(id, value) {
    const el = document.getElementById(id);
    if (el) {
      el.textContent = value;
      el.style.transform = "scale(1.1)";
      setTimeout(() => {
        el.style.transform = "";
      }, 150);
    }
  }

  function syncUI(panelEl, settings) {
    if (!panelEl) return;

    const setVal = (id, v) => {
      const el = panelEl.querySelector(id);
      if (el) el.value = String(v);
    };

    setVal("#ua-font-scale", settings.fontScale);
    setVal("#ua-line-height", settings.lineHeight);
    setVal("#ua-paragraph-spacing", settings.paragraphSpacing);
    setVal("#ua-padding", settings.contentPadding);
    setVal("#ua-max-width", settings.maxLineWidth || 0);

    updateValueIndicator("ua-font-scale-value", Math.round(settings.fontScale * 100) + "%");
    updateValueIndicator("ua-line-height-value", settings.lineHeight.toFixed(2));
    updateValueIndicator("ua-paragraph-spacing-value", settings.paragraphSpacing.toFixed(1) + "em");
    updateValueIndicator("ua-padding-value", settings.contentPadding + "px");
    updateValueIndicator("ua-max-width-value", settings.maxLineWidth === 0 ? "None" : settings.maxLineWidth + "px");

    const fontSelect = panelEl.querySelector("#ua-font-family");
    if (fontSelect) {
      const preset = FONT_PRESETS.find(p => p.value === settings.fontFamily) || FONT_PRESETS[0];
      fontSelect.value = preset.id;
    }
  }

})();
