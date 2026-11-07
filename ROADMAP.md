# Tab Rehab: research and roadmap

_Nov 2026. The market notes come from desk research and need checking against live sources._

## Core insight

People hoard tabs out of **fear of loss** and because **tabs act as a hidden to-do list**, not because of memory or clutter (Chang et al., CHI 2021, "When the Tab Comes Due", https://doi.org/10.1145/3411764.3445585). Tools that only group or suspend tabs leave that fear in place.

## Landscape (short)

| Tool | Approach | Weakness |
|---|---|---|
| OneTab | Dump all tabs into a list | Lists stored only on your device, reports of lost lists; becomes a graveyard |
| Session Buddy | Session backup and restore | Backup tool, not a cure; v4 redesign backlash |
| Workona / Toby / Partizion | Workspaces and collections | Heavy setup, account, paywall, takes over the new-tab page |
| Tab Wrangler | Auto-close idle tabs | Feels like surprise loss; only a timer |
| Great Suspender and successors | Suspend to save memory | Treats the symptom; Great Suspender malware (2021) |
| Chrome, Edge, Firefox native | Groups, AI "organize", sleeping tabs | Grouping is now free and common; no triage, no tasks |
| Arc / Safari | Auto-archive / auto-close | Requires switching browsers |

## Built

**v0.1:** dashboard of all tabs (search, by site or window), Rehab session triage, Stale view, Quick wins (duplicates and junk), Park lists, Snooze (auto-reopen), tab-to-to-do with reminders, Undo plus "Recently closed" safety net, badge tab count, daily stale nudge, health trend, right-click menu, JSON backup. Local only, minimal permissions.

**v0.2:**
- **Bookmarks:** save a tab, group, selection or parked list into a bookmarks folder of your choice (default "Tab Rehab"), optionally in a subfolder, optionally closing the tabs. Key **B** in Rehab sessions. Skips URLs already in that folder.
- **Safety:** confirmation before parking more than 10 tabs; Undo stays on screen for 15 seconds.
- **Restore to original windows:** parked, snoozed and closed tabs remember their window and position. If that window is gone or Chrome has restarted, they open together in a new window.

**v0.3** (submitted to the Chrome Web Store on 7 Nov 2026, in review):
- **Recovery view:** "Am I getting better?" (where you started vs today, streak of days under budget, 60-day chart) and "Was it safe to let go?" (tabs let go vs needed back). Daily counters live in the background worker, local only.
- **Tab budget:** the badge is green at or under your budget, amber above it, red at twice or more.
- Store listing, privacy policy page, screenshots and promo tiles (`store/`).

**v0.4** (built, ships after v0.3 is approved):
- **Relapse alerts** against **your best** (the lowest 14-day median of your daily lows, which only ever goes down), never against your "usual", so hoarding never becomes the new normal. Fires only when climbing past max(best + 15, budget + 1), at most once a day plus one "Later today" retry. Quiet hours, all-weekend quiet, pause, preview.
- **Recovery cards 3 and 5:** "Did I do the things I kept tabs open for?" (to-dos done and overdue) and "What's still hiding?" (parked graveyard older than 30 days: Let them go, or Save as bookmarks first).
- **Hall of Shame** at the top of Stale: the 5 longest-ignored tabs, ranked, each with a roast by category (courses, shopping, travel, video, docs, articles). Read it, Park or Let it go; dethroning #1 gets a toast.
- **Window roast:** a banner from 4 windows ("floor plan") and 7 ("neighbourhood") with "Merge into one window", per-window tags (lonely window, forgotten for a week), and a Lonely windows section in Quick wins. All undoable.
- **Recently closed** as its own view, grouped by day.
- **Tab-strip right-click menu:** Park, Turn into to-dos, Snooze until tomorrow 9:00, for one tab or every highlighted tab (Chrome 150+).
- **Settings view** (relapse alerts, tidying, export and import), Recovery reached from the health card in the sidebar, "What's new" banner after updates, sticky header shadow.

## Known limits

- **One Chrome profile at a time.** Chrome isolates profiles, so an extension in the "Work" profile can't see personal-profile windows. Today: install it in each profile (each keeps its own data). Incognito windows need "Allow in Incognito".

## Next

1. **Page preview in the Rehab card.** Chrome can only capture the visible tab, so Tab Rehab would save a small thumbnail each time you view a tab and show "how it looked last time you saw it". Tabs not viewed since install fall back to the site's preview image (og:image) or favicon. Needs the broader "read page content" permission; thumbnails stay local and are capped and pruned.
2. **One view across all Chrome profiles.** Not possible with the extension alone. Best route: a small companion desktop app ("bridge") that each profile's extension talks to via Chrome native messaging. The app merges all profiles into one view (labelled Work / Personal) and sends actions back to the right profile. Data stays on the laptop. Alternative (read-only, not live): read Chrome's session files on disk.
3. **Auto-backup:** weekly export to Downloads, plus optional sync via chrome.storage.sync or Google Drive.
4. **The rest of Recovery:** question 4 (triggers), milestones, and the weekly check-in (below).
5. **More anti-accumulation ideas:** trend nudge ("+25 tabs since Monday"), end-of-day check-in, "one in, one out" mode above the budget.

## Recovery: personal analytics in the rehab spirit

**Decision: user-facing analytics only. No product analytics or telemetry. Nothing is sent anywhere.**

**Status:** questions 1, 2, 3 and 5 are built (1 and 2 in v0.3, 3 and 5 in v0.4). Question 4, milestones and the weekly check-in are still to do.

Not a metrics dashboard but a *recovery journal* that answers the questions a tab hoarder actually has, in the app's voice. Every insight is kind (relapse is normal, no shaming) and ends with **one action**.

### The five questions it answers

1. **"Am I getting better?" Your recovery line.** Today vs where you started ("You started at 347. Today: 41."), plus a sobriety-style streak of days under your budget. A relapse resets the streak but never erases the record. Action: "Start a Rehab session".
2. **"Was it safe to let go?" Proof against the fear of loss.** "You've let go of 812 tabs. You needed 6 of them back." Counts every close, park, snooze and bookmark against the restores and undos. The most important number in the app. Action: "Lower your stale limit to 5 days?"
3. **"Did I do the things I kept tabs open for?" Promises kept.** "23 tabs became to-dos. 17 done, 4 overdue." Snoozed tabs that came back and got closed straight away ("you didn't really need it"). Action: "Review 4 overdue to-dos".
4. **"Where does my hoard come from?" Your triggers.** The sites and moments that create tabs that never get closed: "Most of your zombie tabs come from docs.google.com, opened Monday mornings." Domain level only, computed locally. Action: "Set a Monday-afternoon check-in?"
5. **"What's still hiding?" Graveyard check.** "120 parked tabs are older than 30 days. You've reopened 3% of parked tabs." Action: "Let them go" (with "Save as bookmarks first" as an option).

### Milestones (gentle, not gamey)

First Rehab session, first week under budget, 100 / 1,000 tabs let go, zero zombie tabs, inbox-zero for to-dos. Shown as quiet chips in Recovery, never as pop-ups.

### Where it lives

- A **Recovery** view in the dashboard: the five answers as cards, with inline SVG charts and no libraries.
- A **weekly check-in** (like a sponsor meeting): one notification, opening a 3-card summary.
- **Relapse alerts** (built in v0.4) that use your own best instead of a fixed number. An earlier "your usual" baseline was dropped: with 400 tabs for a week, 400 would have become normal.

### Data (local only)

Daily aggregate counts (opened, closed, parked, snoozed, to-do, bookmarked, restored, undone), per-tab creation time while the tab is open, and domain counts for zombie tabs. No URL history. 90 days of daily counts plus all-time totals for milestones. Included in the JSON backup.

## Later ideas

1. Resurfacing digest: a monthly "here's what you parked" review so parked lists don't become a graveyard.
2. Context resurfacing: "you parked 3 tabs from this site, want them back?"
3. Local AI grouping by task, plus a one-line summary saved at close time (Chrome's built-in on-device model).
4. Auto-archive mode (Arc-style) as an opt-in.
5. AI roasts for the Hall of Shame: when Chrome's built-in on-device model (Gemini Nano, Prompt API) is available, write a personal roast for the podium tabs from the title ("Deep work in a shallow world", ignored 29 days → "Ironic, given the title."). Runs on the device, no network, no keys. Falls back silently to the category roasts when the model isn't there (other browsers, low disk, older machines).

## Pitfalls to avoid

Data loss (fatal), selling the extension or ownership changes, sending URLs to the cloud, forced accounts, taking over the new-tab page, nagging (alerts must be rare and easy to silence), any telemetry, shaming language in Recovery.
