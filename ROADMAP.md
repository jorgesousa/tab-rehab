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

## Known limits

- **One Chrome profile at a time.** Chrome isolates profiles, so an extension in the "Work" profile can't see personal-profile windows. Today: install it in each profile (each keeps its own data). Incognito windows need "Allow in Incognito".

## Next

1. **Relapse alerts / anti-accumulation dynamics.** A gentle reminder when you pass a tab threshold you choose (e.g. 40): "You're collecting again. Quick Rehab session?" Related ideas:
   - Tab budget per window (soft limit: the badge changes colour and the nudge appears once, not every tab).
   - "One in, one out" mode: above the budget, opening a tab suggests parking the oldest one.
   - Trend nudge: "+25 tabs since Monday", using the daily health stats already stored.
   - End-of-day check-in: "You opened 38 tabs today; 20 are still open. Review?"
   - Streaks and weekly recap: days under budget, tabs closed or finished this week.
   - Quiet hours and a snooze for the nudges themselves, so it never nags.
2. **Page preview in the Rehab card.** Chrome can only capture the visible tab, so Tab Rehab would save a small thumbnail each time you view a tab and show "how it looked last time you saw it". Tabs not viewed since install fall back to the site's preview image (og:image) or favicon. Needs the broader "read page content" permission; thumbnails stay local and are capped and pruned.
3. **One view across all Chrome profiles.** Not possible with the extension alone. Best route: a small companion desktop app ("bridge") that each profile's extension talks to via Chrome native messaging. The app merges all profiles into one view (labelled Work / Personal) and sends actions back to the right profile. Data stays on the laptop. Alternative (read-only, not live): read Chrome's session files on disk.
4. **Auto-backup:** weekly export to Downloads, plus optional sync via chrome.storage.sync or Google Drive.
5. **Recovery (personal analytics)**, below.

## Recovery: personal analytics in the rehab spirit

**Decision: user-facing analytics only. No product analytics or telemetry. Nothing is sent anywhere.**

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
- **Adaptive relapse alerts** that use your own baseline ("15 above your usual") instead of a fixed number.

### Data (local only)

Daily aggregate counts (opened, closed, parked, snoozed, to-do, bookmarked, restored, undone), per-tab creation time while the tab is open, and domain counts for zombie tabs. No URL history. 90 days of daily counts plus all-time totals for milestones. Included in the JSON backup.

## Later ideas

1. Resurfacing digest: a monthly "here's what you parked" review so parked lists don't become a graveyard.
2. Context resurfacing: "you parked 3 tabs from this site, want them back?"
3. Local AI grouping by task, plus a one-line summary saved at close time (Chrome's built-in on-device model).
4. Auto-archive mode (Arc-style) as an opt-in.
5. AI roasts for the Hall of Shame: when Chrome's built-in on-device model (Gemini Nano, Prompt API) is available, write a personal roast for the podium tabs from the title ("Deep work in a shallow world", ignored 29 days → "Ironic, given the title."). Runs on the device, no network, no keys. Falls back silently to the category roasts when the model isn't there (other browsers, low disk, older machines).
6. Publish to the Chrome Web Store.

## Pitfalls to avoid

Data loss (fatal), selling the extension or ownership changes, sending URLs to the cloud, forced accounts, taking over the new-tab page, nagging (alerts must be rare and easy to silence), any telemetry, shaming language in Recovery.
