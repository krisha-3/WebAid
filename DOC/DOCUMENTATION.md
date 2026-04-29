# Accessibility Toolkit - Complete Project Documentation

## 📋 Overview

The **Accessibility Toolkit** is a powerful Chrome/Firefox browser extension designed to enhance web readability and accessibility. It provides users with comprehensive tools to customize their browsing experience, including font scaling, spacing adjustments, dark mode, reader mode, and text-to-speech capabilities.

**Version:** 1.0.0  
**Type:** Browser Extension (Manifest V3)  
**Target Users:** Users with visual impairments, dyslexia, or general readability preferences

---

## 🎯 Core Features

### 1. **Font Scaling & Typography**
- Adjustable font size (85% - 160%)
- Custom font family selection with presets:
  - Website default
  - System UI (sans-serif)
  - Serif fonts
  - Dyslexia-friendly fonts
- Real-time font scaling with smooth transitions

### 2. **Spacing & Layout Control**
- **Line Height:** Adjustable spacing between lines (1.2x - 2.2x)
- **Paragraph Spacing:** Gap between paragraphs (0.5x - 2.0x)
- **Content Padding:** Side padding for content (0 - 48px)
- **Max Line Width:** Restricts text width for better readability (400px - 1200px)

### 3. **Reading Modes**
- **Reader Mode:** Extracts main content and displays it in a distraction-free interface with optimized typography
- **Focus Mode:** Hides all non-content elements except the main article/text
- **Night Mode:** Lightweight dark theme using CSS filters (90% invert with hue rotation)

### 4. **Text-to-Speech (TTS)**
- Read selected text aloud
- Read entire page content
- Adjustable speech speed (0.5x - 2.0x)
- Visual highlighting of currently spoken words
- Pause/Resume/Stop controls

### 5. **Visual Preferences**
- **Dark Mode Panel:** Elegant dark theme for the widget interface
- **Reduced Colors Mode:** Simplifies color palette for color-blind users
- **High Contrast Support:** Built-in accessibility for WCAG standards

### 6. **Quick Presets**
- **Enhance Button:** One-click soft enhancement (improved font + spacing)
- **Reset Button:** Restore all settings to defaults

---

## 🏗️ Architecture

### Project Structure
```
extension/
├── manifest.json          # Extension configuration
├── content.js            # Main extension logic (2094 lines)
├── content.css           # UI styling and animations
└── icons/
    ├── icon16.png        # Taskbar icon
    ├── icon48.png        # Extension list icon
    └── icon128.png       # Chrome Web Store icon
```

### Module Organization (within content.js)

The extension is modular and organized into logical sections:

#### **Core Modules**

1. **core/targeting.js** - Content Detection
   - Identifies main content areas on any webpage
   - Uses semantic HTML (main, article, role="main")
   - Scores candidate elements based on text density, paragraphs, headings
   - Special handling for chat UIs (ChatGPT, conversations)
   - Returns array of content root elements for styling

2. **core/transform-engine.js** - Style Application
   - Initializes CSS custom properties on content roots
   - Applies font scaling, line height, padding via CSS variables
   - Manages dynamic root discovery for SPA/chat applications
   - Validates roots remain in DOM (important for dynamic pages)

3. **core/storage.js** - Data Persistence
   - Saves user settings per domain using localStorage
   - Key prefix: `ua_widget_settings_v1:`
   - Gracefully handles quota errors
   - Settings auto-restore on page reload

#### **Feature Modules**

4. **features/font-family.js** - Font Presets
   - Defines 4 font presets with fallback stacks
   - Resolves preset IDs to CSS font families
   - Preserves monospace fonts (code, pre, kbd)

5. **features/font-size.js** - Font Scaling
   - Clamping function: enforces 85% - 160% bounds
   - Incremental adjustment (±5%) with button controls
   - Input validation for range safety

6. **features/spacing.js** - Layout Adjustments
   - Line height clamping: 1.2x - 2.2x
   - Paragraph spacing: 0.5x - 2.0x
   - Content padding: 0 - 48px
   - Max line width: 400px - 1200px minimum
   - All use CSS custom properties for efficiency

7. **features/keyboard.js** - Accessibility
   - Enter/Space opens panel
   - Escape closes panel
   - Tab trap prevents focus escape from panel
   - Focus management for keyboard-only users

