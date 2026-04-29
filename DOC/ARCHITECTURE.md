# UA Accessibility Widget - Architecture & Flow Documentation

## Table of Contents
1. [Project Overview](#project-overview)
2. [Directory Structure](#directory-structure)
3. [Module Descriptions](#module-descriptions)
4. [Architecture Diagram](#architecture-diagram)
5. [Class/Module UML Diagram](#classmodule-uml-diagram)
6. [Data Flow Diagram](#data-flow-diagram)
7. [Sequence Diagrams](#sequence-diagrams)
8. [State Machine Diagrams](#state-machine-diagrams)
9. [Algorithm Details](#algorithm-details)

---

## Project Overview

The **UA Accessibility Widget** is a drop-in accessibility toolkit that enhances web page readability. It automatically detects main content areas and applies transformations like font scaling, spacing adjustments, and color modifications without affecting the site's navigation, header, footer, or sidebar.

### Key Features
- 🔤 **Font Size Control** - Scale text from 85% to 160%
- 📏 **Line Spacing** - Adjust line height from 1.2 to 2.2
- 📄 **Paragraph Spacing** - Control vertical rhythm
- ↔️ **Side Padding** - Add horizontal padding (0-48px)
- 📐 **Max Line Width** - Limit content width for readability
- 🔠 **Font Family** - Switch between font presets
- 📖 **Reader Mode** - Distraction-free reading overlay
- 🎨 **Reduce Colors** - Simplified color palette for accessibility
- 🌙 **Dark Mode** - Widget panel dark theme
- ⌨️ **Keyboard Accessibility** - Full keyboard navigation support

---

## Directory Structure

```
demo/
├── ua-widget.js          # Main entry point - Widget UI & orchestration
├── ua-widget.css         # Widget styling (glassmorphism, dark mode)
│
├── core/                 # Core algorithms & infrastructure
│   ├── targeting.js      # Algorithm 1: Content root detection
│   ├── transform-engine.js # Algorithm 2: CSS variable transformations
│   └── storage.js        # LocalStorage persistence layer
│
├── features/             # Individual feature modules
│   ├── font-size.js      # Font scaling logic
│   ├── font-family.js    # Font preset definitions
│   ├── spacing.js        # Line height, padding, max-width logic
│   ├── keyboard.js       # Keyboard accessibility & focus trap
│   └── reader-mode.js    # Reader mode overlay feature
│
└── docs/                 # Documentation
    └── ARCHITECTURE.md   # This file
```

---

## Module Descriptions

### Core Modules

#### 1. `core/targeting.js` - Content Root Detection (Algorithm 1)
**Purpose:** Identifies the main reading content areas on a page.

| Export | Type | Description |
|--------|------|-------------|
| `DEFAULT_TARGETING_OPTIONS` | Object | Default configuration for targeting |
| `findContentRoots(options)` | Function | Returns array of content root elements |

**Internal Functions:**
- `pickBestFromSemantic(opt)` - Prioritizes semantic HTML landmarks
- `scoreCandidates(opt)` - Readability-style scoring for fallback
- `isEligibleContainer(el, opt)` - Validates container eligibility
- `getTextLen(el)` - Calculates text content length
- `getLinkTextLen(el)` - Calculates link text density

---

#### 2. `core/transform-engine.js` - Transformation Engine (Algorithm 2)
**Purpose:** Applies CSS variable-based transformations to content roots.

| Export | Type | Description |
|--------|------|-------------|
| `DEFAULT_SETTINGS` | Object | Default accessibility settings |
| `initTransformEngine(options)` | Function | Initializes engine, returns API object |
| `applySettingsToRoots(roots, settings)` | Function | Applies CSS variables to roots |

**Engine API:**
```javascript
{
  roots: Element[],           // Detected content roots
  apply(settings): void,      // Apply new settings
  reset(): void,              // Reset to defaults
  refreshRoots(): Element[]   // Re-detect roots (for SPAs)
}
```

---

#### 3. `core/storage.js` - Persistence Layer
**Purpose:** Handles localStorage-based settings persistence.

| Export | Type | Description |
|--------|------|-------------|
| `loadSettings(scopeKey)` | Function | Load saved settings for domain |
| `saveSettings(settings, scopeKey)` | Function | Save settings to localStorage |
| `clearSettings(scopeKey)` | Function | Clear saved settings |

---

### Feature Modules

#### 4. `features/font-size.js` - Font Size Control
| Export | Type | Description |
|--------|------|-------------|
| `clampFontScale(v)` | Function | Clamp value to 0.85-1.6 range |
| `nextFontScale(current, delta)` | Function | Calculate next font scale step |

---

#### 5. `features/font-family.js` - Font Family Presets
| Export | Type | Description |
|--------|------|-------------|
| `FONT_PRESETS` | Array | Available font presets |
| `resolveFontFamily(presetId)` | Function | Get CSS font-family value |

**Available Presets:**
- `inherit` - Website default
- `system` - System UI fonts
- `serif` - Serif fonts
- `dyslexia` - Dyslexia-friendly fonts

---

#### 6. `features/spacing.js` - Spacing Controls
| Export | Type | Description |
|--------|------|-------------|
| `clampLineHeight(v)` | Function | Clamp to 1.2-2.2 |
| `clampParagraphSpacing(v)` | Function | Clamp to 0.5-2.0em |
| `clampPaddingPx(v)` | Function | Clamp to 0-48px |
| `clampMaxLineWidthPx(v)` | Function | Clamp to 0 or 400-1200px |

---

#### 7. `features/keyboard.js` - Keyboard Accessibility
| Export | Type | Description |
|--------|------|-------------|
| `installKeyboardA11y(refs)` | Function | Install keyboard handlers |
| `openPanel(refs)` | Function | Open panel with focus management |
| `closePanel(refs)` | Function | Close panel, restore focus |

**Features:**
- Enter/Space opens panel from launcher
- Escape closes panel
- Tab focus trap within open panel
- Focus restoration on close

---

#### 8. `features/reader-mode.js` - Reader Mode
| Export | Type | Description |
|--------|------|-------------|
| `toggleReaderMode()` | Function | Toggle reader mode on/off |
| `isReaderActive()` | Function | Check if reader mode is active |

**Internal Functions:**
- `enterReaderMode()` - Creates overlay with extracted content
- `exitReaderMode()` - Removes overlay, restores scroll
- `extractReadableContent(roots)` - Extracts title, content, images
- `cleanClonedContent(el)` - Removes unwanted elements
- `createReaderOverlay(data)` - Builds overlay DOM
- `injectReaderStyles()` - Injects reader CSS

---

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              UA ACCESSIBILITY WIDGET                         │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │                         ua-widget.js (Entry Point)                   │    │
│  │                                                                      │    │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────────────────────┐  │    │
│  │  │  mountWidget │  │ wireControls │  │        syncUI            │  │    │
│  │  │   (Build UI) │  │ (Event bind) │  │  (UI ↔ State sync)       │  │    │
│  │  └──────────────┘  └──────────────┘  └──────────────────────────┘  │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
│                                    │                                         │
│              ┌─────────────────────┼─────────────────────┐                  │
│              │                     │                     │                  │
│              ▼                     ▼                     ▼                  │
│  ┌───────────────────┐  ┌───────────────────┐  ┌───────────────────┐       │
│  │   CORE MODULES    │  │  FEATURE MODULES  │  │    STYLING        │       │
│  ├───────────────────┤  ├───────────────────┤  ├───────────────────┤       │
│  │                   │  │                   │  │                   │       │
│  │  ┌─────────────┐  │  │  ┌─────────────┐  │  │  ua-widget.css    │       │
│  │  │ targeting.js│  │  │  │ font-size.js│  │  │                   │       │
│  │  │             │  │  │  │             │  │  │  • Glassmorphism  │       │
│  │  │ Algorithm 1 │  │  │  │ Scale logic │  │  │  • Dark mode      │       │
│  │  │ Find roots  │  │  │  └─────────────┘  │  │  • Animations     │       │
│  │  └─────────────┘  │  │                   │  │  • Reduce colors  │       │
│  │         │         │  │  ┌─────────────┐  │  │                   │       │
│  │         ▼         │  │  │font-family  │  │  └───────────────────┘       │
│  │  ┌─────────────┐  │  │  │     .js     │  │                              │
│  │  │ transform-  │  │  │  │             │  │                              │
│  │  │ engine.js   │  │  │  │ Font preset │  │                              │
│  │  │             │  │  │  └─────────────┘  │                              │
│  │  │ Algorithm 2 │  │  │                   │                              │
│  │  │ Apply CSS   │  │  │  ┌─────────────┐  │                              │
│  │  │ variables   │  │  │  │ spacing.js  │  │                              │
│  │  └─────────────┘  │  │  │             │  │                              │
│  │         │         │  │  │ Height/pad  │  │                              │
│  │         ▼         │  │  └─────────────┘  │                              │
│  │  ┌─────────────┐  │  │                   │                              │
│  │  │ storage.js  │  │  │  ┌─────────────┐  │                              │
│  │  │             │  │  │  │ keyboard.js │  │                              │
│  │  │ Persist to  │  │  │  │             │  │                              │
│  │  │ localStorage│  │  │  │ Focus trap  │  │                              │
│  │  └─────────────┘  │  │  └─────────────┘  │                              │
│  │                   │  │                   │                              │
│  └───────────────────┘  │  ┌─────────────┐  │                              │
│                         │  │reader-mode  │  │                              │
│                         │  │     .js     │  │                              │
│                         │  │             │  │                              │
│                         │  │ Clean view  │  │                              │
│                         │  └─────────────┘  │                              │
│                         │                   │                              │
│                         └───────────────────┘                              │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Class/Module UML Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                            MODULE DEPENDENCY GRAPH                           │
└─────────────────────────────────────────────────────────────────────────────┘

                              ┌───────────────────┐
                              │   ua-widget.js    │
                              │   <<Entry Point>> │
                              └─────────┬─────────┘
                                        │
           ┌────────────────────────────┼────────────────────────────┐
           │                            │                            │
           ▼                            ▼                            ▼
┌──────────────────┐         ┌──────────────────┐         ┌──────────────────┐
│ transform-engine │         │    storage.js    │         │   keyboard.js    │
│       .js        │         │   <<Utility>>    │         │   <<Feature>>    │
│   <<Core>>       │         └──────────────────┘         └──────────────────┘
└────────┬─────────┘
         │
         ▼
┌──────────────────┐     ┌──────────────────┐     ┌──────────────────┐
│   targeting.js   │     │   font-size.js   │     │  font-family.js  │
│     <<Core>>     │     │   <<Feature>>    │     │   <<Feature>>    │
└──────────────────┘     └────────┬─────────┘     └──────────────────┘
         ▲                        │
         │                        ▼
         │               ┌──────────────────┐
         │               │ transform-engine │
         │               │  <<imports>>     │
         │               └──────────────────┘
         │
┌────────┴─────────┐     ┌──────────────────┐
│  reader-mode.js  │     │    spacing.js    │
│   <<Feature>>    │     │   <<Feature>>    │
└──────────────────┘     └────────┬─────────┘
                                  │
                                  ▼
                         ┌──────────────────┐
                         │ transform-engine │
                         │  <<imports>>     │
                         └──────────────────┘


┌─────────────────────────────────────────────────────────────────────────────┐
│                              INTERFACE DEFINITIONS                           │
└─────────────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────┐
│         <<interface>>                   │
│         Settings                        │
├─────────────────────────────────────────┤
│ + fontScale: number        // 0.85-1.6  │
│ + lineHeight: number       // 1.2-2.2   │
│ + paragraphSpacing: number // 0.5-2.0   │
│ + contentPadding: number   // 0-48      │
│ + maxLineWidth: number     // 0, 400+   │
│ + fontFamily: string       // CSS value │
└─────────────────────────────────────────┘

┌─────────────────────────────────────────┐
│         <<interface>>                   │
│         TransformEngine                 │
├─────────────────────────────────────────┤
│ + roots: Element[]                      │
├─────────────────────────────────────────┤
│ + apply(settings: Settings): void       │
│ + reset(): void                         │
│ + refreshRoots(): Element[]             │
└─────────────────────────────────────────┘

┌─────────────────────────────────────────┐
│         <<interface>>                   │
│         TargetingOptions                │
├─────────────────────────────────────────┤
│ + semanticSelectors: string[]           │
│ + excludeSelectors: string[]            │
│ + excludeIdClassRegex: RegExp           │
│ + candidateSelectors: string[]          │
│ + minTextLength: number                 │
│ + minParagraphs: number                 │
│ + allowMultipleRoots: boolean           │
│ + multiRootScoreRatio: number           │
└─────────────────────────────────────────┘

┌─────────────────────────────────────────┐
│         <<interface>>                   │
│         FontPreset                      │
├─────────────────────────────────────────┤
│ + id: string                            │
│ + label: string                         │
│ + value: string                         │
└─────────────────────────────────────────┘
```

---

## Data Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              DATA FLOW DIAGRAM                               │
└─────────────────────────────────────────────────────────────────────────────┘

     ┌──────────┐
     │   USER   │
     └────┬─────┘
          │
          │ (1) Interacts with controls
          ▼
┌──────────────────┐
│  Widget UI       │
│  (ua-widget.js)  │
│                  │
│  • Sliders       │
│  • Buttons       │
│  • Dropdowns     │
└────────┬─────────┘
         │
         │ (2) User input triggers event
         ▼
┌──────────────────────────────────────────────────────────────┐
│                    EVENT HANDLERS                            │
│                                                              │
│  wireControls() → setSettings() → engine.apply() → syncUI()  │
│                                                              │
└───────────┬───────────────────────────────────────┬──────────┘
            │                                       │
            ▼                                       ▼
┌───────────────────────┐             ┌───────────────────────┐
│     Settings Object   │             │   Transform Engine    │
│                       │             │                       │
│  {                    │   (3)       │  applySettingsToRoots │
│    fontScale: 1.2,    │ ─────────▶  │         │            │
│    lineHeight: 1.8,   │             │         ▼             │
│    ...                │             │  Set CSS Variables    │
│  }                    │             │  on .ua-content-root  │
│                       │             │                       │
└───────────┬───────────┘             └───────────────────────┘
            │                                       │
            │ (4) Persist                           │ (5) Browser renders
            ▼                                       ▼
┌───────────────────────┐             ┌───────────────────────┐
│     localStorage      │             │    Content Roots      │
│                       │             │                       │
│  ua_widget_settings_  │             │  <main>               │
│  v1:localhost         │             │    <article>          │
│                       │             │      (styled content) │
│  JSON string          │             │    </article>         │
│                       │             │  </main>              │
└───────────────────────┘             └───────────────────────┘
```

---

## Sequence Diagrams

### Initialization Sequence

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                       INITIALIZATION SEQUENCE DIAGRAM                         │
└──────────────────────────────────────────────────────────────────────────────┘

     ┌────────┐  ┌────────────┐  ┌──────────────┐  ┌──────────┐  ┌─────────┐
     │ Browser│  │ua-widget.js│  │transform-eng │  │targeting │  │ storage │
     └───┬────┘  └─────┬──────┘  └──────┬───────┘  └────┬─────┘  └────┬────┘
         │             │                │               │             │
         │  DOM Ready  │                │               │             │
         │────────────▶│                │               │             │
         │             │                │               │             │
         │             │ initTransformEngine()          │             │
         │             │───────────────▶│               │             │
         │             │                │               │             │
         │             │                │ findContentRoots()          │
         │             │                │──────────────▶│             │
         │             │                │               │             │
         │             │                │   Element[]   │             │
         │             │                │◀──────────────│             │
         │             │                │               │             │
         │             │                │ injectStylesheetOnce()      │
         │             │                │──────┐        │             │
         │             │                │      │        │             │
         │             │                │◀─────┘        │             │
         │             │                │               │             │
         │             │   engine API   │               │             │
         │             │◀───────────────│               │             │
         │             │                │               │             │
         │             │ loadSettings() │               │             │
         │             │───────────────────────────────────────────▶ │
         │             │                │               │             │
         │             │   settings     │               │             │
         │             │◀───────────────────────────────────────────  │
         │             │                │               │             │
         │             │ engine.apply(settings)         │             │
         │             │───────────────▶│               │             │
         │             │                │               │             │
         │             │ mountWidget()  │               │             │
         │             │──────┐         │               │             │
         │             │      │ Build UI│               │             │
         │             │◀─────┘         │               │             │
         │             │                │               │             │
         │             │ wireControls() │               │             │
         │             │──────┐         │               │             │
         │             │      │ Bind events             │             │
         │             │◀─────┘         │               │             │
         │             │                │               │             │
         │   Render    │                │               │             │
         │◀────────────│                │               │             │
         │             │                │               │             │
     ┌───┴────┐  ┌─────┴──────┐  ┌──────┴───────┐  ┌────┴─────┐  ┌────┴────┐
     │ Browser│  │ua-widget.js│  │transform-eng │  │targeting │  │ storage │
     └────────┘  └────────────┘  └──────────────┘  └──────────┘  └─────────┘
```

### User Interaction Sequence (Font Size Change)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                    USER INTERACTION SEQUENCE: FONT SIZE                       │
└──────────────────────────────────────────────────────────────────────────────┘

  ┌──────┐  ┌────────────┐  ┌────────────┐  ┌──────────────┐  ┌─────────┐
  │ User │  │ UI Slider  │  │ua-widget.js│  │transform-eng │  │ storage │
  └──┬───┘  └─────┬──────┘  └─────┬──────┘  └──────┬───────┘  └────┬────┘
     │            │               │                │               │
     │ Drag slider│               │                │               │
     │───────────▶│               │                │               │
     │            │               │                │               │
     │            │ input event   │                │               │
     │            │──────────────▶│                │               │
     │            │               │                │               │
     │            │               │ clampFontScale(value)          │
     │            │               │──────┐         │               │
     │            │               │      │         │               │
     │            │               │◀─────┘         │               │
     │            │               │                │               │
     │            │               │ setSettings({fontScale})       │
     │            │               │──────┐         │               │
     │            │               │      │         │               │
     │            │               │◀─────┘         │               │
     │            │               │                │               │
     │            │               │ engine.apply(settings)         │
     │            │               │───────────────▶│               │
     │            │               │                │               │
     │            │               │                │ Set CSS var   │
     │            │               │                │──────┐        │
     │            │               │                │      │        │
     │            │               │                │◀─────┘        │
     │            │               │                │               │
     │            │               │ saveSettings(settings)         │
     │            │               │────────────────────────────────▶
     │            │               │                │               │
     │            │               │ syncUI()       │               │
     │            │               │──────┐         │               │
     │            │               │      │         │               │
     │            │               │◀─────┘         │               │
     │            │               │                │               │
     │            │ updateValueIndicator()         │               │
     │            │◀──────────────│                │               │
     │            │               │                │               │
     │  See text  │               │                │               │
     │  change    │               │                │               │
     │◀───────────│               │                │               │
     │            │               │                │               │
  ┌──┴───┐  ┌─────┴──────┐  ┌─────┴──────┐  ┌──────┴───────┐  ┌────┴────┐
  │ User │  │ UI Slider  │  │ua-widget.js│  │transform-eng │  │ storage │
  └──────┘  └────────────┘  └────────────┘  └──────────────┘  └─────────┘
```

### Reader Mode Sequence

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                       READER MODE ACTIVATION SEQUENCE                         │
└──────────────────────────────────────────────────────────────────────────────┘

  ┌──────┐  ┌────────────┐  ┌──────────────┐  ┌──────────┐  ┌─────────────┐
  │ User │  │ua-widget.js│  │reader-mode.js│  │targeting │  │     DOM     │
  └──┬───┘  └─────┬──────┘  └──────┬───────┘  └────┬─────┘  └──────┬──────┘
     │            │                │               │               │
     │ Click Reader               │               │               │
     │───────────▶│                │               │               │
     │            │                │               │               │
     │            │ toggleReaderMode()             │               │
     │            │───────────────▶│               │               │
     │            │                │               │               │
     │            │                │ findContentRoots()            │
     │            │                │──────────────▶│               │
     │            │                │               │               │
     │            │                │   Element[]   │               │
     │            │                │◀──────────────│               │
     │            │                │               │               │
     │            │                │ extractReadableContent()      │
     │            │                │──────┐        │               │
     │            │                │      │        │               │
     │            │                │◀─────┘        │               │
     │            │                │               │               │
     │            │                │ createReaderOverlay()         │
     │            │                │──────┐        │               │
     │            │                │      │        │               │
     │            │                │◀─────┘        │               │
     │            │                │               │               │
     │            │                │ appendChild(overlay)          │
     │            │                │──────────────────────────────▶│
     │            │                │               │               │
     │            │   isActive     │               │               │
     │            │◀───────────────│               │               │
     │            │                │               │               │
     │            │ Update button text             │               │
     │            │──────┐         │               │               │
     │            │◀─────┘         │               │               │
     │            │                │               │               │
     │ See reader │                │               │               │
     │   overlay  │                │               │               │
     │◀───────────│                │               │               │
     │            │                │               │               │
  ┌──┴───┐  ┌─────┴──────┐  ┌──────┴───────┐  ┌────┴─────┐  ┌──────┴──────┐
  │ User │  │ua-widget.js│  │reader-mode.js│  │targeting │  │     DOM     │
  └──────┘  └────────────┘  └──────────────┘  └──────────┘  └─────────────┘
```

---

## State Machine Diagrams

### Widget Panel State

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        WIDGET PANEL STATE MACHINE                            │
└─────────────────────────────────────────────────────────────────────────────┘

                            ┌─────────────────┐
                            │                 │
                     ┌──────│    HIDDEN       │◀─────────────────────┐
                     │      │   (Initial)     │                      │
                     │      └────────┬────────┘                      │
                     │               │                               │
                     │               │ Click launcher /              │
                     │               │ Enter/Space on launcher       │
                     │               ▼                               │
                     │      ┌─────────────────┐                      │
                     │      │                 │    Click close /     │
                     └──────│    VISIBLE      │────Escape key        │
       Click launcher       │                 │                      │
                            └────────┬────────┘                      │
                                     │                               │
                                     │                               │
                     ┌───────────────┼───────────────┐               │
                     │               │               │               │
                     ▼               ▼               ▼               │
              ┌────────────┐  ┌────────────┐  ┌────────────┐         │
              │   LIGHT    │  │    DARK    │  │  REDUCED   │         │
              │    MODE    │  │    MODE    │  │   COLORS   │         │
              └─────┬──────┘  └─────┬──────┘  └─────┬──────┘         │
                    │               │               │                │
                    │◀─────────────▶│               │                │
                    │  Toggle 🌙    │               │                │
                    │               │               │                │
                    └───────────────┴───────────────┘                │
                                     │                               │
                                     │ Close panel                   │
                                     └───────────────────────────────┘
```

### Reader Mode State

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        READER MODE STATE MACHINE                             │
└─────────────────────────────────────────────────────────────────────────────┘

                     ┌─────────────────────────────────┐
                     │                                 │
                     ▼                                 │
              ┌────────────┐                           │
              │            │                           │
              │  INACTIVE  │                           │
              │            │                           │
              └─────┬──────┘                           │
                    │                                  │
                    │ toggleReaderMode()               │
                    │ when inactive                    │
                    │                                  │
                    │  ┌─────────────────────────┐     │
                    │  │ enterReaderMode():      │     │
                    │  │ 1. Find content roots   │     │
                    │  │ 2. Extract content      │     │
                    │  │ 3. Save scroll pos      │     │
                    │  │ 4. Create overlay       │     │
                    │  │ 5. Inject styles        │     │
                    │  └─────────────────────────┘     │
                    │                                  │
                    ▼                                  │
              ┌────────────┐                           │
              │            │                           │
              │   ACTIVE   │───────────────────────────┘
              │            │   toggleReaderMode()
              └────────────┘   OR Close button
                               OR Escape key
                    │
                    │  ┌─────────────────────────┐
                    │  │ exitReaderMode():       │
                    │  │ 1. Remove overlay       │
                    │  │ 2. Restore scroll pos   │
                    │  │ 3. Update button        │
                    │  └─────────────────────────┘
                    │
                    ▼
              ┌────────────┐
              │            │
              │  INACTIVE  │
              │            │
              └────────────┘
```

### Reduce Colors State

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                      REDUCE COLORS STATE MACHINE                             │
└─────────────────────────────────────────────────────────────────────────────┘

                     ┌─────────────────────────────────┐
                     │                                 │
                     ▼                                 │
              ┌────────────────┐                       │
              │                │                       │
              │  NORMAL COLORS │                       │
              │  (Default)     │                       │
              │                │                       │
              │  • Full page   │                       │
              │    colors      │                       │
              │  • Normal      │                       │
              │    scrollbar   │                       │
              └───────┬────────┘                       │
                      │                                │
                      │ Click "🎨 Reduce Colors"       │
                      │                                │
                      ▼                                │
              ┌────────────────┐                       │
              │                │                       │
              │ REDUCED COLORS │───────────────────────┘
              │                │  Click "🎨 Normal Colors"
              │  • #FAFAFA bg  │
              │  • #333333 txt │
              │  • #0056b3 links
              │  • #E0E0E0 border
              │  • Gray scrollbar
              └────────────────┘

              State persisted to localStorage
```

---

## Algorithm Details

### Algorithm 1: Content Root Targeting (Auto-Calibrated)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│              ALGORITHM 1: CONTENT ROOT TARGETING (AUTO-CALIBRATED)           │
└─────────────────────────────────────────────────────────────────────────────┘

  START
    │
    ▼
  ┌─────────────────────────────────┐
  │ Step 1: Try Semantic Landmarks  │
  │                                 │
  │ Search for:                     │
  │   • <main>                      │
  │   • <article>                   │
  │   • [role="main"]               │
  │   • [role="log"] (chat UIs)     │
  └────────────────┬────────────────┘
                   │
                   ▼
            ┌──────────────┐
            │ Found valid  │───── YES ──▶ RETURN semantic roots
            │ semantic?    │
            └──────┬───────┘
                   │ NO
                   ▼
  ┌─────────────────────────────────┐
  │ Step 2: Collect Raw Features    │
  │ (Pass 1)                        │
  │                                 │
  │ For each candidate element:     │
  │   • textLen, pCount, liCount    │
  │   • headingCount                │
  │   • linkDensity = linkText/text │
  │   • interactiveDensity          │
  │     = count / (textLen/1000+1)  │
  │   • paragraphDensity            │
  │     = pCount / (textLen/1000+1) │
  └────────────────┬────────────────┘
                   │
                   ▼
  ┌─────────────────────────────────┐
  │ Step 3: Compute Page Baselines  │
  │ (Pass 2)                        │
  │                                 │
  │ For linkDensity & interactive-  │
  │ Density, compute:               │
  │   • median (robust center)      │
  │   • IQR (spread measure)        │
  │                                 │
  │ Feature usefulness:             │
  │   usefulness = IQR / targetRange│
  │   (clamped to 0.15–1.0)         │
  └────────────────┬────────────────┘
                   │
                   ▼
  ┌─────────────────────────────────┐
  │ Step 4: Auto-Calibrated Scoring │
  │ (Pass 3)                        │
  │                                 │
  │ Positive signals (unchanged):   │
  │   + Text length (saturates@40)  │
  │   + Paragraph count × 3         │
  │   + List items × 1.2            │
  │   + Headings × 2                │
  │                                 │
  │ CALIBRATED penalties:           │
  │   z = (value - median) / IQR    │
  │   if z > 0 (above typical):     │
  │     - linkZ × 15 × usefulness   │
  │       (max: 25)                 │
  │     - interactiveZ × 10 × use-  │
  │       fulness (max: 20)         │
  │   - Card grid penalty: -10      │
  │   - Excluded id/class: -10      │
  └────────────────┬────────────────┘
                   │
                   ▼
  ┌─────────────────────────────────┐
  │ Step 5: Coverage Constraint     │
  │                                 │
  │ coverage = winnerText/maxText   │
  │                                 │
  │ If coverage < 0.4:              │
  │   Try parent element            │
  │   Use if parentCoverage > 1.3×  │
  └────────────────┬────────────────┘
                   │
                   ▼
            ┌──────────────┐
            │ allowMultiple│───── NO ──▶ RETURN [best]
            │    Roots?    │
            └──────┬───────┘
                   │ YES
                   ▼
  ┌─────────────────────────────────┐
  │ Step 6: Multi-root Selection    │
  │                                 │
  │ Include roots where:            │
  │   score ≥ bestScore × 0.82      │
  │   AND not nested in best        │
  │   AND best not nested in it     │
  └────────────────┬────────────────┘
                   │
                   ▼
             RETURN roots[]
```

### Algorithm 2: CSS Variable Transformation

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                   ALGORITHM 2: CSS VARIABLE TRANSFORMATION                   │
└─────────────────────────────────────────────────────────────────────────────┘

  START with settings object
    │
    ▼
  ┌─────────────────────────────────┐
  │ Step 1: Inject Global Stylesheet│
  │         (once)                  │
  │                                 │
  │ Creates <style> with rules for: │
  │   .ua-content-root              │
  │      font-size: calc(100% ×     │
  │        var(--ua-font-scale))    │
  │      padding-left/right         │
  │      max-width                  │
  │      font-family                │
  │                                 │
  │   .ua-content-root :is(p,li...) │
  │      line-height                │
  │                                 │
  │   .ua-content-root p            │
  │      margin-top/bottom          │
  └────────────────┬────────────────┘
                   │
                   ▼
  ┌─────────────────────────────────┐
  │ Step 2: For Each Content Root   │
  │                                 │
  │ Set CSS custom properties:      │
  │                                 │
  │ root.style.setProperty(         │
  │   '--ua-font-scale',            │
  │   settings.fontScale            │
  │ )                               │
  │                                 │
  │ root.style.setProperty(         │
  │   '--ua-line-height',           │
  │   settings.lineHeight           │
  │ )                               │
  │                                 │
  │ ... (all 6 properties)          │
  └────────────────┬────────────────┘
                   │
                   ▼
  ┌─────────────────────────────────┐
  │ Step 3: Browser Applies Styles  │
  │                                 │
  │ CSS cascade automatically       │
  │ applies changes to all          │
  │ descendants of .ua-content-root │
  │                                 │
  │ Benefits:                       │
  │ • Minimal DOM mutations         │
  │ • Fully reversible              │
  │ • Respects site CSS             │
  └─────────────────────────────────┘
                   │
                   ▼
                 DONE
```

---

## CSS Variables Reference

| Variable | Default | Range | Applied To |
|----------|---------|-------|------------|
| `--ua-font-scale` | 1 | 0.85 - 1.6 | Root font-size |
| `--ua-line-height` | 1.55 | 1.2 - 2.2 | p, li, dd, dt, blockquote, figcaption, td, th |
| `--ua-paragraph-spacing` | 1 | 0.5 - 2.0 | p, ul, ol margins |
| `--ua-content-padding` | 0px | 0 - 48px | Root padding-left/right |
| `--ua-max-line-width` | none | none / 400-1200px | Root max-width |
| `--ua-font-family` | inherit | CSS font-family | Root and descendants |

---

## localStorage Keys

| Key | Description |
|-----|-------------|
| `ua_widget_settings_v1:{hostname}` | Accessibility settings JSON |
| `ua-widget-dark-mode` | Widget dark mode boolean |
| `ua-widget-reduce-colors` | Reduce colors mode boolean |
| `ua-reader-mode-active` | Reader mode state |

---

## Browser Compatibility

- ✅ Chrome 80+
- ✅ Firefox 75+
- ✅ Safari 13.1+
- ✅ Edge 80+

**Required Features:**
- ES6 Modules
- CSS Custom Properties
- `backdrop-filter` (for glassmorphism, graceful fallback)
- `localStorage`

---

*Documentation generated: December 2024*
*Version: 1.0.0*
