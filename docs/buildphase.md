# Build Phases

Ten passes. Each ends with something you can open and use. Do not start the next until the last one is genuinely usable.

Order is risk-first: the parts that might not work get built before the parts that definitely will. Phases 1 to 4 are testable alone. You do not need a second person until phase 6.

---

## Phase 1: whiteboard shell, solo

**Build**
- One page, one hardcoded prompt
- Excalidraw canvas, embedded
- Session countdown, prompt collapsed to one line and expandable
- Start and end a session

No login, no database, no AI.

**Looks like**
You open the page, hit start, and you are sketching against a clock.

**Done when**
You have run it twice yourself and it feels like a real round.

---

## Phase 2: hidden brief

**Build**
- One prompt written properly, with a background document the app knows and you do not
- Text input for clarifying questions
- AI answers only from that document and stays silent otherwise
- Track which facts get revealed

**Looks like**
You ask who the users are and it tells you. You never ask about the budget constraint, so you never find out.

**Done when**
Asking good questions feels rewarding. This is the mechanic the product rests on.

---

## Phase 3: post-session evaluation

**Build**
- Record voice, transcribe it
- Canvas snapshots on an interval
- One AI call after the session produces a report: facts found and missed, how the problem was framed, time on the board versus talking, one rewritten moment

**Looks like**
Session ends, short wait, report page.

**Done when**
You read your own report and it tells you something you could not have told yourself.

---

## Phase 4: prompt library

**Build**
- Several prompts, each with its own hidden brief, fact list, curveball and interviewer notes
- Prompt picker before a session
- All of it in config files, not hardcoded in components

**Looks like**
Pick a prompt, run a session, get a report. The solo product is now complete.

**Done when**
You can run three different sessions back to back without touching code.

---

## Phase 5: interview room shell

**Build**
- The real layout, still solo
- Candidate view: full width video area, two square cards at the bottom for Whiteboard and Notes, countdown overlay
- Whiteboard opens automatically at session start, video shrinks to tiles. The card toggles back to full video.
- Notes is a private scratchpad
- Interviewer view: 70 percent main area, 30 percent rail with Prompt and Evaluation tabs

**Looks like**
Both real screens, with you playing both sides.

**Done when**
The layout works before you add the complexity of a second human.

---

## Phase 6: real-time peer session

**Build**
- One person creates a room, sends a link, the other joins. No matching yet.
- Video for two
- Shared canvas with both cursors visible
- Roles: candidate and interviewer, swap and run round two

**Looks like**
Two faces, one shared board, the same countdown.

**Done when**
You have run a real session with a designer friend. Most of your bugs live here.

---

## Phase 7: AI interviewer copilot

**Build**
- Cards popping over the rail regardless of which tab is open, dismissible
- Suggested questions, fact cards, curveball card at its moment
- Facts mark as revealed once used
- Scorecard in the Evaluation tab, filled in during the session
- Peer scores feed the report alongside the AI's, shown separately

**Looks like**
The interviewer never wonders what to say next.

**Done when**
Someone who has never interviewed anyone can run a decent round.

---

## Phase 8: profiles and history

**Build**
- Email login
- Years of experience and level
- Every session saved, dashboard listing past sessions with scores
- Click into any session for its report and canvas

**Looks like**
Your sessions, in order, with progress visible across them.

---

## Phase 9: scheduling

**Build**
- Recurring availability blocks
- Fixed session slots
- Booking that covers both rounds as one session
- Reminders and a confirm-you're-coming click a couple of hours before
- No-show tracking

**Looks like**
Pick a slot, get an email, show up.

---

## Phase 10: matching, then polish

**Build**
- Session cards to browse: time, prompt area, experience level. Never names or photos.
- Level matching
- Fallback: if the peer does not show, the room becomes a solo AI session with the same prompt
- Then run the whole loop end to end and fix what breaks

**Done when**
Two strangers complete a session neither of you arranged by hand.

---

## Working with Cursor

- One branch per phase, named like `phase-1-whiteboard-shell`.
- Tell it the phase and say explicitly not to build ahead, or it will scaffold auth and matching during phase 1.
- Keep this file in `docs/` and let the rules file point at it, so Cursor stops re-deciding architecture.
- Ask for the smallest working version first, then refine. It over-builds when handed a whole feature.
- Test each phase as a user, not by reading the code. That is your advantage here.