8. **features/reader-mode.js** - Distraction-Free Reading
   - Extracts clean HTML from content roots
   - Removes scripts, styles, ads, sidebars, modals
   - Removes event handlers and inline styles
   - Calculates read time (words / 200 per minute)
   - Full-screen overlay with exit option
   - Smooth animations (fade in/out)

9. **features/focus-mode.js** - Content Isolation
   - Hides everything except content and widget
   - Preserves DOM structure (no deletion)
   - Reversible toggle state
   - Uses `data-ua-hidden` attributes for tracking

10. **features/night-mode.js** - Dark Theme
    - CSS filter-based invert (lightweight, fast)
    - Preserves images/videos via counter-filter
    - Toggleable with localStorage persistence
    - No reflow performance impact

11. **features/text-to-speech.js** - Audio Reading
    - Chunking algorithm (max 1800-2000 chars per utterance)
    - Smart sentence-break detection for chunk boundaries
    - Visual highlighting of spoken text with overlays
    - Text-map building for accurate position tracking
    - Pause/Resume/Stop controls
    - Speed adjustment (0.5x - 2.0x)

#### **UI Module**

12. **ua-widget.js** - Main Controller
    - Mounts floating widget button + panel
    - Initializes all feature modules
    - Wires control events to settings/engine
    - Manages state synchronization
    - Persists user preferences

---

## 🔄 Data Flow & State Management

```
┌─────────────────────────────────────────────────────────────┐
│                    User Interaction                          │
│           (Slider input, button clicks, etc.)               │
└────────────────────┬────────────────────────────────────────┘
                     │
                     ▼
         ┌───────────────────────┐
         │  wireControls()       │ (Event handlers)
         │  - Input listeners    │
         │  - Button handlers    │
         └───────────┬───────────┘
                     │
                     ▼
         ┌──────────────────────────┐
         │  setSettings() callback   │
         │  - Updates settings obj   │
         │  - Calls engine.apply()   │
         │  - Calls saveSettings()   │
         │  - Updates UI with syncUI │
         └───────────┬──────────────┘
                     │
         ┌───────────┴────────────┬──────────────┐
         │                        │              │
         ▼                        ▼              ▼
    ┌─────────────┐      ┌────────────────┐   ┌──────────────┐
    │ localStorage│      │ applySettings()│   │ syncUI()     │
    │ Persistence│      │ CSS Variables  │   │ UI Updates   │
    └─────────────┘      └────────────────┘   └──────────────┘
```

**Key States:**
- `settings` - Current user preferences object
- `engine.roots` - Array of detected content elements
- `localStorage` - Per-domain settings persistence
- `isReaderModeActive`, `isNightModeOn()` - Feature toggles
- `ttsIsSpeaking`, `ttsIsPaused` - TTS state

---

## 📝 Content Detection Algorithm

The extension uses a **two-stage content detection** system:

### Stage 1: Semantic Detection
Looks for semantic HTML elements:
- `<main>` tag
- `<article>` tag
- Elements with `role="main"`, `role="log"`, `aria-live`

### Stage 2: Scoring Algorithm
If semantic detection fails, it scores candidate elements:

```
Score = 
  + Text length bonus (0-40 points)
  + Paragraphs × 3
  + List items × 1.2
  + Headings × 2
  - Link density × 60 (penalizes link-heavy content)
  - Interactive elements × 2.5 (penalizes buttons, inputs)
  - Child element penalty if too many small children
  - Nav/header/footer penalty
```

### Stage 3: Chat Rescue
Special handling for conversation UIs:
- Detects chat transcripts using `[data-testid^='conversation-turn-']`
- Finds lowest common ancestor of message blocks
- Injects into scoring with priority score of 9998
- Searches open shadow DOMs for messages

### Excluded Elements
Navigation, footers, sidebars, ads, cookies, breadcrumbs are excluded via:
- CSS selectors (class/id patterns)
- Regex matching on class/id attributes
- Size validation (minimum 250×120 pixels visible)

---

## 🎨 Styling Architecture

### CSS Approach
The extension uses **CSS Custom Properties (CSS Variables)** for dynamic styling:

```css
.ua-content-root {
  --ua-font-scale: 1;
  --ua-line-height: 1.55;
  --ua-paragraph-spacing: 1;
  --ua-content-padding: 0px;
  --ua-max-line-width: none;
  --ua-font-family: inherit;
  
  font-size: calc(100% * var(--ua-font-scale));
  padding-left: var(--ua-content-padding);
}
```

