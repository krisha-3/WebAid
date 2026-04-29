# Content Scoring Algorithm

How the extension finds the "main content" on any webpage.

---

## The Problem

Every webpage has:
- **Wanted content**: Articles, product info, chat messages
- **Unwanted content**: Navigation, ads, footers, sidebars

The scorer must automatically figure out which is which — on *any* website.

---

## How It Works (Simple Version)

```
┌─────────────────┐
│   Page loads    │
└────────┬────────┘
         │
         ▼
┌─────────────────────────────────────┐
│  Step 1: Look for semantic tags     │
│                                     │
│  Check if page has:                 │
│    • <main>                         │
│    • <article>                      │
│    • [role="main"]                  │
│                                     │
│  If found → use it, done!           │
└────────┬────────────────────────────┘
         │ Not found
         ▼
┌─────────────────────────────────────┐
│  Step 2: Score all containers       │
│                                     │
│  Look at every <div>, <section>,    │
│  <article> and give it a score      │
│  based on its content               │
└────────┬────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────┐
│  Step 3: Pick the winner            │
│                                     │
│  Highest score wins!                │
│  Apply coverage check               │
└─────────────────────────────────────┘
```

---

## The Scoring Formula

### Good Signs (+ points)

| Signal | Points | Why |
|--------|--------|-----|
| More text | +0.2 per 200 chars (max 40) | Main content has lots of text |
| Paragraphs `<p>` | +3 each | Articles have paragraphs |
| List items `<li>` | +1.2 each | Lists are often content |
| Headings | +2 each | Articles have structure |

### Bad Signs (- points)

| Signal | Penalty | Why |
|--------|---------|-----|
| High link density | Up to -25 | Nav menus are link-heavy |
| Many buttons/inputs | Up to -20 | App shells have lots of controls |
| Card grid pattern | -10 | Navigation grids |
| Nav/sidebar in name | -10 | Obvious non-content |

---

## The Auto-Calibration Magic ✨

Here's the key insight: **what's "too many links" depends on the page**.

- On **Wikipedia**: Links are everywhere, even in content
- On **a blog**: Links are rare in content, common in nav
- On **a chat app**: Buttons are everywhere, even in content

### How We Handle This

1. **Collect data** from ALL candidates on the page
2. **Compute the median** (typical value) for each feature
3. **Only penalize outliers** — values much higher than typical

```
Example: Wikipedia Article

All candidates have ~30% link density (median = 0.30)
                                       
Content section:    35% links → z-score ≈ 0.5 → small penalty
Navigation sidebar: 85% links → z-score ≈ 5.5 → big penalty

Result: Content wins because it's "normal" for this page
```

---

## Feature Usefulness

Some features don't help on some pages:

| Page Type | Link Density | Interactive Count |
|-----------|--------------|-------------------|
| Blog | Very useful (separates nav from article) | Not useful |
| Wikipedia | Less useful (links everywhere) | Not useful |
| Chat App | Not useful | Less useful (buttons everywhere) |

The algorithm **automatically reduces weight** for features that don't vary much on the page.

```
If IQR (spread) is tiny → feature can't discriminate → reduce its weight
```

---

## Coverage Constraint

After picking a winner, we check:

```
coverage = winner's text length / largest candidate's text length
```

If coverage is **too low** (< 40%):
- Maybe we picked a subsection instead of the whole article
- Try the parent element
- Use parent if it covers significantly more text

---

## Flow Diagram

```
┌──────────────────────────────────────────────────────────────────┐
│                         SCORING FLOW                              │
└──────────────────────────────────────────────────────────────────┘

     ┌─────────────┐
     │  All <div>  │
     │  <section>  │
     │  <article>  │
     └──────┬──────┘
            │
            ▼
┌───────────────────────┐
│  PASS 1: Collect      │
│                       │
│  For each element:    │
│  • textLen            │
│  • paragraphs         │
│  • headings           │
│  • linkDensity        │
│  • interactiveDensity │
└───────────┬───────────┘
            │
            ▼
┌───────────────────────┐
│  PASS 2: Calibrate    │
│                       │
│  Across all elements: │
│  • median(linkDens)   │
│  • median(interDens)  │
│  • IQR for each       │
└───────────┬───────────┘
            │
            ▼
┌───────────────────────┐
│  PASS 3: Score        │
│                       │
│  For each element:    │
│  score = positives    │
│        - penalties    │
│                       │
│  Penalties use        │
│  z-scores from Pass 2 │
└───────────┬───────────┘
            │
            ▼
┌───────────────────────┐
│  Sort by score        │
│  Check coverage       │
│  Return winner        │
└───────────────────────┘
```

---

## Why This Works

| Website Type | Before (Hardcoded) | After (Auto-Calibrated) |
|--------------|-------------------|------------------------|
| **Wikipedia** | ❌ Over-penalized links in article | ✅ Links are normal, not penalized |
| **Chat Apps** | ❌ Over-penalized buttons in chat | ✅ Buttons are normal, not penalized |
| **E-commerce** | ❌ Card grids heavily penalized | ✅ Adapts to product layouts |
| **News Sites** | ✅ Worked | ✅ Still works |

---

## Key Functions in Code

| Function | Purpose |
|----------|---------|
| `findContentRoots()` | Main entry point |
| `pickBestFromSemantic()` | Try semantic tags first |
| `scoreCandidates()` | 3-pass scoring algorithm |
| `computeMedianIQR()` | Calculate robust statistics |
| `toZScore()` | Convert to relative penalty |
| `calcUsefulness()` | Scale weight by discriminative power |
| `applyChatRescue()` | Special handling for chat UIs |

---

## Summary

1. **Positive signals** reward content-like features (text, paragraphs, headings)
2. **Negative signals** penalize nav-like features (links, buttons)
3. **Auto-calibration** makes penalties relative to the page's own distribution
4. **Coverage check** ensures we don't pick a tiny subsection
5. **No hardcoded thresholds** that break on specific site types