**Benefits:**
- No DOM manipulation required
- Efficient variable cascading
- Supports `!important` for specificity
- Works with shadow DOM
- Minimal performance impact

### Scoped CSS
All accessibility styles are scoped to `.ua-content-root` to avoid conflicts with website CSS.

### Dark Mode Variables
Separate variable set for dark mode theme:
```css
#ua-widget-panel.ua-dark-mode {
  --ua-bg: rgba(30, 30, 46, 0.9);  /* Dark background */
  --ua-text: #f5f5f5;              /* Light text */
  --ua-accent: #818cf8;            /* Purple accent */
}
```

### Widget Styling
- **Glassmorphism design** with blur effects
- **Fixed positioning** (z-index: 2147483647 - max allowed)
- **Responsive layout** - adapts to viewport size
- **Smooth animations** - cubic-bezier easing
- **Dark mode support** - automatic based on system preference

---

## 🔐 Security & Privacy

### Manifest Permissions
```json
{
  "permissions": ["storage", "activeTab"],
  "manifest_version": 3
}
```

**Minimal Permissions:**
- `storage` - Only for localStorage (domain-specific data)
- `activeTab` - Access current tab (no other tabs)
- No network access
- No clipboard access
- No sensitive data collection

### Data Handling
- All settings stored **locally** (localStorage per domain)
- No data sent to external servers
- Settings are **per-domain** isolated
- User can clear anytime (Ctrl+Shift+Delete)

### Content Script Safety
- Runs only on `<all_urls>` with no exclusions
- Input validation on all user settings
- Safe HTML escaping in Reader Mode
- Event handler removal in cloned content
- XSS prevention via textContent instead of innerHTML

---

## 🚀 Performance Optimizations

### 1. **CSS Variables Over DOM Manipulation**
- Single style injection
- Variable updates = no reflow
- Cascading efficiency

### 2. **Lazy Module Loading**
- Features initialize only when needed
- Reader Mode styles inject on-demand
- TTS styles inject on first use

### 3. **Content Detection Caching**
- Roots stored in engine state
- `ensureValidRoots()` validates cache before use
- Refresh only when DOM detached

### 4. **Text-to-Speech Chunking**
- Long text split at sentence boundaries
- Prevents browser timeout on long utterances
- Batch highlighting with requestAnimationFrame

### 5. **Focus Mode Optimization**
- Hides via `display: none` (not removal)
- Stores previous display value for restore
- Single pass DOM traversal

### 6. **Shadow DOM Support**
- Shallow traversal (max depth 10)
- Open shadow DOM only (closed requires extension API)
- WeakSet for visited tracking

---

## 🎯 Use Cases & Workflows

### Use Case 1: Student with Dyslexia
1. Click **Enhance** button for one-click improvement
2. Adjust font to dyslexia-friendly option
3. Increase line height and paragraph spacing
4. Click **Reader Mode** for distraction-free reading

### Use Case 2: Visual Impairment
1. Maximize font size (up to 160%)
2. Increase line height for clarity
3. Use **Reader Mode** for cleaner layout
4. Activate **Text-to-Speech** for audio assistance

### Use Case 3: Late Night Browsing
1. Click **Night Mode** for dark theme
2. Activate **Dark Mode Panel** for UI
3. Adjust brightness via **Reduce Colors** if needed
4. Use **Focus Mode** to block distracting elements

### Use Case 4: Reading Long Articles
1. Enter **Reader Mode** for full-screen view
2. Use **Text-to-Speech** with **Page** button
3. Adjust speech speed as needed
4. Exit with Escape key or Exit button

---

## 🛠️ Technical Details

### Browser Compatibility
- **Chrome 88+** (Manifest V3 support)
- **Edge 88+** (Chromium-based)
- **Firefox** (with Manifest V2 adaptation)

### JavaScript Features Used
- ES6+ (Classes, Promises, Arrow Functions)
- DOM API (TreeWalker, getComputedStyle, createRange)
- Web Audio API (SpeechSynthesis)
- CSS Custom Properties (CSS Variables)
- LocalStorage API
- Event Delegation

### HTML Elements Generated
- Custom `<button>` elements for controls
- Custom `<section>` for widget panel
- Dynamic `<div>` overlays for TTS highlighting
- Custom `<style>` elements for injected CSS

### CSS Selectors Used
Complex selectors for targeting:
- `:is()` pseudo-class for selector lists
- Attribute selectors `[role="main"]`, `[aria-hidden]`
- Pseudo-classes `:not([disabled])`, `:hover`, `:active`
- Media queries `@media (max-width: 768px)`, `(prefers-color-scheme: dark)`

---

## 📊 Settings Structure

### User Settings Object
```javascript
{
  fontScale: 1.0,              // 0.85 - 1.6
  lineHeight: 1.55,            // 1.2 - 2.2
  paragraphSpacing: 1.0,       // 0.5 - 2.0
  contentPadding: 0,           // 0 - 48 (pixels)
  maxLineWidth: 0,             // 0 (none) or 400-1200 (pixels)
  fontFamily: "inherit"        // CSS font family string
}
```

### Feature Flags (localStorage)
- `ua-widget-dark-mode` - Dark mode UI toggle
- `ua-widget-night-mode` - Night mode filter toggle
- `ua-widget-reduce-colors` - Color reduction toggle
- `ua-widget-tts-rate` - Speech synthesis speed

### Storage Keys
- `ua_widget_settings_v1:{hostname}` - User settings per domain
- Example: `ua_widget_settings_v1:github.com`

---

## 🔍 Debug & Troubleshooting

### Console Debugging
Check browser console for:
- `[Reader Mode]` warnings if content detection fails
- TTS initialization errors
- DOM query failures in sandboxed content

### Testing Checklist
- ✅ Content detection on news sites
- ✅ Settings persistence across reloads
- ✅ Reader mode on articles
- ✅ TTS on different voices/browsers
- ✅ Night mode filter performance
- ✅ Focus mode with dynamic content
- ✅ Keyboard accessibility (Tab, Escape)

### Common Issues
1. **No content detected** → Page might be SPA; use Focus Mode + Reader Mode
2. **TTS not working** → Browser might not have voice synthesis
3. **Settings not saving** → Check localStorage quota
4. **Widget not visible** → Check z-index conflicts (widget uses max allowed)

---

## 📚 Dependencies

**Zero external dependencies** - The extension is completely self-contained:
- No jQuery
- No frameworks (React, Vue, etc.)
- No polyfills needed (Chrome 88+ is evergreen)
- Vanilla JavaScript + Web APIs only

This ensures:
- Fast loading (minimal bundle size)
- Maximum compatibility
- No supply chain vulnerabilities
- Easy maintenance

---

## 🎓 Code Quality

### Code Organization
- Comments with `// ` for inline clarity
- Section headers with `// ============` format
- Function names are descriptive
- Single responsibility principle

### Error Handling
- Try-catch blocks for risky operations
- Safe DOM queries (null checks)
- Graceful degradation (feature works even if subfeature fails)
- No uncaught exceptions in content script

### Naming Conventions
- `ua-` prefix for all IDs/classes (avoids conflicts)
- `tts` for text-to-speech functions
- `DEFAULT_*` constants in CAPS
- Camel case for variables/functions

---

## 🚦 Future Enhancement Ideas

1. **Dyslexia-Friendly Fonts**
   - Pre-download OpenDyslexic font
   - Local storage to avoid network requests

2. **Grammar & Syntax Highlighting**
   - Highlight adjectives, verbs differently
   - Color-coded parts of speech

3. **Custom Color Schemes**
   - User-defined color palettes
   - Accessibility presets (protanopia, deuteranopia, tritanopia)

4. **Bionic Reading**
   - Bold first letters of words
   - Reduce cognitive load

5. **Dictionary/Thesaurus**
   - Double-click to define words
   - Suggest synonyms

6. **Save to Cloud**
   - Sync settings across devices
   - Firebase/backend integration

7. **Statistics Dashboard**
   - Track reading habits
   - Most-used features

8. **Export/Import**
   - Share settings with others
   - Backup user preferences

---

## 📄 License & Attribution

This extension is built with accessibility as a core principle, following **WCAG 2.1 Level AA** standards.

---

## 📞 Support

For issues, feature requests, or accessibility concerns:
- Test in incognito mode first (no extensions conflict)
- Check settings are properly saved (DevTools > Application > LocalStorage)
- Clear cache if experiencing issues
- Report any websites where content isn't detected

